using System.Collections.Concurrent;
using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Holds the most recent snapshot per venue so every request is served from memory and
/// the upstream poll rate stays constant regardless of how many viewers are connected.
/// </summary>
public sealed class LiveStreamStore
{
    private readonly ConcurrentDictionary<string, LiveSnapshot> _byVenue = new(StringComparer.OrdinalIgnoreCase);

    public LiveSnapshot For(string venueId) =>
        _byVenue.GetValueOrDefault(venueId, LiveSnapshot.Empty(LiveSourceMode.Auto));

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
    }
}
