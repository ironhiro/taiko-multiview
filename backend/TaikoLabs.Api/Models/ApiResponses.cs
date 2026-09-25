namespace TaikoLabs.Api.Models;

// The shapes the HTTP API returns. Named rather than anonymous so the OpenAPI document
// (and Swagger UI) can describe them; the JSON is camelCase, enums as strings.

/// <summary>GET /api/health - whether the server is up, and how it is running.</summary>
public sealed record HealthResponse
{
    /// <summary>Always "ok" when the server answers at all.</summary>
    public required string Status { get; init; }

    public required DateTimeOffset Time { get; init; }

    public required DateTimeOffset StartedAt { get; init; }

    public required long UptimeSeconds { get; init; }

    /// <summary>ASP.NET Core environment, e.g. "Development" or "Production".</summary>
    public required string Environment { get; init; }

    /// <summary>The configured YouTube source mode.</summary>
    public required LiveSourceMode YouTubeMode { get; init; }

    /// <summary>Whether a YouTube Data API key is configured. The key itself is never returned.</summary>
    public required bool HasApiKey { get; init; }

    public required int PollIntervalSeconds { get; init; }

    public required int ClosedPollIntervalSeconds { get; init; }

    public required int VenueCount { get; init; }

    public required int VenuesVersion { get; init; }
}

/// <summary>GET /api/venues - the static configuration of every venue.</summary>
public sealed record VenuesResponse
{
    /// <summary>Moves whenever venues.json is edited; clients refetch when /api/live reports a new one.</summary>
    public required int Version { get; init; }

    public required IReadOnlyList<VenueInfo> Venues { get; init; }
}

public sealed record VenueInfo
{
    public required string Id { get; init; }
    public required string Name { get; init; }

    /// <summary>#RRGGBB identity colour.</summary>
    public string? Accent { get; init; }

    /// <summary>The configured logo file, else the channel's profile picture.</summary>
    public string? Logo { get; init; }

    public required string ChannelId { get; init; }
    public string? ChannelUrl { get; init; }
    public required IReadOnlyList<ZoneDefinition> Zones { get; init; }
    public required IReadOnlyList<StationInfo> Stations { get; init; }

    /// <summary>The floor plan; null for venues without one.</summary>
    public LayoutDefinition? Layout { get; init; }
}

public sealed record StationInfo(string Id, string Label, string? ZoneId);

/// <summary>GET /api/live and POST /api/live/refresh - every venue's current streams.</summary>
public sealed record LiveResponse
{
    /// <summary>How often clients should poll while a venue is open.</summary>
    public required int PollIntervalSeconds { get; init; }

    public required int VenuesVersion { get; init; }

    public required IReadOnlyList<VenueLive> Venues { get; init; }
}

public sealed record VenueLive
{
    public required string VenueId { get; init; }

    /// <summary>When this venue was last polled.</summary>
    public required DateTimeOffset UpdatedAt { get; init; }

    /// <summary>Streams matched to a station, at most one per station.</summary>
    public required IReadOnlyList<LiveStream> Streams { get; init; }

    /// <summary>Titles that fit the pattern but name no known station.</summary>
    public required IReadOnlyList<LiveStream> Unmatched { get; init; }

    public required LiveSourceMode Source { get; init; }
    public required bool IsFallbackSource { get; init; }
    public string? Error { get; init; }

    /// <summary>Open or closed right now, and when it opens next.</summary>
    public required VenueStatus Venue { get; init; }
}
