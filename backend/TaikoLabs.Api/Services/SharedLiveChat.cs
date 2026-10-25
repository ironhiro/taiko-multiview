using System.Collections.Concurrent;
using System.Globalization;
using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Each broadcast's live chat, read from YouTube once for everyone reading it here. A read is
/// liveChatMessages.list, 5 units of quota each: one read per viewer every few seconds would
/// spend a project's day in a few viewer-hours, where one read per broadcast costs the same
/// with one viewer or fifty.
///
/// The server keeps the broadcast's recent messages (the newest <see cref="MaxMessages"/>),
/// where YouTube's paging left off, and how long YouTube asked to wait. A viewer's read within
/// that wait is answered from what is kept; the first read after it goes to YouTube, and reads
/// that come while it is out wait for that one rather than send their own. A viewer's place in
/// the chat is a number of the server's own (<see cref="ChatMessagesResponse.NextPageToken"/>,
/// opaque to the page), not YouTube's page token, which is the broadcast's alone. A broadcast
/// nobody has asked about for <see cref="IdleLifetime"/> is let go.
///
/// Messages written here go in as they are sent, so every viewer has them at their next read;
/// YouTube bringing the same message later (the same id) updates it where it is.
///
/// The read itself is the caller's (<see cref="FetchPage"/>): GoogleSignInEndpoints makes it
/// with the token of the signed-in viewer whose request found the copy stale, so the chat is
/// charged to the OAuth client's project and never to the venue polls' API key.
/// </summary>
public sealed class SharedLiveChat(TimeProvider clock, ILogger<SharedLiveChat> logger)
{
    /// <summary>The most messages kept for a broadcast; older ones fall off the top.</summary>
    public const int MaxMessages = 200;

    /// <summary>How long a broadcast nobody asks about is kept.</summary>
    public static readonly TimeSpan IdleLifetime = TimeSpan.FromMinutes(5);

    /// <summary>When YouTube names no wait.</summary>
    public const int DefaultPollingIntervalMillis = 10_000;

    /// <summary>
    /// After a read that failed - YouTube having a moment, or the quota spent - the failure is
    /// the answer for a while, rather than every viewer's next read trying again at once.
    /// </summary>
    private static readonly TimeSpan FailureHold = TimeSpan.FromSeconds(10);

    /// <summary>A chat YouTube says has ended stays ended for a while before it is asked again.</summary>
    private static readonly TimeSpan NotLiveHold = TimeSpan.FromSeconds(30);

    private static readonly TimeSpan SweepEvery = TimeSpan.FromMinutes(1);

    /// <summary>Bounded, as the video ids come from requests (signed-in ones, but still).</summary>
    private const int MaxBroadcasts = 500;

    /// <summary>One read of YouTube for a broadcast: the page after <c>youTubePageToken</c>.</summary>
    public delegate Task<LiveChatRead> FetchPage(string? youTubePageToken, CancellationToken ct);

    private readonly ConcurrentDictionary<string, ChatBuffer> _broadcasts = new(StringComparer.Ordinal);
    private readonly Lock _sweepLock = new();
    private DateTimeOffset _lastSweep = DateTimeOffset.MinValue;
    private long _generations;

    internal int BroadcastCount => _broadcasts.Count;

    /// <summary>
    /// The messages after <paramref name="cursor"/> (a <see cref="ChatMessagesResponse.NextPageToken"/>
    /// this gave before; none for everything kept), from what is kept while it is fresh, and from
    /// one read of YouTube - <paramref name="fetch"/>, this viewer's or another's under way - when
    /// it is not.
    /// </summary>
    public async Task<LiveChatRead> ReadAsync(string videoId, string? cursor, FetchPage fetch, CancellationToken ct)
    {
        Sweep();
        var buffer = _broadcasts.GetOrAdd(videoId, _ => new ChatBuffer(Interlocked.Increment(ref _generations)));

        // Twice at most: a read another viewer started may come back with their token turned
        // down - nothing to do with this viewer - and then this one reads with its own.
        for (var attempt = 0; ; attempt++)
        {
            Task<LiveChatRead> pending;
            var mine = false;
            lock (buffer)
            {
                var now = clock.GetUtcNow();
                buffer.LastAsked = now;
                if (buffer.HeldFailure is { } held && now < buffer.HeldUntil)
                {
                    return LiveChatRead.Fail(held);
                }

                if (buffer.IsFresh(now))
                {
                    return new LiveChatRead(LiveChatFailure.None, buffer.After(cursor));
                }

                if (buffer.InFlight is null)
                {
                    buffer.InFlight = FetchAndKeepAsync(buffer, fetch);
                    mine = true;
                }

                pending = buffer.InFlight;
            }

            var read = await pending.WaitAsync(ct);
            if (read.Failure == LiveChatFailure.Unauthorized && !mine && attempt == 0)
            {
                continue;
            }

            if (read.Failure != LiveChatFailure.None)
            {
                return read;
            }

            lock (buffer)
            {
                return new LiveChatRead(LiveChatFailure.None, buffer.After(cursor));
            }
        }
    }

    /// <summary>A message written here, for every viewer's next read.</summary>
    public void AddSent(string videoId, ChatMessageInfo message)
    {
        Sweep();
        var buffer = _broadcasts.GetOrAdd(videoId, _ => new ChatBuffer(Interlocked.Increment(ref _generations)));
        lock (buffer)
        {
            buffer.LastAsked = clock.GetUtcNow();
            buffer.Put(message);
        }
    }

    // Not tied to the request that started it: the others waiting on it would go without.
    // The HttpClient's own timeout bounds it.
    private async Task<LiveChatRead> FetchAndKeepAsync(ChatBuffer buffer, FetchPage fetch)
    {
        // Out from under the caller's lock before anything else, so InFlight is set before it is cleared.
        await Task.Yield();

        string? pageToken;
        lock (buffer)
        {
            pageToken = buffer.YouTubePageToken;
        }

        LiveChatRead read;
        try
        {
            read = await fetch(pageToken, CancellationToken.None);
        }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException)
        {
            logger.LogWarning("Live chat read failed: {Error}", error.GetType().Name);
            read = LiveChatRead.Fail(LiveChatFailure.Failed);
        }

        lock (buffer)
        {
            buffer.InFlight = null;
            var now = clock.GetUtcNow();
            switch (read.Failure)
            {
                case LiveChatFailure.None:
                    buffer.Take(read.Page!, now);
                    buffer.HeldFailure = null;
                    break;
                case LiveChatFailure.Unauthorized:
                    // One viewer's token; another's may do. Nothing held.
                    break;
                case LiveChatFailure.NotLive:
                    buffer.YouTubePageToken = null;
                    buffer.HeldFailure = LiveChatFailure.NotLive;
                    buffer.HeldUntil = now + NotLiveHold;
                    break;
                default:
                    buffer.HeldFailure = read.Failure;
                    buffer.HeldUntil = now + FailureHold;
                    break;
            }
        }

        return read;
    }

    private void Sweep()
    {
        var now = clock.GetUtcNow();
        lock (_sweepLock)
        {
            if (now - _lastSweep < SweepEvery && _broadcasts.Count < MaxBroadcasts)
            {
                return;
            }

            _lastSweep = now;
        }

        var idle = _broadcasts
            .Where(pair => pair.Value.CanLetGo(now - IdleLifetime))
            .Select(pair => pair.Key)
            .ToList();
        foreach (var videoId in idle)
        {
            _broadcasts.TryRemove(videoId, out _);
        }

        // Still too many, all asked about lately: the longest unasked go first.
        var over = _broadcasts.Count - MaxBroadcasts + 1;
        if (over > 0)
        {
            foreach (var videoId in _broadcasts.OrderBy(pair => pair.Value.LastAsked).Take(over).Select(pair => pair.Key).ToList())
            {
                _broadcasts.TryRemove(videoId, out _);
            }
        }
    }

    /// <summary>One broadcast's chat as kept here. Every member is used under a lock on the buffer.</summary>
    private sealed class ChatBuffer(long generation)
    {
        private readonly List<(long Number, ChatMessageInfo Message)> _messages = [];
        private long _lastNumber;

        public DateTimeOffset LastAsked { get; set; }

        public string? YouTubePageToken { get; set; }

        public DateTimeOffset? FetchedAt { get; private set; }

        public int PollingIntervalMillis { get; private set; } = DefaultPollingIntervalMillis;

        public Task<LiveChatRead>? InFlight { get; set; }

        public LiveChatFailure? HeldFailure { get; set; }

        public DateTimeOffset HeldUntil { get; set; }

        public bool IsFresh(DateTimeOffset now) =>
            FetchedAt is { } fetched && now < fetched.AddMilliseconds(PollingIntervalMillis);

        public bool CanLetGo(DateTimeOffset askedBefore)
        {
            lock (this)
            {
                return InFlight is null && LastAsked < askedBefore;
            }
        }

        public void Take(ChatMessagesResponse page, DateTimeOffset now)
        {
            foreach (var message in page.Messages)
            {
                Put(message);
            }

            YouTubePageToken = page.NextPageToken ?? YouTubePageToken;
            PollingIntervalMillis = Math.Max(page.PollingIntervalMillis ?? DefaultPollingIntervalMillis, GoogleSignInClient.MinPollingIntervalMillis);
            FetchedAt = now;
        }

        /// <summary>
        /// A message added after the rest, or - one already kept, under the same id - told as
        /// it is now, where it was, and numbered anew so viewers who had it get it again.
        /// </summary>
        public void Put(ChatMessageInfo message)
        {
            var index = _messages.FindIndex(kept => kept.Message.Id == message.Id);
            if (index >= 0)
            {
                if (_messages[index].Message != message)
                {
                    _messages[index] = (++_lastNumber, message);
                }

                return;
            }

            _messages.Add((++_lastNumber, message));
            if (_messages.Count > MaxMessages)
            {
                _messages.RemoveRange(0, _messages.Count - MaxMessages);
            }
        }

        /// <summary>
        /// What came after the viewer's place, and their new place. A place from another
        /// generation - the broadcast was let go and asked about again since - counts as none.
        /// </summary>
        public ChatMessagesResponse After(string? cursor)
        {
            var after = ReadCursor(cursor) is (var cursorGeneration, var number) && cursorGeneration == generation ? number : 0;
            return new ChatMessagesResponse
            {
                Messages = _messages.Where(kept => kept.Number > after).Select(kept => kept.Message).ToList(),
                NextPageToken = string.Create(CultureInfo.InvariantCulture, $"{generation}.{_lastNumber}"),
                PollingIntervalMillis = PollingIntervalMillis,
            };
        }

        private static (long Generation, long Number)? ReadCursor(string? cursor)
        {
            var dot = cursor?.IndexOf('.') ?? -1;
            return dot > 0
                   && long.TryParse(cursor!.AsSpan(0, dot), NumberStyles.None, CultureInfo.InvariantCulture, out var cursorGeneration)
                   && long.TryParse(cursor!.AsSpan(dot + 1), NumberStyles.None, CultureInfo.InvariantCulture, out var number)
                ? (cursorGeneration, number)
                : null;
        }
    }
}
