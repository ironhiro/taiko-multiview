using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Options;
using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// The finished broadcasts behind 다시보기, per venue: today's, and those of the last
/// <see cref="YouTubeOptions.ReplayDays"/> days before it that had any, looking back
/// <see cref="YouTubeOptions.ReplayMaxAgeDays"/> days at most (<see cref="Window"/>). A busy
/// venue's week and a quiet venue's month come out as about the same number of days to choose.
///
/// It costs no quota of its own in steady state. Every poll already lists a venue's newest
/// uploads and asks videos.list about all of them (<see cref="YouTubeLiveClient"/>); that one
/// answer says which ended, when, and whether they are still public - the live wall only
/// threw that part away. So the archive is filled from polls the wall makes anyway, and
/// every viewer is served from memory.
///
/// What it cannot see without spending quota is the past before the process started. The
/// archive is mirrored to a file for that, as <see cref="LiveSnapshotCache"/> mirrors the
/// wall; a start with no file (a new container: the deployment keeps no volume) reads up to
/// <see cref="YouTubeOptions.ReplayBackfillPages"/> older pages once per venue instead
/// (<see cref="BackfillSince"/>).
///
/// One replica is assumed, as for the other caches.
/// </summary>
public sealed class ReplayArchive
{
    /// <summary>A broadcast shorter than this was a false start, not something to watch again.</summary>
    internal static readonly TimeSpan ShortestReplay = TimeSpan.FromMinutes(1);

    private static readonly JsonSerializerOptions Format = new() { WriteIndented = false };

    private readonly object _gate = new();
    private readonly Dictionary<string, Dictionary<string, PastBroadcast>> _byVenue = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _backfilled = new(StringComparer.OrdinalIgnoreCase);
    private readonly YouTubeOptions _youtube;
    private readonly ILogger<ReplayArchive> _logger;
    private readonly TimeProvider _clock;
    private readonly string? _cachePath;
    private readonly DateTimeOffset? _restoredSavedAt;

    public ReplayArchive(
        IOptions<VenuesOptions> venues,
        IOptions<YouTubeOptions> youtube,
        IHostEnvironment environment,
        ILogger<ReplayArchive> logger,
        TimeProvider? clock = null)
    {
        _youtube = youtube.Value;
        _logger = logger;
        _clock = clock ?? TimeProvider.System;

        // Mock data is made up afresh every poll, so there is nothing worth keeping - and a
        // file would carry one test run's broadcasts into the next.
        if (_youtube.EffectiveMode != LiveSourceMode.Mock && !string.IsNullOrWhiteSpace(venues.Value.ReplayCachePath))
        {
            var configured = venues.Value.ReplayCachePath;
            _cachePath = Path.IsPathRooted(configured)
                ? configured
                : Path.Combine(environment.ContentRootPath, configured);
            _restoredSavedAt = Restore();
        }
    }

    private sealed record CacheFile(DateTimeOffset SavedAt, Dictionary<string, List<PastBroadcast>> Venues);

    /// <summary>
    /// How far back the next poll of this venue should read older uploads, or null when it
    /// needs none: already done in this process, or switched off. A file restored at start
    /// covers everything up to when it was written, so only the gap since then is read -
    /// usually nothing beyond the page every poll reads anyway.
    /// </summary>
    public DateTimeOffset? BackfillSince(string venueId)
    {
        if (_youtube.ReplayBackfillPagesClamped == 0)
        {
            return null;
        }

        lock (_gate)
        {
            if (_backfilled.Contains(venueId))
            {
                return null;
            }
        }

        // A day of slack beyond the furthest it may look, since a broadcast is published before
        // it starts and the span is counted in the venue's days, not in hours.
        var since = _clock.GetUtcNow() - TimeSpan.FromDays(_youtube.ReplayMaxAgeDaysClamped + 1);

        // An hour of overlap with the file, for the broadcasts that ended around its writing.
        return _restoredSavedAt is { } saved && saved - TimeSpan.FromHours(1) > since
            ? saved - TimeSpan.FromHours(1)
            : since;
    }

    /// <summary>
    /// What the next poll of this venue is to do for 다시보기: how far back it may read (none
    /// once done), and how many days with broadcasts are wanted - counting the ones the archive
    /// already holds - so a busy venue stops reading as soon as it has them.
    /// </summary>
    public ReplayFetch FetchFor(Venue venue, TimeZoneInfo timeZone)
    {
        var since = BackfillSince(venue.Id);
        var today = Today(timeZone);
        IReadOnlySet<DateOnly> known = since is null
            ? new HashSet<DateOnly>()
            : For(venue.Id).Select(broadcast => BroadcastDay(venue, timeZone, broadcast)).Where(day => day < today).ToHashSet();

        return new ReplayFetch(timeZone, since, _youtube.ReplayDaysClamped, known);
    }

    /// <summary>Takes in what a poll found, and writes the archive out when it changed.</summary>
    public void Record(Venue venue, TimeZoneInfo timeZone, ReplayHarvest harvest)
    {
        var venueId = venue.Id;
        bool changed;

        lock (_gate)
        {
            if (harvest.Backfilled)
            {
                _backfilled.Add(venueId);
            }

            if (!_byVenue.TryGetValue(venueId, out var stored))
            {
                stored = new Dictionary<string, PastBroadcast>(StringComparer.Ordinal);
                _byVenue[venueId] = stored;
            }

            changed = Apply(stored, harvest, _clock.GetUtcNow() - Retention);
            changed |= KeepWindow(stored, venue, timeZone, Today(timeZone), _youtube.ReplayDaysClamped, _youtube.ReplayMaxAgeDaysClamped);
        }

        if (changed)
        {
            Save();
        }
    }

    /// <summary>The venue's broadcasts as stored, in no particular order.</summary>
    public IReadOnlyList<PastBroadcast> For(string venueId)
    {
        lock (_gate)
        {
            return _byVenue.TryGetValue(venueId, out var stored) ? [.. stored.Values] : [];
        }
    }

    /// <summary>The archive as GET /api/replay/{venueId} serves it.</summary>
    public ReplayResponse Describe(Venue venue, TimeZoneInfo timeZone, string? timeZoneName = null)
    {
        var today = Today(timeZone);
        var maxAge = _youtube.ReplayMaxAgeDaysClamped;
        var days = Group(venue, timeZone, For(venue.Id), today.AddDays(-maxAge));
        var shown = Window(days.Select(day => day.Date), today, _youtube.ReplayDaysClamped, maxAge).ToHashSet();

        return new ReplayResponse
        {
            VenueId = venue.Id,
            RetentionDays = _youtube.ReplayDaysClamped,
            MaxAgeDays = maxAge,
            TimeZone = timeZoneName,
            Days = [.. days.Where(day => shown.Contains(day.Date))],
        };
    }

    /// <summary>
    /// The days 다시보기 shows: today (and, should the clock disagree, anything later), and the
    /// <paramref name="pastDays"/> most recent days before it that had broadcasts, none further
    /// back than <paramref name="maxAgeDays"/>.
    /// </summary>
    internal static IEnumerable<DateOnly> Window(IEnumerable<DateOnly> days, DateOnly today, int pastDays, int maxAgeDays)
    {
        var distinct = days.Distinct().ToList();
        var past = distinct
            .Where(day => day < today && day >= today.AddDays(-maxAgeDays))
            .OrderDescending()
            .Take(pastDays);

        return distinct.Where(day => day >= today).Concat(past);
    }

    /// <summary>
    /// Drops what <see cref="Window"/> would not show: anything further back than the span, and
    /// the days with broadcasts past the wanted number. Returns whether anything went.
    /// </summary>
    internal static bool KeepWindow(
        Dictionary<string, PastBroadcast> stored,
        Venue venue,
        TimeZoneInfo timeZone,
        DateOnly today,
        int pastDays,
        int maxAgeDays)
    {
        var dayOf = stored.ToDictionary(pair => pair.Key, pair => BroadcastDay(venue, timeZone, pair.Value), StringComparer.Ordinal);
        var kept = Window(dayOf.Values, today, pastDays, maxAgeDays).ToHashSet();
        var gone = dayOf.Where(pair => !kept.Contains(pair.Value)).Select(pair => pair.Key).ToList();

        foreach (var key in gone)
        {
            stored.Remove(key);
        }

        return gone.Count > 0;
    }

    private DateOnly Today(TimeZoneInfo timeZone) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(_clock.GetUtcNow(), timeZone).DateTime);

    /// <summary>Kept a little past the furthest it looks, so a day at its edge is never half pruned.</summary>
    private TimeSpan Retention => TimeSpan.FromDays(_youtube.ReplayMaxAgeDaysClamped + 2);

    /// <summary>
    /// The archive's rules, apart from its storage: finished broadcasts are added (a newer
    /// reading of one replaces the older), anything checked and no longer public goes, and so
    /// does anything older than <paramref name="startedAfter"/>. Returns whether it changed.
    /// </summary>
    internal static bool Apply(Dictionary<string, PastBroadcast> stored, ReplayHarvest harvest, DateTimeOffset startedAfter)
    {
        if (harvest.ReplacesAll)
        {
            stored.Clear();
            foreach (var (broadcast, index) in harvest.Ended.Select((broadcast, index) => (broadcast, index)))
            {
                stored[$"{broadcast.VideoId}#{index}"] = broadcast;
            }

            return true;
        }

        var changed = false;

        foreach (var broadcast in harvest.Ended)
        {
            if (broadcast.StartedAt < startedAfter)
            {
                continue;
            }

            if (!stored.TryGetValue(broadcast.VideoId, out var existing) || existing != broadcast)
            {
                stored[broadcast.VideoId] = broadcast;
                changed = true;
            }
        }

        var stillPublic = harvest.StillPublic as ISet<string> ?? harvest.StillPublic.ToHashSet(StringComparer.Ordinal);
        foreach (var videoId in harvest.Checked)
        {
            if (!stillPublic.Contains(videoId) && stored.Remove(videoId))
            {
                changed = true;
            }
        }

        foreach (var old in stored.Values.Where(broadcast => broadcast.StartedAt < startedAfter).ToList())
        {
            stored.Remove(old.VideoId);
            changed = true;
        }

        return changed;
    }

    /// <summary>
    /// Days, newest first, from <paramref name="earliest"/> on; in each, its 회차 in order; in
    /// each 회차, the venue's cabinets in the venue's order and then the ones it does not list,
    /// by name. A cabinet that went on air twice in one 회차 (a restarted broadcast) keeps both,
    /// earlier first.
    /// </summary>
    internal static IReadOnlyList<ReplayDay> Group(
        Venue venue,
        TimeZoneInfo timeZone,
        IEnumerable<PastBroadcast> broadcasts,
        DateOnly earliest)
    {
        var stationOrder = venue.Stations
            .Select((station, index) => (station.Id, index))
            .ToDictionary(entry => entry.Id, entry => entry.index, StringComparer.Ordinal);

        var placed = broadcasts
            .Select(broadcast => (Broadcast: broadcast, Day: BroadcastDay(venue, timeZone, broadcast)))
            .Where(entry => entry.Day >= earliest)
            // Numbered per cabinet per day, so the cabinet's own nth broadcast is its nth 회차
            // when the titles carry no part.
            .GroupBy(entry => (entry.Day, Cabinet: Venue.Normalize(entry.Broadcast.Name)))
            .SelectMany(cabinetDay => cabinetDay
                .OrderBy(entry => entry.Broadcast.StartedAt)
                .Select((entry, index) => (
                    entry.Broadcast,
                    entry.Day,
                    Session: entry.Broadcast.Part ?? index + 1,
                    FromTitle: entry.Broadcast.Part is not null)));

        return placed
            .GroupBy(entry => entry.Day)
            .OrderByDescending(day => day.Key)
            .Select(day => new ReplayDay
            {
                Date = day.Key,
                Sessions = day
                    .GroupBy(entry => entry.Session)
                    .OrderBy(session => session.Key)
                    .Select(session => new ReplaySession
                    {
                        Session = session.Key,
                        FromTitle = session.All(entry => entry.FromTitle),
                        StartedAt = session.Min(entry => entry.Broadcast.StartedAt),
                        Broadcasts = session
                            .Select(entry => (entry.Broadcast, StationId: venue.ResolveStationId(entry.Broadcast.Name)))
                            .OrderBy(entry => entry.StationId is { } id && stationOrder.TryGetValue(id, out var index) ? index : int.MaxValue)
                            .ThenBy(entry => Venue.Normalize(entry.Broadcast.Name), StringComparer.Ordinal)
                            .ThenBy(entry => entry.Broadcast.StartedAt)
                            .Select(entry => new ReplayBroadcast
                            {
                                VideoId = entry.Broadcast.VideoId,
                                StationId = entry.StationId,
                                Name = entry.Broadcast.Name,
                                Title = entry.Broadcast.Title,
                                Part = entry.Broadcast.Part,
                                StartedAt = entry.Broadcast.StartedAt,
                                EndedAt = entry.Broadcast.EndedAt,
                                Embeddable = entry.Broadcast.Embeddable,
                            })
                            .ToList(),
                    })
                    .ToList(),
            })
            .ToList();
    }

    /// <summary>
    /// The venue's day a broadcast belongs to. The date in its title wins when there is one
    /// and it is within a day of when the broadcast started - it is how the venue itself
    /// names the day. Otherwise the start decides, counting the small hours of a window that
    /// runs past midnight (10:00-29:00) as the day it opened.
    /// </summary>
    internal static DateOnly BroadcastDay(Venue venue, TimeZoneInfo timeZone, PastBroadcast broadcast)
    {
        var local = TimeZoneInfo.ConvertTime(broadcast.StartedAt, timeZone);
        var byClock = BusinessDateAt(venue, local);

        return TryParseTitleDate(broadcast.StreamDate, out var titled) && Math.Abs(titled.DayNumber - byClock.DayNumber) <= 1
            ? titled
            : byClock;
    }

    private static DateOnly BusinessDateAt(Venue venue, DateTimeOffset local)
    {
        var today = DateOnly.FromDateTime(local.DateTime);
        var yesterday = today.AddDays(-1);
        var minutes = (int)local.TimeOfDay.TotalMinutes;

        return venue.WindowFor(yesterday.DayOfWeek) is { EndsNextDay: true } window && minutes + (24 * 60) < window.EndMinutes
            ? yesterday
            : today;
    }

    private static readonly string[] TitleDateFormats =
        ["yy.MM.dd", "yy.M.d", "yyyy.MM.dd", "yyyy.M.d", "yyyy-MM-dd", "yyyy-M-d", "yy-MM-dd", "yyyy/M/d", "yyMMdd", "yyyyMMdd"];

    /// <summary>The title's date in the forms the configured venues write it ("26.10.09", "2026-10-9").</summary>
    internal static bool TryParseTitleDate(string? value, out DateOnly date)
    {
        date = default;
        return !string.IsNullOrWhiteSpace(value)
            && DateOnly.TryParseExact(value.Trim(), TitleDateFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out date);
    }

    /// <summary>The archive from the file, or nothing. Never throws: a start must always succeed.</summary>
    private DateTimeOffset? Restore()
    {
        if (_cachePath is null || !File.Exists(_cachePath))
        {
            return null;
        }

        try
        {
            var cached = JsonSerializer.Deserialize<CacheFile>(File.ReadAllText(_cachePath), Format);
            if (cached?.Venues is null)
            {
                return null;
            }

            var startedAfter = _clock.GetUtcNow() - Retention;
            var count = 0;

            foreach (var (venueId, broadcasts) in cached.Venues.Where(pair => pair.Value is not null))
            {
                var stored = broadcasts
                    .Where(broadcast => broadcast is not null && broadcast.StartedAt >= startedAfter)
                    .GroupBy(broadcast => broadcast.VideoId, StringComparer.Ordinal)
                    .ToDictionary(group => group.Key, group => group.Last(), StringComparer.Ordinal);
                _byVenue[venueId] = stored;
                count += stored.Count;
            }

            _logger.LogInformation(
                "Restored {Count} finished broadcast(s) for 다시보기, saved {SavedAt:u}",
                count,
                cached.SavedAt);

            return cached.SavedAt;
        }
        catch (Exception ex) when (ex is IOException or JsonException or NotSupportedException or UnauthorizedAccessException)
        {
            _logger.LogDebug(ex, "The replay cache could not be read; starting empty");
            return null;
        }
    }

    private void Save()
    {
        if (_cachePath is null)
        {
            return;
        }

        lock (_gate)
        {
            try
            {
                var payload = new CacheFile(
                    _clock.GetUtcNow(),
                    _byVenue.ToDictionary(pair => pair.Key, pair => pair.Value.Values.ToList(), StringComparer.Ordinal));

                // Beside the real file first, then moved, so a process killed mid-write keeps
                // the previous archive whole.
                var staging = _cachePath + ".tmp";
                File.WriteAllText(staging, JsonSerializer.Serialize(payload, Format));
                File.Move(staging, _cachePath, overwrite: true);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException)
            {
                _logger.LogDebug(ex, "Could not write the replay cache");
            }
        }
    }
}
