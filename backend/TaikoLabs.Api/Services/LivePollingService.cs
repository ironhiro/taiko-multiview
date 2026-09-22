using Microsoft.Extensions.Options;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Refreshes every venue's live snapshot on a fixed interval. This must keep running for
/// the site to work, so the host must not scale the container to zero.
/// </summary>
public sealed class LivePollingService(
    IServiceScopeFactory scopeFactory,
    VenueRegistry registry,
    LiveStreamStore store,
    IOptions<YouTubeOptions> options,
    ILogger<LivePollingService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromSeconds(options.Value.PollIntervalSecondsClamped);

        logger.LogInformation(
            "Polling {Count} venue(s) every {Interval}s in {Mode} mode",
            registry.All.Count,
            interval.TotalSeconds,
            options.Value.EffectiveMode);

        using var timer = new PeriodicTimer(interval);

        do
        {
            await RefreshAsync(stoppingToken);
        }
        while (await SafeWaitAsync(timer, stoppingToken));
    }

    /// <summary>Refreshes every venue, or just one when <paramref name="venueId"/> is given.</summary>
    public async Task RefreshAsync(CancellationToken ct, string? venueId = null)
    {
        var venues = venueId is null
            ? registry.All
            : registry.Find(venueId) is { } single ? [single] : [];

        foreach (var venue in venues)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var client = scope.ServiceProvider.GetRequiredService<YouTubeLiveClient>();

                var snapshot = await client.FetchAsync(venue, ct);
                store.Publish(venue.Id, snapshot);

                logger.LogDebug(
                    "{Venue}: {Count} station(s) streaming, {Unmatched} unmatched",
                    venue.Id,
                    snapshot.Streams.Count,
                    snapshot.Unmatched.Count);
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
