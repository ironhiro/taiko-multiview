using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// YouTube access settings shared by every venue. Which channel to watch is part of the
/// venue definition, not of this.
/// </summary>
public sealed class YouTubeOptions
{
    public const string SectionName = "YouTube";

    /// <summary>
    /// YouTube Data API v3 key. Leave empty to run in <see cref="LiveSourceMode.Public"/>,
    /// which needs no key but relies on scraping the watch page.
    /// </summary>
    public string ApiKey { get; set; } = string.Empty;

    public LiveSourceMode Mode { get; set; } = LiveSourceMode.Auto;

    /// <summary>Seconds between polls. Each venue is polled once per round.</summary>
    public int PollIntervalSeconds { get; set; } = 60;

    /// <summary>How many recent uploads to inspect per venue. The API accepts at most 50 ids per call.</summary>
    public int MaxVideoIdsPerLookup { get; set; } = 50;

    /// <summary>
    /// Seconds between polls for a venue outside its opening hours with nothing on air.
    /// Most of a day is closed hours, so this is where the quota goes if left at the
    /// open-hours rate.
    /// </summary>
    public int ClosedPollIntervalSeconds { get; set; } = 600;

    /// <summary>Minutes before opening at which a closed venue goes back to the full rate.</summary>
    public int PreOpenMinutes { get; set; } = 30;

    /// <summary>
    /// A manual refresh skips any venue polled within this many seconds. The refresh
    /// button is public, so without it every viewer's click would spend quota.
    /// </summary>
    public int ManualRefreshCooldownSeconds { get; set; } = 60;

    /// <summary>
    /// Real, embeddable YouTube video ids for <see cref="LiveSourceMode.Mock"/>. Empty (the
    /// default) keeps mock streams fake and non-embeddable, so no player is ever built.
    /// Given ids - 24/7 live streams suit best - every cabinet goes on air with one of them
    /// and the wall builds real players: what a load test needs.
    /// </summary>
    public List<string> MockVideoIds { get; set; } = [];

    /// <summary>
    /// How many days with finished broadcasts 다시보기 keeps before today - days with
    /// something to watch, not calendar days, so a venue that streams now and then still
    /// shows a week of it. Today's finished broadcasts are kept besides. Bounded by
    /// <see cref="ReplayMaxAgeDays"/>.
    /// </summary>
    public int ReplayDays { get; set; } = 7;

    /// <summary>
    /// How far back 다시보기 looks for those days at most. A venue that streamed on fewer than
    /// <see cref="ReplayDays"/> days in this span shows only those.
    /// </summary>
    public int ReplayMaxAgeDays { get; set; } = 30;

    /// <summary>
    /// After a start with nothing remembered - a fresh container has no cache file - how many
    /// further pages of uploads (50 each) the first poll of a venue may read to fill 다시보기
    /// back: until <see cref="ReplayDays"/> days with broadcasts are found, or the pages reach
    /// past <see cref="ReplayMaxAgeDays"/>. Each page is one playlistItems.list and one
    /// videos.list call, 2 units, and it happens at most once per venue per process. Zero turns
    /// the backfill off. Eight is measured, not guessed: on 2026-10-10 CYGameworld, whose
    /// channel carries other games and scheduled Taiko broadcasts that never start, needed 6
    /// pages in all (5 beyond the poll's own) to reach 30 days back; TAIKO LABS, about 30
    /// uploads a day, found its 8th day with broadcasts on page 5.
    /// </summary>
    public int ReplayBackfillPages { get; set; } = 8;

    public int PollIntervalSecondsClamped => Math.Clamp(PollIntervalSeconds, 15, 3600);

    public int ClosedPollIntervalSecondsClamped =>
        Math.Clamp(ClosedPollIntervalSeconds, PollIntervalSecondsClamped, 3600);

    public int MaxVideoIdsClamped => Math.Clamp(MaxVideoIdsPerLookup, 1, 50);

    public int ReplayDaysClamped => Math.Clamp(ReplayDays, 1, 31);

    public int ReplayMaxAgeDaysClamped => Math.Clamp(ReplayMaxAgeDays, ReplayDaysClamped, 90);

    public int ReplayBackfillPagesClamped => Math.Clamp(ReplayBackfillPages, 0, 20);

    public bool HasApiKey => !string.IsNullOrWhiteSpace(ApiKey);

    /// <summary>Resolves <see cref="LiveSourceMode.Auto"/> against whether a key is configured.</summary>
    public LiveSourceMode EffectiveMode =>
        Mode == LiveSourceMode.Auto
            ? (HasApiKey ? LiveSourceMode.Api : LiveSourceMode.Public)
            : Mode;

    /// <summary>
    /// The channel's "uploads" playlist. YouTube derives it from the channel id by
    /// swapping the "UC" prefix for "UU", which saves a channels.list call (1 quota unit).
    /// </summary>
    public static string UploadsPlaylistId(string channelId) =>
        channelId.StartsWith("UC", StringComparison.Ordinal)
            ? string.Concat("UU", channelId.AsSpan(2))
            : channelId;

    public static string RssFeedUrl(string channelId) =>
        $"https://www.youtube.com/feeds/videos.xml?channel_id={channelId}";
}
