namespace TaikoLabs.Api.Services;

/// <summary>
/// What a day of polling costs in YouTube Data API units, worked out from the venues' own
/// opening hours and the intervals in force.
///
/// The cost is decided by configuration - how many venues, how long each is open, how often
/// they are polled - and never by how many people are watching, so it can be known before a
/// deployment rather than discovered when the quota runs out and every wall goes blank at
/// once. A review found the four configured venues already spending about 85% of the default
/// allowance in Api mode while the README claimed 70%, which is why
/// <see cref="LivePollingService"/> now prints this at startup.
/// </summary>
/// <param name="Venues">How many venues are polled.</param>
/// <param name="OpenHoursPerDay">Their opening hours added together, averaged over a week.</param>
/// <param name="UnitsPerDay">Quota units a whole day of polling costs.</param>
public sealed record QuotaEstimate(int Venues, double OpenHoursPerDay, int UnitsPerDay)
{
    /// <summary>
    /// One poll of one venue: playlistItems.list (1 unit) plus videos.list (1 unit). See
    /// <see cref="YouTubeLiveClient"/>, which is where those two calls are made.
    /// </summary>
    private const int UnitsPerPoll = 2;

    /// <summary>
    /// Channel avatars: one channels.list call covers up to 50 channels and is cached for a
    /// day (<see cref="ChannelAvatarCache"/>), so it costs one unit a day however many
    /// venues there are.
    /// </summary>
    private const int AvatarUnitsPerDay = 1;

    /// <summary>Google's default allowance for a Data API project.</summary>
    public const int DailyLimit = 10_000;

    /// <summary>
    /// Above this the allowance has no room for another venue: a venue open sixteen hours a
    /// day - the average of the configured four - costs about 1,900 units, or 19% of it. So
    /// anything past 81% overflows the moment a venue is added, which is precisely the
    /// mistake the estimate exists to prevent.
    /// </summary>
    public const double CrowdedPercent = 80;

    public double PercentOfLimit => Math.Round(UnitsPerDay * 100.0 / DailyLimit, 1);

    /// <summary>Whether there is no longer room for another venue at these intervals.</summary>
    public bool IsCrowded => PercentOfLimit >= CrowdedPercent;

    /// <summary>
    /// A day of polling at the configured intervals: every venue at the full rate while it
    /// is open and for <see cref="YouTubeOptions.PreOpenMinutes"/> before it opens, and at
    /// the closed rate the rest of the time. It is a floor, not a ceiling: a venue that is
    /// streaming - or has an unmatched broadcast on air - stays on the full rate outside its
    /// hours too (<see cref="LivePollingService.IsDue"/>), and a manual refresh adds to it.
    /// </summary>
    public static QuotaEstimate For(IReadOnlyCollection<Venue> venues, YouTubeOptions options)
    {
        var openHours = venues.Sum(AverageOpenHoursPerDay);
        var preOpenHours = venues.Count * Math.Max(0, options.PreOpenMinutes) / 60.0;
        var closedHours = Math.Max(0, (venues.Count * 24.0) - openHours - preOpenHours);

        var pollsPerHour = 3600.0 / options.PollIntervalSecondsClamped;
        var closedPollsPerHour = 3600.0 / options.ClosedPollIntervalSecondsClamped;

        var units = (((openHours + preOpenHours) * pollsPerHour) + (closedHours * closedPollsPerHour)) * UnitsPerPoll;

        return new QuotaEstimate(
            venues.Count,
            Math.Round(openHours, 2),
            (int)Math.Round(units + AvatarUnitsPerDay));
    }

    /// <summary>
    /// The venue's opening hours averaged over the week. A window that closes after midnight
    /// (10:00-29:00) counts its whole length on the day it opens, which is where the polling
    /// actually happens; the next day's window starts hours later, so nothing is counted twice.
    /// </summary>
    private static double AverageOpenHoursPerDay(Venue venue)
    {
        var minutes = 0;

        foreach (var day in Enum.GetValues<DayOfWeek>())
        {
            if (venue.WindowFor(day) is { } window)
            {
                minutes += window.EndMinutes - window.StartMinutes;
            }
        }

        return minutes / 60.0 / 7;
    }
}
