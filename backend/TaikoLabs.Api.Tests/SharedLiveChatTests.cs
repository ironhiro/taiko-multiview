using Microsoft.Extensions.Logging.Abstractions;
using TaikoLabs.Api.Models;
using TaikoLabs.Api.Services;

namespace TaikoLabs.Api.Tests;

/// <summary>
/// One read of YouTube per broadcast a polling interval, whoever is reading: what must hold is
/// that viewers within the interval cost nothing, that viewers arriving together wait on the
/// one read under way, that each viewer gets each message once, and that a broadcast nobody
/// reads is let go. YouTube is a counting stand-in here.
/// </summary>
public class SharedLiveChatTests
{
    private readonly GoogleSignInTests.ManualClock _clock = new();

    private SharedLiveChat NewChat() => new(_clock, NullLogger<SharedLiveChat>.Instance);

    /// <summary>A stand-in for YouTube: each read a page of one new message, counted, with the token it was asked from.</summary>
    private sealed class YouTube
    {
        public List<string?> Asked { get; } = [];

        public int PollingIntervalMillis { get; set; } = 5000;

        public LiveChatFailure Failure { get; set; } = LiveChatFailure.None;

        public Task<LiveChatRead> Read(string? pageToken, CancellationToken ct)
        {
            lock (Asked)
            {
                Asked.Add(pageToken);
                var number = Asked.Count;
                return Task.FromResult(Failure == LiveChatFailure.None
                    ? new LiveChatRead(LiveChatFailure.None, new ChatMessagesResponse
                    {
                        Messages = [new ChatMessageInfo($"m{number}", "동카", $"메시지 {number}", null)],
                        NextPageToken = $"yt-{number}",
                        PollingIntervalMillis = PollingIntervalMillis,
                    })
                    : LiveChatRead.Fail(Failure));
            }
        }
    }

    private static IEnumerable<string> Ids(LiveChatRead read) => read.Page!.Messages.Select(message => message.Id);

    [Fact]
    public async Task Three_viewers_within_the_interval_cost_one_read()
    {
        var chat = NewChat();
        var youTube = new YouTube();

        var reads = new List<LiveChatRead>();
        for (var viewer = 0; viewer < 3; viewer++)
        {
            reads.Add(await chat.ReadAsync("video-1", null, youTube.Read, CancellationToken.None));
            _clock.Advance(TimeSpan.FromSeconds(1));
        }

        Assert.Single(youTube.Asked);
        Assert.All(reads, read => Assert.Equal(["m1"], Ids(read)));
        Assert.All(reads, read => Assert.Equal(5000, read.Page!.PollingIntervalMillis));
    }

    [Fact]
    public async Task Viewers_arriving_together_wait_on_the_one_read_under_way()
    {
        var chat = NewChat();
        var started = 0;
        var answer = new TaskCompletionSource<LiveChatRead>(TaskCreationOptions.RunContinuationsAsynchronously);
        Task<LiveChatRead> Slow(string? pageToken, CancellationToken ct)
        {
            Interlocked.Increment(ref started);
            return answer.Task;
        }

        var reads = Enumerable.Range(0, 3).Select(_ => chat.ReadAsync("video-1", null, Slow, CancellationToken.None)).ToList();
        await Task.Delay(50);
        answer.SetResult(new LiveChatRead(LiveChatFailure.None, new ChatMessagesResponse
        {
            Messages = [new ChatMessageInfo("m1", "동카", "안녕", null)],
            NextPageToken = "yt-1",
            PollingIntervalMillis = 5000,
        }));

        foreach (var read in await Task.WhenAll(reads))
        {
            Assert.Equal(["m1"], Ids(read));
        }

        Assert.Equal(1, started);
    }

    [Fact]
    public async Task Past_the_interval_one_more_read_from_where_youtube_left_off_and_a_viewer_gets_only_what_is_new()
    {
        var chat = NewChat();
        var youTube = new YouTube();
        var first = await chat.ReadAsync("video-1", null, youTube.Read, CancellationToken.None);

        _clock.Advance(TimeSpan.FromMilliseconds(4999));
        var early = await chat.ReadAsync("video-1", first.Page!.NextPageToken, youTube.Read, CancellationToken.None);
        Assert.Empty(early.Page!.Messages);
        Assert.Single(youTube.Asked);

        _clock.Advance(TimeSpan.FromMilliseconds(1));
        var due = await chat.ReadAsync("video-1", early.Page.NextPageToken, youTube.Read, CancellationToken.None);
        var other = await chat.ReadAsync("video-1", early.Page.NextPageToken, youTube.Read, CancellationToken.None);

        Assert.Equal([null, "yt-1"], youTube.Asked);
        Assert.Equal(["m2"], Ids(due));
        Assert.Equal(["m2"], Ids(other));
        // A viewer opening now gets everything kept.
        Assert.Equal(["m1", "m2"], Ids(await chat.ReadAsync("video-1", null, youTube.Read, CancellationToken.None)));
    }

    [Fact]
    public async Task YouTubes_interval_is_kept_to_five_seconds_at_least()
    {
        var chat = NewChat();
        var youTube = new YouTube { PollingIntervalMillis = 1000 };
        var first = await chat.ReadAsync("video-1", null, youTube.Read, CancellationToken.None);

        _clock.Advance(TimeSpan.FromSeconds(2));
        await chat.ReadAsync("video-1", first.Page!.NextPageToken, youTube.Read, CancellationToken.None);

        Assert.Single(youTube.Asked);
        Assert.Equal(GoogleSignInClient.MinPollingIntervalMillis, first.Page.PollingIntervalMillis);
    }

    [Fact]
    public async Task Each_broadcast_is_read_on_its_own()
    {
        var chat = NewChat();
        var one = new YouTube();
        var two = new YouTube();

        await chat.ReadAsync("video-1", null, one.Read, CancellationToken.None);
        await chat.ReadAsync("video-2", null, two.Read, CancellationToken.None);
        await chat.ReadAsync("video-1", null, one.Read, CancellationToken.None);

        Assert.Single(one.Asked);
        Assert.Single(two.Asked);
    }

    [Fact]
    public async Task A_message_sent_is_in_every_next_read_once_and_youtube_bringing_it_tells_it_again_in_its_place()
    {
        var chat = NewChat();
        var youTube = new YouTube();
        var first = await chat.ReadAsync("video-1", null, youTube.Read, CancellationToken.None);

        chat.AddSent("video-1", new ChatMessageInfo("sent-1", "홍길동", "안녕", null));
        var next = await chat.ReadAsync("video-1", first.Page!.NextPageToken, youTube.Read, CancellationToken.None);
        Assert.Equal(["sent-1"], Ids(next));
        Assert.Single(youTube.Asked);

        // YouTube brings it under the same id, by the channel's name.
        _clock.Advance(TimeSpan.FromSeconds(5));
        var sameAgain = new ChatMessagesResponse
        {
            Messages = [new ChatMessageInfo("sent-1", "홍길동 채널", "안녕", null)],
            NextPageToken = "yt-2",
            PollingIntervalMillis = 5000,
        };
        var later = await chat.ReadAsync(
            "video-1",
            next.Page!.NextPageToken,
            (_, _) => Task.FromResult(new LiveChatRead(LiveChatFailure.None, sameAgain)),
            CancellationToken.None);

        Assert.Equal("홍길동 채널", Assert.Single(later.Page!.Messages).Author);
        var everything = await chat.ReadAsync("video-1", null, youTube.Read, CancellationToken.None);
        Assert.Equal(["m1", "sent-1"], Ids(everything));
        Assert.Equal("홍길동 채널", everything.Page!.Messages[1].Author);
    }

    [Fact]
    public async Task A_broadcast_nobody_reads_for_five_minutes_is_let_go_and_an_old_place_in_it_reads_from_the_start()
    {
        var chat = NewChat();
        var youTube = new YouTube();
        var first = await chat.ReadAsync("video-1", null, youTube.Read, CancellationToken.None);
        await chat.ReadAsync("video-2", null, youTube.Read, CancellationToken.None);
        Assert.Equal(2, chat.BroadcastCount);

        // video-2 is read now and then; video-1 not at all.
        for (var minute = 0; minute < 6; minute++)
        {
            _clock.Advance(TimeSpan.FromMinutes(1));
            await chat.ReadAsync("video-2", null, youTube.Read, CancellationToken.None);
        }

        Assert.Equal(1, chat.BroadcastCount);

        // Back to video-1 with the place from before: a new copy, read from YouTube anew, all of it.
        var back = await chat.ReadAsync("video-1", first.Page!.NextPageToken, youTube.Read, CancellationToken.None);
        Assert.Single(back.Page!.Messages);
        Assert.Null(youTube.Asked[^1]);
    }

    [Fact]
    public async Task A_failed_read_is_the_answer_for_a_while_rather_than_every_viewer_asking_again()
    {
        var chat = NewChat();
        var youTube = new YouTube { Failure = LiveChatFailure.QuotaExceeded };

        Assert.Equal(LiveChatFailure.QuotaExceeded, (await chat.ReadAsync("video-1", null, youTube.Read, CancellationToken.None)).Failure);
        Assert.Equal(LiveChatFailure.QuotaExceeded, (await chat.ReadAsync("video-1", null, youTube.Read, CancellationToken.None)).Failure);
        Assert.Single(youTube.Asked);

        _clock.Advance(TimeSpan.FromSeconds(10));
        youTube.Failure = LiveChatFailure.None;
        Assert.Equal(LiveChatFailure.None, (await chat.ReadAsync("video-1", null, youTube.Read, CancellationToken.None)).Failure);
        Assert.Equal(2, youTube.Asked.Count);
    }

    [Fact]
    public async Task Another_viewers_token_turned_down_sends_this_viewer_to_read_with_their_own()
    {
        var chat = NewChat();
        var answer = new TaskCompletionSource<LiveChatRead>(TaskCreationOptions.RunContinuationsAsynchronously);
        var theirs = chat.ReadAsync("video-1", null, (_, _) => answer.Task, CancellationToken.None);
        await Task.Delay(20);
        var mineAsked = 0;
        var mine = chat.ReadAsync(
            "video-1",
            null,
            (_, _) =>
            {
                mineAsked++;
                return Task.FromResult(new LiveChatRead(LiveChatFailure.None, new ChatMessagesResponse { Messages = [new ChatMessageInfo("m1", "a", "b", null)] }));
            },
            CancellationToken.None);

        answer.SetResult(LiveChatRead.Fail(LiveChatFailure.Unauthorized));

        // Theirs is theirs to renew; this viewer reads on its own token.
        Assert.Equal(LiveChatFailure.Unauthorized, (await theirs).Failure);
        Assert.Equal(["m1"], Ids(await mine));
        Assert.Equal(1, mineAsked);
    }

    [Fact]
    public async Task It_keeps_the_newest_two_hundred()
    {
        var chat = NewChat();
        var youTube = new YouTube();
        await chat.ReadAsync("video-1", null, youTube.Read, CancellationToken.None);
        for (var i = 0; i < SharedLiveChat.MaxMessages; i++)
        {
            chat.AddSent("video-1", new ChatMessageInfo($"sent-{i}", "a", "b", null));
        }

        var everything = await chat.ReadAsync("video-1", null, youTube.Read, CancellationToken.None);

        Assert.Equal(SharedLiveChat.MaxMessages, everything.Page!.Messages.Count);
        Assert.Equal("sent-0", everything.Page.Messages[0].Id);
        Assert.Equal($"sent-{SharedLiveChat.MaxMessages - 1}", everything.Page.Messages[^1].Id);
    }
}
