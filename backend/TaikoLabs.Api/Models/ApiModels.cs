namespace TaikoLabs.Api.Models;

/// <summary>A single cabinet/station inside the venue.</summary>
public sealed record Station(string Id, string Label, string ZoneId, string ZoneName);

/// <summary>A live (or most recent) stream resolved to a station.</summary>
public sealed record LiveStream
{
    /// <summary>Station this stream belongs to, or null when the title did not map to a known station.</summary>
    public string? StationId { get; init; }

    public required string VideoId { get; init; }
    public required string Title { get; init; }

    /// <summary>The "$name" segment of the title, e.g. "A1" or "THE BASE".</summary>
    public required string Name { get; init; }

    /// <summary>yy.MM.dd as written in the title.</summary>
    public string? StreamDate { get; init; }

    /// <summary>The "- N부" suffix when present.</summary>
    public int? Part { get; init; }

    public bool IsLive { get; init; }
    public bool Embeddable { get; init; } = true;
    public long? ConcurrentViewers { get; init; }
    public DateTimeOffset? ActualStartTime { get; init; }
    public DateTimeOffset? PublishedAt { get; init; }
    public string? ThumbnailUrl { get; init; }

    public string WatchUrl => $"https://www.youtube.com/watch?v={VideoId}";
}

/// <summary>How the current snapshot was produced.</summary>
public enum LiveSourceMode
{
    /// <summary>Use the API when a key is configured, otherwise fall back to Public.</summary>
    Auto,

    /// <summary>Uploads playlist for ids + videos.list for live status. Needs an API key.</summary>
    Api,

    /// <summary>
    /// No API key: RSS feed for ids, then the public watch page for live status.
    /// Accurate but depends on YouTube's page markup rather than a supported API.
    /// </summary>
    Public,

    /// <summary>Fully synthetic data, no network access at all.</summary>
    Mock,
}

public sealed record LiveSnapshot
{
    public DateTimeOffset UpdatedAt { get; init; } = DateTimeOffset.UtcNow;

    /// <summary>Streams that resolved to a known station, at most one per station.</summary>
    public IReadOnlyList<LiveStream> Streams { get; init; } = [];

    /// <summary>Titles that matched the pattern but whose name is not a known station.</summary>
    public IReadOnlyList<LiveStream> Unmatched { get; init; } = [];

    public LiveSourceMode Source { get; init; }

    /// <summary>True when liveness came from something other than the official API.</summary>
    public bool IsFallbackSource { get; init; }

    public string? Error { get; init; }

    public static LiveSnapshot Empty(LiveSourceMode source, string? error = null) =>
        new() { Source = source, Error = error };
}

/// <summary>Whether the venue is open, and why not when it is closed.</summary>
public enum VenueState
{
    Open,

    /// <summary>Within opening hours, but the day is marked as a closure.</summary>
    ClosedForHoliday,

    /// <summary>Simply outside the weekly opening hours.</summary>
    OutsideHours,
}

public sealed record VenueStatus
{
    public VenueState State { get; init; }

    /// <summary>Now, in the venue's own time zone.</summary>
    public DateTimeOffset LocalTime { get; init; }

    /// <summary>The day whose opening window covers <see cref="LocalTime"/>, if any.</summary>
    public DateOnly? BusinessDate { get; init; }

    /// <summary>That day's window, e.g. "07:00-29:00" for a 05:00 close the next morning.</summary>
    public string? TodayHours { get; init; }

    public DateTimeOffset? OpensAt { get; init; }

    /// <summary>"manual" or "naver" - where the closure came from.</summary>
    public string? ClosureReason { get; init; }
}
