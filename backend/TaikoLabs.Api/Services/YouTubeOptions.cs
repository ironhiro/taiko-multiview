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

    public int PollIntervalSecondsClamped => Math.Clamp(PollIntervalSeconds, 15, 3600);

    public int ClosedPollIntervalSecondsClamped =>
        Math.Clamp(ClosedPollIntervalSeconds, PollIntervalSecondsClamped, 3600);

    public int MaxVideoIdsClamped => Math.Clamp(MaxVideoIdsPerLookup, 1, 50);

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
