namespace TaikoLabs.Api.Models;

/// <summary>
/// A finished broadcast kept for 다시보기, as the archive stores it. The cabinet is kept by
/// the name in its title rather than by station id, and resolved again whenever it is
/// served, so a cabinet added to the settings later claims its old broadcasts too.
/// </summary>
public sealed record PastBroadcast
{
    public required string VideoId { get; init; }

    public required string Title { get; init; }

    /// <summary>The "$name" segment of the title, as for a live stream.</summary>
    public required string Name { get; init; }

    /// <summary>The date as written in the title, in whatever form the venue writes it.</summary>
    public string? StreamDate { get; init; }

    /// <summary>The "- N부" suffix when the title has one.</summary>
    public int? Part { get; init; }

    public required DateTimeOffset StartedAt { get; init; }

    /// <summary>Unknown only where the source does not say (Public mode's watch page may not).</summary>
    public DateTimeOffset? EndedAt { get; init; }

    public bool Embeddable { get; init; } = true;
}

/// <summary>
/// What a poll learned for 다시보기, beside the live snapshot: the broadcasts it saw finished,
/// and which of the archive's videos it was in a position to vouch for.
/// </summary>
/// <param name="Ended">Finished, public broadcasts whose titles fit the venue's pattern.</param>
/// <param name="Checked">Every video id the poll asked YouTube about.</param>
/// <param name="StillPublic">
/// The ones that came back public and still titled as a broadcast of this venue. An id that
/// was checked but is not here was deleted, made private or renamed, and leaves the archive.
/// </param>
/// <param name="Backfilled">Whether this poll also read older uploads to fill the archive back.</param>
public sealed record ReplayHarvest(
    IReadOnlyList<PastBroadcast> Ended,
    IReadOnlyCollection<string> Checked,
    IReadOnlyCollection<string> StillPublic,
    bool Backfilled = false)
{
    /// <summary>
    /// The whole archive of the venue, not news to merge into it. Mock mode only: its made-up
    /// broadcasts reuse a couple of real video ids, which the archive would otherwise fold into one.
    /// </summary>
    public bool ReplacesAll { get; init; }

    public static readonly ReplayHarvest None = new([], [], []);
}

/// <summary>One poll of one venue: the live snapshot, and what it found for 다시보기.</summary>
public sealed record LivePoll(LiveSnapshot Snapshot, ReplayHarvest? Replay = null);

/// <summary>GET /api/replay/{venueId} - a venue's finished broadcasts, by day, then 회차, then cabinet.</summary>
public sealed record ReplayResponse
{
    public required string VenueId { get; init; }

    /// <summary>How many days with broadcasts before today it keeps (besides today's).</summary>
    public required int RetentionDays { get; init; }

    /// <summary>How many calendar days back it looks for them at most.</summary>
    public required int MaxAgeDays { get; init; }

    /// <summary>The IANA zone the days are counted in, so a client can tell the times the venue's way.</summary>
    public string? TimeZone { get; init; }

    /// <summary>Newest day first.</summary>
    public required IReadOnlyList<ReplayDay> Days { get; init; }
}

/// <summary>
/// One business day: the venue's own day, so a broadcast that starts at 01:00 inside a window
/// running to 29:00 belongs to the day before, as the venue would say it does.
/// </summary>
public sealed record ReplayDay
{
    public required DateOnly Date { get; init; }

    /// <summary>In order, 1부 first.</summary>
    public required IReadOnlyList<ReplaySession> Sessions { get; init; }
}

/// <summary>
/// A 회차: every cabinet's broadcast of the same part of the same day. The unit a session
/// multiview (several cabinets of "어제 2부" at once) would play together.
/// </summary>
public sealed record ReplaySession
{
    /// <summary>The part from the titles, or the cabinet's nth broadcast of the day when they carry none.</summary>
    public required int Session { get; init; }

    /// <summary>True when <see cref="Session"/> was read from the titles ("2부"), false when counted.</summary>
    public required bool FromTitle { get; init; }

    /// <summary>The earliest start among its broadcasts.</summary>
    public required DateTimeOffset StartedAt { get; init; }

    /// <summary>The venue's cabinets in their order, then cabinets it does not list, by name.</summary>
    public required IReadOnlyList<ReplayBroadcast> Broadcasts { get; init; }
}

public sealed record ReplayBroadcast
{
    public required string VideoId { get; init; }

    /// <summary>The cabinet it resolves to now, or null for a cabinet the settings do not list.</summary>
    public string? StationId { get; init; }

    public required string Name { get; init; }

    public required string Title { get; init; }

    public int? Part { get; init; }

    public required DateTimeOffset StartedAt { get; init; }

    public DateTimeOffset? EndedAt { get; init; }

    public required bool Embeddable { get; init; }
}
