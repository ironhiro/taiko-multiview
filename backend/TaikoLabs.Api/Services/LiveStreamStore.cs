using System.Collections.Concurrent;
using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Holds the most recent snapshot per venue so every request is served from memory and
/// the upstream poll rate stays constant regardless of how many viewers are connected.
///
/// The set is also mirrored to disk through <see cref="LiveSnapshotCache"/>, so a restart
/// starts from the last poll rather than from nothing. The cache is optional: without one
/// the store behaves exactly as it always has, which is what the unit tests use.
/// </summary>
public sealed class LiveStreamStore
{
    private readonly LiveSnapshotCache? _cache;
    private readonly ConcurrentDictionary<string, LiveSnapshot> _byVenue;

    public LiveStreamStore(LiveSnapshotCache? cache = null)
    {
        _cache = cache;

        IEnumerable<KeyValuePair<string, LiveSnapshot>> restored =
            cache?.Restore() ?? Enumerable.Empty<KeyValuePair<string, LiveSnapshot>>();

        _byVenue = new ConcurrentDictionary<string, LiveSnapshot>(restored, StringComparer.OrdinalIgnoreCase);
    }

    public LiveSnapshot For(string venueId) =>
        _byVenue.GetValueOrDefault(venueId, LiveSnapshot.NeverPolled);

    /// <summary>
    /// Publishes a new snapshot. A failed poll keeps the last good stream list so a
    /// transient upstream error does not blank the whole wall.
    /// </summary>
    public void Publish(string venueId, LiveSnapshot snapshot)
    {
        _byVenue.AddOrUpdate(
            venueId,
            snapshot,
            (_, existing) => snapshot.Error is not null && existing.Streams.Count > 0
                ? existing with { Error = snapshot.Error }
                : snapshot);

        // Written on every publish rather than on a timer of its own: a poll round is a
        // handful of venues a minute, and the point of the file is to be current when the
        // process is killed without warning.
        _cache?.Save(_byVenue);
    }
}
