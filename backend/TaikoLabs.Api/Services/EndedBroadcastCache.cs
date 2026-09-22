using System.Collections.Concurrent;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Remembers broadcasts already confirmed finished.
///
/// A stream never goes live again once it has ended, so checking one a second time
/// can only ever produce the same answer. Holding this outside <see cref="PublicLiveProbe"/>
/// matters because a typed HttpClient registration is transient: state kept on the
/// probe itself would be discarded after every poll.
/// </summary>
public sealed class EndedBroadcastCache
{
    private const int Limit = 2_000;

    private readonly ConcurrentDictionary<string, byte> _ended = new(StringComparer.Ordinal);

    public int Count => _ended.Count;

    public bool Contains(string videoId) => _ended.ContainsKey(videoId);

    public void Add(string videoId)
    {
        // Only ever grows with newly published videos, but stay bounded regardless.
        if (_ended.Count >= Limit)
        {
            _ended.Clear();
        }

        _ended.TryAdd(videoId, 0);
    }
}
