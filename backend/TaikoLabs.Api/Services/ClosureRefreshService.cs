using Microsoft.Extensions.Options;
using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Refreshes every venue's closure list once at startup and then once a day.
///
/// Daily is deliberate: closures change rarely, and Naver rate-limits aggressively —
/// polling often enough to matter would earn a 429 for no benefit.
/// </summary>
public sealed class ClosureRefreshService(
    IServiceScopeFactory scopeFactory,
    VenueRegistry registry,
    VenueClosureStore store,
    IOptions<VenuesOptions> options,
    ILogger<ClosureRefreshService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var tracked = registry.All.Where(venue => !string.IsNullOrWhiteSpace(venue.Definition.NaverPlaceId)).ToList();

        if (tracked.Count == 0)
        {
            logger.LogInformation("No venue has a naverPlaceId; using configured closedDates only");
            return;
        }

        await RefreshAllAsync(tracked, stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            var delay = TimeUntilNextRun();
            logger.LogDebug("Next closure lookup in {Hours:F1}h", delay.TotalHours);

            try
            {
                await Task.Delay(delay, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }

            await RefreshAllAsync(tracked, stoppingToken);
        }
    }

    private async Task RefreshAllAsync(IReadOnlyList<Venue> venues, CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var feed = scope.ServiceProvider.GetRequiredService<NaverClosureFeed>();

        foreach (var venue in venues)
        {
            try
            {
                var dates = await feed.FetchAsync(venue.Definition.NaverPlaceId!, ct);

                // null means the lookup failed - keep whatever we already had.
                if (dates is not null)
                {
                    store.Publish(venue.Id, dates);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Closure refresh failed for venue '{Id}'", venue.Id);
            }
        }
    }

    private TimeSpan TimeUntilNextRun()
    {
        var now = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, registry.TimeZone);
        var hour = Math.Clamp(options.Value.ClosureRefreshHour, 0, 23);

        var next = now.Date.AddHours(hour);
        if (next <= now.DateTime)
        {
            next = next.AddDays(1);
        }

        var delay = next - now.DateTime;
        return delay < TimeSpan.FromMinutes(1) ? TimeSpan.FromHours(24) : delay;
    }
}
