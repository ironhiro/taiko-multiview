using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Keeps the last poll of every venue in a small file, the way <see cref="VenueClosureStore"/>
/// keeps closures, so that a restart draws the wall it had a minute ago instead of a page of
/// 준비중… until the first poll comes back. Replaying the previous answer costs no YouTube
/// quota, and each snapshot keeps the time it was actually taken, so the page still says how
/// old what it is showing is.
///
/// The file is a shortcut and never a source of truth. Missing, unreadable, or written for a
/// different set of venues, it is ignored and the app starts empty - exactly as it behaved
/// before there was a file at all. Starting up must always succeed.
///
/// One replica is assumed (see "배포" in README.md). Two would take turns overwriting the
/// file; each write is whole, so the result would still be a valid snapshot, just an
/// arbitrary one of the two.
/// </summary>
public sealed class LiveSnapshotCache
{
    // The venue list is the one thing a stored snapshot cannot survive a change to: a
    // station that no longer exists, or a venue that gained cabinets, would restore streams
    // that belong to nothing. Comparing a hash of the ids is enough to tell that apart, and
    // it keeps whole venue definitions out of the file.
    private readonly VenueRegistry _registry;
    private readonly ILogger<LiveSnapshotCache> _logger;
    private readonly string _cachePath;
    private readonly object _writeGate = new();

    private static readonly JsonSerializerOptions Format = new()
    {
        // Written as names so that reordering LiveSourceMode cannot silently change what an
        // older file means, and so the file can be read by a person debugging a restart.
        Converters = { new JsonStringEnumConverter() },
    };

    public LiveSnapshotCache(
        IOptions<VenuesOptions> options,
        VenueRegistry registry,
        IHostEnvironment environment,
        ILogger<LiveSnapshotCache> logger)
    {
        _registry = registry;
        _logger = logger;

        var configured = options.Value.LiveCachePath;
        _cachePath = Path.IsPathRooted(configured)
            ? configured
            : Path.Combine(environment.ContentRootPath, configured);
    }

    private sealed record CacheFile(string Venues, DateTimeOffset SavedAt, Dictionary<string, LiveSnapshot> Snapshots);

    /// <summary>
    /// The snapshots to start from, or nothing at all when there is no usable file. Never
    /// throws: every failure here means the app starts the way it always used to.
    /// </summary>
    public IReadOnlyDictionary<string, LiveSnapshot> Restore()
    {
        var empty = new Dictionary<string, LiveSnapshot>();

        if (!File.Exists(_cachePath))
        {
            return empty;
        }

        try
        {
            var cached = JsonSerializer.Deserialize<CacheFile>(File.ReadAllText(_cachePath), Format);
            if (cached is null)
            {
                return empty;
            }

            if (!string.Equals(cached.Venues, VenueFingerprint(), StringComparison.Ordinal))
            {
                _logger.LogInformation("The live snapshot cache was written for a different venue list; starting empty");
                return empty;
            }

            var restored = cached.Snapshots
                // A snapshot with no time was never polled, and replaying one would put the
                // page back to claiming a reading it never took.
                .Where(pair => pair.Value.UpdatedAt is not null)
                .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);

            if (restored.Count > 0)
            {
                _logger.LogInformation(
                    "Restored live snapshots for {Count} venue(s), last polled {SavedAt:u}; the first poll will replace them",
                    restored.Count,
                    cached.SavedAt);
            }

            return restored;
        }
        catch (Exception ex) when (ex is IOException or JsonException or NotSupportedException)
        {
            _logger.LogDebug(ex, "The live snapshot cache could not be read; starting empty");
            return empty;
        }
    }

    /// <summary>Writes the whole set; the caller decides how often that is worth doing.</summary>
    public void Save(IReadOnlyDictionary<string, LiveSnapshot> snapshots)
    {
        // Polls and the refresh endpoint can both publish, so one writer at a time: two
        // interleaved writes would leave a file that is neither of them.
        lock (_writeGate)
        {
            try
            {
                var payload = new CacheFile(
                    VenueFingerprint(),
                    DateTimeOffset.UtcNow,
                    snapshots.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal));

                // Written beside the real file and moved into place, so a process that dies
                // mid-write leaves the previous file intact rather than half a new one.
                var staging = _cachePath + ".tmp";
                File.WriteAllText(staging, JsonSerializer.Serialize(payload, Format));
                File.Move(staging, _cachePath, overwrite: true);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException)
            {
                // A read-only or ephemeral filesystem just means no warm start.
                _logger.LogDebug(ex, "Could not write the live snapshot cache");
            }
        }
    }

    private string VenueFingerprint()
    {
        var builder = new StringBuilder();

        foreach (var venue in _registry.All.OrderBy(venue => venue.Id, StringComparer.Ordinal))
        {
            builder.Append(venue.Id).Append('=');
            foreach (var stationId in venue.Stations.Select(station => station.Id).Order(StringComparer.Ordinal))
            {
                builder.Append(stationId).Append(',');
            }

            builder.Append(';');
        }

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(builder.ToString())));
    }
}
