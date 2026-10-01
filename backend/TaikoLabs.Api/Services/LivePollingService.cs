using Microsoft.Extensions.Options;
using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Refreshes every venue's live snapshot. This must keep running for the site to work, so
/// the host must not scale the container to zero.
///
/// Quota is spent per poll, not per viewer: clients only ever read the stored snapshot.
/// A venue is polled every round while it is open, has something on air, or is about to
/// open; otherwise it drops to <see cref="YouTubeOptions.ClosedPollIntervalSeconds"/>.
/// The on-air check matters - venues do stream outside their listed hours, and a stream
/// must still be seen to end.
/// </summary>
public sealed class LivePollingService(
    IServiceScopeFactory scopeFactory,
    VenueRegistry registry,
    LiveStreamStore store,
    VenueScheduleProvider schedule,
    IOptions<YouTubeOptions> options,
    ILogger<LivePollingService> logger,
    TimeProvider? clock = null) : BackgroundService
{
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;
    private readonly Dictionary<string, DateTimeOffset> _lastPolled = [];
    private readonly SemaphoreSlim _manualGate = new(1, 1);
    // Per venue, the unregistered cabinet names the last good poll saw on air.
    private readonly Dictionary<string, HashSet<string>> _unregisteredOnAir = [];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromSeconds(options.Value.PollIntervalSecondsClamped);

        logger.LogInformation(
            "Polling {Count} venue(s) every {Interval}s in {Mode} mode",
            registry.All.Count,
            interval.TotalSeconds,
            options.Value.EffectiveMode);

        LogQuotaEstimate();

        using var timer = new PeriodicTimer(interval);

        do
        {
            await PollDueAsync(stoppingToken);
        }
        while (await SafeWaitAsync(timer, stoppingToken));
    }

    /// <summary>
    /// Prints what this configuration costs in YouTube quota per day, so that adding a venue
    /// or shortening an interval shows up in the log of the very next start rather than as a
    /// day of blank walls once the allowance runs out (see <see cref="QuotaEstimate"/>).
    /// Only Api mode spends anything, but the estimate is printed in every mode: it is how an
    /// operator decides whether a key can be turned on at all.
    /// </summary>
    private void LogQuotaEstimate()
    {
        var quota = QuotaEstimate.For(registry.All, options.Value);
        var mode = options.Value.EffectiveMode;

        if (mode == LiveSourceMode.Api)
        {
            logger.LogInformation(
                "Estimated quota: {Units} units/day for {Venues} venue(s) open {OpenHours}h/day combined - {Percent}% of the {Limit} unit daily limit",
                quota.UnitsPerDay,
                quota.Venues,
                quota.OpenHoursPerDay,
                quota.PercentOfLimit,
                QuotaEstimate.DailyLimit);
        }
        else
        {
            logger.LogInformation(
                "{Mode} mode spends no quota. The same {Venues} venue(s), open {OpenHours}h/day combined, would cost about {Units} units/day in Api mode - {Percent}% of the {Limit} unit daily limit",
                mode,
                quota.Venues,
                quota.OpenHoursPerDay,
                quota.UnitsPerDay,
                quota.PercentOfLimit,
                QuotaEstimate.DailyLimit);
        }

        if (quota.IsCrowded)
        {
            logger.LogWarning(
                "That leaves {Spare}% of the daily quota spare, which is less than one more venue costs. Adding one will exhaust the quota and empty every wall until it resets at midnight Pacific time; raise YouTube:PollIntervalSeconds before adding venues",
                Math.Round(100 - quota.PercentOfLimit, 1));
        }
    }

    /// <summary>
    /// The refresh button: refreshes every venue, or just one when <paramref name="venueId"/>
    /// is given - skipping any venue polled within the cooldown, whose stored snapshot is
    /// already that fresh. The cooldown is per venue rather than per click so that no number
    /// of viewers can poll a venue more than once per cooldown between them.
    /// </summary>
    public async Task RefreshAsync(CancellationToken ct, string? venueId = null)
    {
        var cooldown = TimeSpan.FromSeconds(Math.Max(0, options.Value.ManualRefreshCooldownSeconds));

        await _manualGate.WaitAsync(ct);
        try
        {
            var venues = venueId is null
                ? registry.All
                : registry.Find(venueId) is { } single ? [single] : [];

            await PollAsync(venues.Where(venue => SinceLastPoll(venue) >= cooldown).ToList(), ct);
        }
        finally
        {
            _manualGate.Release();
        }
    }

    private Task PollDueAsync(CancellationToken ct) =>
        PollAsync(registry.All.Where(IsDue).ToList(), ct);

    private TimeSpan SinceLastPoll(Venue venue)
    {
        lock (_lastPolled)
        {
            return _lastPolled.TryGetValue(venue.Id, out var last)
                ? _clock.GetUtcNow() - last
                : TimeSpan.MaxValue;
        }
    }

    internal bool IsDue(Venue venue)
    {
        DateTimeOffset last;
        lock (_lastPolled)
        {
            if (!_lastPolled.TryGetValue(venue.Id, out last))
            {
                return true;
            }
        }

        var now = _clock.GetUtcNow();
        var status = schedule.For(venue);
        var snapshot = store.For(venue.Id);

        var onAir = snapshot.Streams.Count > 0 || snapshot.Unmatched.Count > 0;
        var aboutToOpen = status.OpensAt is { } opensAt
                          && opensAt - now <= TimeSpan.FromMinutes(Math.Max(0, options.Value.PreOpenMinutes));

        if (status.State == VenueState.Open || onAir || aboutToOpen)
        {
            return true;
        }

        // Half a round of slack, so a timer tick landing a moment early does not push the
        // poll out by a whole extra interval.
        var interval = TimeSpan.FromSeconds(options.Value.ClosedPollIntervalSecondsClamped);
        var slack = TimeSpan.FromSeconds(options.Value.PollIntervalSecondsClamped / 2.0);
        return now - last >= interval - slack;
    }

    private async Task PollAsync(IReadOnlyCollection<Venue> venues, CancellationToken ct)
    {
        foreach (var venue in venues)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var client = scope.ServiceProvider.GetRequiredService<YouTubeLiveClient>();

                var snapshot = await client.FetchAsync(venue, ct);
                store.Publish(venue.Id, snapshot);
                lock (_lastPolled)
                {
                    _lastPolled[venue.Id] = _clock.GetUtcNow();
                }

                logger.LogDebug(
                    "{Venue}: {Count} station(s) streaming, {Unmatched} unmatched",
                    venue.Id,
                    snapshot.Streams.Count,
                    snapshot.Unmatched.Count);

                var newlyOnAir = NoteUnregisteredOnAir(venue.Id, snapshot);
                if (newlyOnAir.Count > 0)
                {
                    logger.LogWarning(
                        "{Venue}: unregistered cabinet(s) on air: {Names}. Add them to the venue's stations to give them a place of their own",
                        venue.Id,
                        string.Join(", ", newlyOnAir));
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Live snapshot refresh failed for venue '{Id}'", venue.Id);
            }
        }
    }

    /// <summary>
    /// Records which cabinets the venue does not list are on air, and returns the ones
    /// that were not on the previous poll. The wall shows them regardless; the warning is
    /// for whoever keeps the venue settings, once per appearance rather than every round.
    /// A poll that failed says nothing about what is on air and changes nothing, so a
    /// passing error does not repeat the warning.
    /// </summary>
    internal IReadOnlyList<string> NoteUnregisteredOnAir(string venueId, LiveSnapshot snapshot)
    {
        if (snapshot.Error is not null)
        {
            return [];
        }

        var onAir = snapshot.Unmatched
            .GroupBy(stream => Venue.Normalize(stream.Name))
            .ToDictionary(group => group.Key, group => group.First().Name, StringComparer.Ordinal);

        lock (_unregisteredOnAir)
        {
            var before = _unregisteredOnAir.GetValueOrDefault(venueId) ?? [];
            _unregisteredOnAir[venueId] = [.. onAir.Keys];

            return onAir
                .Where(entry => !before.Contains(entry.Key))
                .Select(entry => entry.Value)
                .ToList();
        }
    }

    private static async Task<bool> SafeWaitAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try
        {
            return await timer.WaitForNextTickAsync(ct);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }
}
