using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using TaikoLabs.Api.Models;
using TaikoLabs.Api.Services;

namespace TaikoLabs.Api.Tests;

/// <summary>다시보기: which finished broadcasts are kept, how they are grouped, and what they cost.</summary>
public class ReplayTests
{
    private static readonly Venue Venue = TestVenues.Create(TestVenues.TaikoLabs());
    private static readonly TimeZoneInfo Seoul = TestVenues.Seoul;

    // ------------------------------------------------------------ what is kept

    [Fact]
    public void A_finished_public_broadcast_is_kept_with_its_cabinet_part_and_times()
    {
        var reading = Assert.Single(Read(Video("v1", "TAIKO LABS A1 Live Streaming 26.10.08 - 2부", "none", start: "2026-10-08T08:00:00Z", end: "2026-10-08T13:00:00Z")));

        var past = reading.AsPastBroadcast();

        Assert.NotNull(past);
        Assert.Equal("A1", past.Name);
        Assert.Equal(2, past.Part);
        Assert.Equal("26.10.08", past.StreamDate);
        Assert.Equal(DateTimeOffset.Parse("2026-10-08T13:00:00Z"), past.EndedAt);
    }

    [Theory]
    [InlineData("live")]
    [InlineData("upcoming")]
    public void A_broadcast_still_live_or_yet_to_start_is_not_a_replay(string content)
    {
        var reading = Assert.Single(Read(Video("v1", "TAIKO LABS A1 Live Streaming 26.10.09 - 1부", content, start: "2026-10-09T01:00:00Z", end: null)));

        Assert.Null(reading.AsPastBroadcast());
    }

    [Fact]
    public void YouTube_still_flagging_a_broadcast_live_after_it_ended_keeps_it_out_until_it_stops()
    {
        // An end time with the flag still on: the wall keeps treating it as live, so 다시보기
        // waits for YouTube to settle rather than list a broadcast twice.
        var reading = Assert.Single(Read(Video("v1", "TAIKO LABS A1 Live Streaming 26.10.09 - 1부", "live", start: "2026-10-09T01:00:00Z", end: "2026-10-09T05:00:00Z")));

        Assert.Null(reading.AsPastBroadcast());
    }

    [Theory]
    [InlineData("private")]
    [InlineData("unlisted")]
    public void A_broadcast_that_is_not_public_is_not_a_replay(string privacy)
    {
        var reading = Assert.Single(Read(Video("v1", "TAIKO LABS A1 Live Streaming 26.10.08 - 1부", "none", start: "2026-10-08T01:00:00Z", end: "2026-10-08T05:00:00Z", privacy: privacy)));

        Assert.False(reading.IsPublic);
        Assert.Null(reading.AsPastBroadcast());
    }

    [Fact]
    public void A_plain_upload_and_a_false_start_are_not_replays()
    {
        var readings = Read(
            Video("upload", "TAIKO LABS A1 Live Streaming 26.10.08 - 1부", "none", start: null, end: null),
            Video("blip", "TAIKO LABS A2 Live Streaming 26.10.08 - 1부", "none", start: "2026-10-08T01:00:00Z", end: "2026-10-08T01:00:40Z"));

        Assert.All(readings, reading => Assert.Null(reading.AsPastBroadcast()));
    }

    [Fact]
    public void A_title_that_is_not_a_broadcast_of_the_venue_is_never_read()
    {
        Assert.Empty(Read(Video("v1", "Some other upload", "none", start: "2026-10-08T01:00:00Z", end: "2026-10-08T05:00:00Z")));
    }

    // ------------------------------------------------------------ the archive

    [Fact]
    public void A_broadcast_that_is_deleted_or_made_private_leaves_the_archive()
    {
        var stored = new Dictionary<string, PastBroadcast>
        {
            ["gone"] = Past("gone", "A1", "2026-10-08T01:00:00Z"),
            ["private"] = Past("private", "A2", "2026-10-08T01:00:00Z"),
            ["kept"] = Past("kept", "BASE", "2026-10-08T01:00:00Z"),
            ["unchecked"] = Past("unchecked", "A1", "2026-10-07T01:00:00Z"),
        };

        // The poll asked about three of them: "gone" did not come back at all (deleted), and
        // "private" came back but not public. The fourth was not on the page it read.
        var changed = ReplayArchive.Apply(
            stored,
            new ReplayHarvest([], Checked: ["gone", "private", "kept"], StillPublic: ["kept"]),
            DateTimeOffset.Parse("2026-10-01T00:00:00Z"));

        Assert.True(changed);
        Assert.Equal(["kept", "unchecked"], stored.Keys.Order());
    }

    [Fact]
    public void Broadcasts_older_than_the_window_are_dropped_and_not_taken_in()
    {
        var stored = new Dictionary<string, PastBroadcast> { ["old"] = Past("old", "A1", "2026-09-20T01:00:00Z") };

        ReplayArchive.Apply(
            stored,
            new ReplayHarvest([Past("older", "A1", "2026-09-19T01:00:00Z"), Past("new", "A1", "2026-10-08T01:00:00Z")], [], []),
            DateTimeOffset.Parse("2026-10-01T00:00:00Z"));

        Assert.Equal(["new"], stored.Keys);
    }

    [Fact]
    public void Hearing_the_same_broadcast_again_changes_nothing()
    {
        var broadcast = Past("v1", "A1", "2026-10-08T01:00:00Z");
        var stored = new Dictionary<string, PastBroadcast> { ["v1"] = broadcast };

        var changed = ReplayArchive.Apply(stored, new ReplayHarvest([broadcast], ["v1"], ["v1"]), DateTimeOffset.Parse("2026-10-01T00:00:00Z"));

        Assert.False(changed);
    }

    [Fact]
    public void The_archive_survives_a_restart_and_the_next_start_reads_back_only_to_its_file()
    {
        var path = Path.Combine(Path.GetTempPath(), $"taiko-replay-{Guid.NewGuid():N}.json");
        var clock = new TestClock(DateTimeOffset.Parse("2026-10-09T03:00:00Z"));
        try
        {
            var first = Archive(path, clock);
            // Nothing remembered: the first poll may read back the whole 30 days and a day.
            Assert.Equal(clock.Now.AddDays(-31), first.BackfillSince("taikolabs"));

            first.Record(Venue, Seoul, new ReplayHarvest([Past("v1", "A1", "2026-10-08T01:00:00Z")], [], [], Backfilled: true));
            Assert.Null(first.BackfillSince("taikolabs"));

            clock.Now += TimeSpan.FromMinutes(10);
            var second = Archive(path, clock);

            Assert.Equal(["v1"], second.For("taikolabs").Select(broadcast => broadcast.VideoId));
            // Restored: only the time since the file was written (and an hour of overlap) is read.
            Assert.Equal(DateTimeOffset.Parse("2026-10-09T02:00:00Z"), second.BackfillSince("taikolabs"));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Without_backfill_pages_nothing_is_ever_read_back()
    {
        var archive = Archive(path: null, new TestClock(DateTimeOffset.UtcNow), backfillPages: 0);

        Assert.Null(archive.BackfillSince("taikolabs"));
    }

    // ------------------------------------------------------------ grouping

    [Fact]
    public void Broadcasts_group_by_day_then_part_then_cabinet_in_the_venues_order()
    {
        var days = ReplayArchive.Group(
            Venue,
            Seoul,
            [
                Past("y-base-1", "THE BASE", "2026-10-08T01:00:00Z", part: 1, date: "26.10.08"),
                Past("y-a1-2", "A1", "2026-10-08T08:00:00Z", part: 2, date: "26.10.08"),
                Past("y-a1-1", "A1", "2026-10-08T01:01:00Z", part: 1, date: "26.10.08"),
                Past("y-new-1", "B9", "2026-10-08T01:02:00Z", part: 1, date: "26.10.08"),
                Past("d-a1-1", "A1", "2026-10-07T01:00:00Z", part: 1, date: "26.10.07"),
            ],
            DateOnly.Parse("2026-10-01"));

        Assert.Equal([DateOnly.Parse("2026-10-08"), DateOnly.Parse("2026-10-07")], days.Select(day => day.Date));
        Assert.Equal([1, 2], days[0].Sessions.Select(session => session.Session));
        Assert.All(days[0].Sessions, session => Assert.True(session.FromTitle));

        // The venue's cabinets in its order (A1 before THE BASE), the unlisted one last.
        var first = days[0].Sessions[0].Broadcasts;
        Assert.Equal(["y-a1-1", "y-base-1", "y-new-1"], first.Select(broadcast => broadcast.VideoId));
        Assert.Equal(["a1", "base", null], first.Select(broadcast => broadcast.StationId));
        Assert.Equal(DateTimeOffset.Parse("2026-10-08T01:00:00Z"), days[0].Sessions[0].StartedAt);
    }

    [Fact]
    public void Without_a_part_in_the_title_a_cabinets_nth_broadcast_of_the_day_is_its_nth_session()
    {
        var days = ReplayArchive.Group(
            Venue,
            Seoul,
            [
                Past("late", "A1", "2026-10-08T09:00:00Z"),
                Past("early", "A1", "2026-10-08T02:00:00Z"),
                Past("other", "THE BASE", "2026-10-08T03:00:00Z"),
            ],
            DateOnly.Parse("2026-10-01"));

        var day = Assert.Single(days);
        Assert.Equal([1, 2], day.Sessions.Select(session => session.Session));
        Assert.All(day.Sessions, session => Assert.False(session.FromTitle));
        Assert.Equal(["early", "other"], day.Sessions[0].Broadcasts.Select(broadcast => broadcast.VideoId));
        Assert.Equal(["late"], day.Sessions[1].Broadcasts.Select(broadcast => broadcast.VideoId));
    }

    [Fact]
    public void A_broadcast_after_midnight_in_a_window_running_late_belongs_to_the_day_it_opened()
    {
        // Friday's window is 10:00-29:00. 01:30 on Saturday is still Friday's business.
        var afterMidnight = Past("v1", "A1", "2026-10-09T16:30:00Z"); // Sat 01:30 in Seoul

        Assert.Equal(DateOnly.Parse("2026-10-09"), ReplayArchive.BroadcastDay(Venue, Seoul, afterMidnight));

        // Saturday 08:00 is past Friday's close: Saturday's own day.
        var morning = Past("v2", "A1", "2026-10-09T23:00:00Z"); // Sat 08:00 in Seoul
        Assert.Equal(DateOnly.Parse("2026-10-10"), ReplayArchive.BroadcastDay(Venue, Seoul, morning));
    }

    [Theory]
    [InlineData("26.10.08", "2026-10-08")]
    [InlineData("2026-10-8", "2026-10-08")]
    [InlineData("2026-10-08", "2026-10-08")]
    public void The_titles_date_names_the_day_in_the_forms_venues_write_it(string written, string expected)
    {
        // Started 00:30 on the 9th by the clock (a Thursday, whose window ended at 24:00).
        var broadcast = Past("v1", "A1", "2026-10-08T15:30:00Z", date: written);

        Assert.Equal(DateOnly.Parse(expected), ReplayArchive.BroadcastDay(Venue, Seoul, broadcast));
    }

    [Fact]
    public void A_title_date_far_from_the_start_is_taken_for_a_typo_and_ignored()
    {
        var broadcast = Past("v1", "A1", "2026-10-08T03:00:00Z", date: "25.10.08");

        Assert.Equal(DateOnly.Parse("2026-10-08"), ReplayArchive.BroadcastDay(Venue, Seoul, broadcast));
    }

    [Fact]
    public void Days_before_the_window_are_not_served()
    {
        var days = ReplayArchive.Group(
            Venue,
            Seoul,
            [Past("in", "A1", "2026-10-08T03:00:00Z"), Past("out", "A1", "2026-09-30T03:00:00Z")],
            DateOnly.Parse("2026-10-02"));

        Assert.Equal(["in"], days.SelectMany(day => day.Sessions).SelectMany(session => session.Broadcasts).Select(broadcast => broadcast.VideoId));
    }

    // ------------------------------------------------------------ how far back

    private static readonly DateOnly Today = DateOnly.Parse("2026-10-10");

    private static DateOnly[] DaysBack(params int[] back) => [.. back.Select(days => Today.AddDays(-days))];

    [Fact]
    public void A_busy_venue_keeps_today_and_its_last_seven_days()
    {
        var shown = ReplayArchive.Window(DaysBack([.. Enumerable.Range(0, 16)]), Today, pastDays: 7, maxAgeDays: 30);

        Assert.Equal(DaysBack(0, 1, 2, 3, 4, 5, 6, 7), shown.Order().Reverse());
    }

    [Fact]
    public void A_quiet_venue_keeps_its_last_seven_days_with_broadcasts_from_up_to_a_month_back()
    {
        var shown = ReplayArchive.Window(DaysBack(1, 5, 12, 20, 25, 29, 30, 40), Today, pastDays: 7, maxAgeDays: 30);

        Assert.Equal(DaysBack(1, 5, 12, 20, 25, 29, 30), shown.Order().Reverse());
    }

    [Fact]
    public void Thirty_days_back_is_in_and_thirty_one_is_out_however_few_days_there_are()
    {
        var shown = ReplayArchive.Window(DaysBack(3, 30, 31), Today, pastDays: 7, maxAgeDays: 30);

        Assert.Equal(DaysBack(3, 30), shown.Order().Reverse());
    }

    [Fact]
    public void The_archive_drops_the_days_past_those_it_shows()
    {
        // Days 1-9 back at 12:00 in Seoul, one broadcast each: the 8th and 9th go.
        var stored = Enumerable.Range(1, 9)
            .Select(back => Past($"d{back}", "A1", $"{Today.AddDays(-back):yyyy-MM-dd}T03:00:00Z"))
            .ToDictionary(broadcast => broadcast.VideoId, StringComparer.Ordinal);

        var changed = ReplayArchive.KeepWindow(stored, Venue, Seoul, Today, pastDays: 7, maxAgeDays: 30);

        Assert.True(changed);
        Assert.Equal(["d1", "d2", "d3", "d4", "d5", "d6", "d7"], stored.Keys.Order());
    }

    [Fact]
    public async Task A_backfill_for_a_busy_venue_stops_once_it_has_the_days_it_wants()
    {
        // Pages newest first, each with finished broadcasts: days 1-2, 3-5, 6-8, then 9-10.
        // Eight days before today - one more than the seven wanted, so the 7th is whole - come
        // with the third page, and the fourth is never read.
        int[][] pages = [[1, 2], [3, 4, 5], [6, 7, 8], [9, 10]];
        var handler = DaysHandler(pages);

        var (_, harvest) = await Client(handler).FetchAsync(Venue, CancellationToken.None, Wanting(7));

        Assert.Equal(3 * 2, handler.Calls.Count);
        Assert.NotNull(harvest);
        Assert.Equal(8, harvest.Ended.Select(broadcast => ReplayArchive.BroadcastDay(Venue, Seoul, broadcast)).Distinct().Count());
    }

    [Fact]
    public async Task A_backfill_for_a_quiet_venue_reads_on_to_a_month_back_and_stops_there()
    {
        // Two days with broadcasts in the first page, one more two weeks back, and the third
        // page already older than 31 days: it is read (its oldest upload says how far it goes
        // only once read), and nothing after it.
        int[][] pages = [[1, 3], [15], [32], [40]];
        var handler = DaysHandler(pages);

        var (_, harvest) = await Client(handler).FetchAsync(Venue, CancellationToken.None, Wanting(7));

        Assert.Equal(3 * 2, handler.Calls.Count);
        Assert.NotNull(harvest);
        Assert.True(harvest.Backfilled);
    }

    [Fact]
    public async Task Days_the_archive_already_has_count_toward_those_wanted()
    {
        var handler = DaysHandler([[1], [2], [3]]);
        var now = DateTimeOffset.UtcNow;
        var todayInSeoul = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, Seoul).DateTime);
        var known = Enumerable.Range(4, 6).Select(back => todayInSeoul.AddDays(-back)).ToHashSet();

        await Client(handler).FetchAsync(Venue, CancellationToken.None, new ReplayFetch(Seoul, now.AddDays(-31), 7, known));

        // Six known days and day 1 from the poll's own page leave one short; day 2 makes eight.
        Assert.Equal(2 * 2, handler.Calls.Count);
    }

    private static ReplayFetch Wanting(int days) => new(Seoul, DateTimeOffset.UtcNow.AddDays(-31), days, new HashSet<DateOnly>());

    /// <summary>
    /// Pages of uploads whose broadcasts ended on the given days back from now (at 12:00 in
    /// Seoul), titled the way TAIKO LABS titles them. Each page's oldest upload is its last day.
    /// </summary>
    private static RoutedHandler DaysHandler(int[][] pages)
    {
        var todayInSeoul = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, Seoul).DateTime);
        string Id(int back) => $"day{back}";
        string Start(int back) => $"{todayInSeoul.AddDays(-back):yyyy-MM-dd}T03:00:00Z";

        return new RoutedHandler(
            playlist: query =>
            {
                var index = query.Contains("pageToken=", StringComparison.Ordinal)
                    ? int.Parse(query[(query.IndexOf("pageToken=p", StringComparison.Ordinal) + 11)..].Split('&')[0])
                    : 0;
                var days = pages[index];
                return Playlist(index + 1 < pages.Length ? $"p{index + 1}" : null, Start(days.Max()), [.. days.Select(Id)]);
            },
            videos: query => Videos([.. pages.SelectMany(days => days)
                .Where(back => query.Contains(Id(back) + "%2C", StringComparison.Ordinal) || query.Contains(Id(back) + "&", StringComparison.Ordinal))
                .Select(back => Video(
                    Id(back),
                    $"TAIKO LABS A1 Live Streaming {todayInSeoul.AddDays(-back):yy.MM.dd} - 1부",
                    "none",
                    start: Start(back),
                    end: DateTimeOffset.Parse(Start(back)).AddHours(5).ToString("O")))]));
    }

    // ------------------------------------------------------------ quota

    [Fact]
    public async Task A_poll_with_replay_on_makes_the_same_two_calls_as_before()
    {
        var handler = new RoutedHandler(
            playlist: _ => Playlist(next: "page-2", oldest: "2026-10-01T00:00:00Z", "v1", "v2"),
            videos: _ => Videos(
                Video("v1", "TAIKO LABS A1 Live Streaming 26.10.09 - 1부", "live", start: "2026-10-09T01:00:00Z", end: null),
                Video("v2", "TAIKO LABS A1 Live Streaming 26.10.08 - 2부", "none", start: "2026-10-08T08:00:00Z", end: "2026-10-08T13:00:00Z")));

        var (snapshot, harvest) = await Client(handler).FetchAsync(Venue, CancellationToken.None, new ReplayFetch(Seoul, BackfillSince: null));

        Assert.Equal(2, handler.Calls.Count);
        Assert.Equal(["v1"], snapshot.Streams.Select(stream => stream.VideoId));
        Assert.NotNull(harvest);
        Assert.Equal(["v2"], harvest.Ended.Select(broadcast => broadcast.VideoId));
        Assert.False(harvest.Backfilled);
    }

    [Fact]
    public async Task A_backfill_reads_older_pages_until_they_reach_back_far_enough_and_no_further()
    {
        var handler = new RoutedHandler(
            playlist: query => query.Contains("pageToken=p3", StringComparison.Ordinal)
                ? Playlist(next: "p4", oldest: "2026-09-29T00:00:00Z", "v5")
                : query.Contains("pageToken=p2", StringComparison.Ordinal)
                    ? Playlist(next: "p3", oldest: "2026-10-04T00:00:00Z", "v3", "v4")
                    : Playlist(next: "p2", oldest: "2026-10-07T00:00:00Z", "v1", "v2"),
            videos: _ => Videos());

        var (_, harvest) = await Client(handler).FetchAsync(
            Venue,
            CancellationToken.None,
            new ReplayFetch(Seoul, BackfillSince: DateTimeOffset.Parse("2026-10-01T00:00:00Z")));

        // Page 1 as every poll, then p2 (oldest 10-04, still inside), then p3 (oldest 09-29,
        // past the cut-off) - and not p4. Two calls a page: 6 in all, 4 of them the backfill.
        Assert.Equal(6, handler.Calls.Count);
        Assert.DoesNotContain(handler.Calls, call => call.Contains("pageToken=p4", StringComparison.Ordinal));
        Assert.NotNull(harvest);
        Assert.True(harvest.Backfilled);
        Assert.Equal(["v1", "v2", "v3", "v4", "v5"], harvest.Checked.Order());
    }

    [Fact]
    public async Task A_backfill_stops_at_its_page_limit()
    {
        var handler = new RoutedHandler(
            playlist: query => Playlist(next: "more", oldest: "2026-10-08T00:00:00Z", $"v{query.Length}"),
            videos: _ => Videos());

        await Client(handler, backfillPages: 2).FetchAsync(
            Venue,
            CancellationToken.None,
            new ReplayFetch(Seoul, BackfillSince: DateTimeOffset.Parse("2026-09-01T00:00:00Z")));

        Assert.Equal(2 + (2 * 2), handler.Calls.Count);
    }

    [Fact]
    public async Task A_failing_backfill_keeps_the_live_snapshot_it_already_has()
    {
        var handler = new RoutedHandler(
            playlist: query => query.Contains("pageToken", StringComparison.Ordinal)
                ? null
                : Playlist(next: "p2", oldest: "2026-10-08T00:00:00Z", "v1"),
            videos: _ => Videos(Video("v1", "TAIKO LABS A1 Live Streaming 26.10.09 - 1부", "live", start: "2026-10-09T01:00:00Z", end: null)));

        var (snapshot, harvest) = await Client(handler).FetchAsync(
            Venue,
            CancellationToken.None,
            new ReplayFetch(Seoul, BackfillSince: DateTimeOffset.Parse("2026-10-01T00:00:00Z")));

        Assert.Null(snapshot.Error);
        Assert.Equal(["v1"], snapshot.Streams.Select(stream => stream.VideoId));
        Assert.NotNull(harvest);
        Assert.True(harvest.Backfilled);
    }

    [Fact]
    public void Replay_adds_nothing_to_a_day_of_polling_and_bounds_what_a_start_can_add()
    {
        var venues = (Venue[])[Venue, Venue, Venue, Venue];
        var options = new YouTubeOptions { PollIntervalSeconds = 60, ClosedPollIntervalSeconds = 600, PreOpenMinutes = 30 };
        var without = new YouTubeOptions { PollIntervalSeconds = 60, ClosedPollIntervalSeconds = 600, PreOpenMinutes = 30, ReplayBackfillPages = 0 };

        var quota = QuotaEstimate.For(venues, options);

        Assert.Equal(QuotaEstimate.For(venues, without).UnitsPerDay, quota.UnitsPerDay);
        // Four venues, eight older pages each, two units a page.
        Assert.Equal(64, quota.ReplayBackfillUnitsAtMost);
        Assert.Equal(0, QuotaEstimate.For(venues, without).ReplayBackfillUnitsAtMost);
    }

    // ------------------------------------------------------------ other sources

    [Fact]
    public void Public_mode_keeps_only_broadcasts_the_watch_page_shows_finished()
    {
        LiveStream Candidate(string id) => new() { VideoId = id, Title = $"TAIKO LABS A1 Live Streaming 26.10.08 - 1부", Name = "A1", Part = 1 };
        var started = DateTimeOffset.Parse("2026-10-08T01:00:00Z");

        var ended = YouTubeLiveClient.EndedFromProbe(
            [Candidate("ended"), Candidate("live"), Candidate("upload"), Candidate("unprobed")],
            new Dictionary<string, PublicLiveProbe.LiveStatus>
            {
                ["ended"] = new(false, started, HasEnded: true, started.AddHours(5)),
                ["live"] = new(true, started, HasEnded: false),
                // No broadcast details at all: a plain upload, reported ended with no start.
                ["upload"] = new(false, null, HasEnded: true),
            });

        Assert.Equal(["ended"], ended.Select(broadcast => broadcast.VideoId));
    }

    [Fact]
    public void Mock_mode_makes_a_week_of_two_parts_on_every_cabinet_and_one_unlisted_unembeddable()
    {
        var now = DateTimeOffset.Parse("2026-10-09T03:00:00Z");

        var harvest = YouTubeLiveClient.BuildMockReplay(Venue, [], Seoul, now, days: 7);

        Assert.True(harvest.ReplacesAll);
        Assert.Equal((7 * 2 * Venue.Stations.Count) + 1, harvest.Ended.Count);
        var unlisted = Assert.Single(harvest.Ended, broadcast => broadcast.Name == YouTubeLiveClient.MockUnlistedCabinet);
        Assert.False(unlisted.Embeddable);

        var days = ReplayArchive.Group(Venue, Seoul, harvest.Ended, DateOnly.Parse("2026-10-02"));
        Assert.Equal(DateOnly.Parse("2026-10-08"), days[0].Date);
        Assert.Equal(DateOnly.Parse("2026-10-02"), days[^1].Date);
        Assert.All(days, day => Assert.Equal([1, 2], day.Sessions.Select(session => session.Session)));
    }

    [Fact]
    public void Mock_broadcasts_sharing_real_ids_all_survive_the_archive()
    {
        var harvest = YouTubeLiveClient.BuildMockReplay(Venue, ["vidA", "vidB"], Seoul, DateTimeOffset.Parse("2026-10-09T03:00:00Z"), days: 2);
        var stored = new Dictionary<string, PastBroadcast>();

        ReplayArchive.Apply(stored, harvest, DateTimeOffset.Parse("2026-10-01T00:00:00Z"));

        Assert.Equal(harvest.Ended.Count, stored.Count);
    }

    // ------------------------------------------------------------ helpers

    private static PastBroadcast Past(string id, string name, string startedAt, int? part = null, string? date = null) => new()
    {
        VideoId = id,
        Title = $"TAIKO LABS {name} Live Streaming",
        Name = name,
        Part = part,
        StreamDate = date,
        StartedAt = DateTimeOffset.Parse(startedAt),
        EndedAt = DateTimeOffset.Parse(startedAt).AddHours(5),
    };

    private static ReplayArchive Archive(string? path, TestClock clock, int backfillPages = 6)
    {
        var venues = TestVenues.Options(TestVenues.TaikoLabs());
        venues.ReplayCachePath = path ?? string.Empty;
        var youtube = new YouTubeOptions { Mode = LiveSourceMode.Api, ApiKey = "test", ReplayBackfillPages = backfillPages };

        return new ReplayArchive(Options.Create(venues), Options.Create(youtube), TestVenues.Host(), NullLogger<ReplayArchive>.Instance, clock);
    }

    private static YouTubeLiveClient Client(HttpMessageHandler handler, int backfillPages = 6)
    {
        var http = new HttpClient(handler);
        var options = Options.Create(new YouTubeOptions { ApiKey = "test-key", Mode = LiveSourceMode.Api, ReplayBackfillPages = backfillPages });
        return new YouTubeLiveClient(
            http,
            new PublicLiveProbe(http, new EndedBroadcastCache(), NullLogger<PublicLiveProbe>.Instance),
            options,
            NullLogger<YouTubeLiveClient>.Instance);
    }

    private static List<YouTubeLiveClient.VideoReading> Read(params object[] items)
    {
        using var document = JsonDocument.Parse(Videos(items));
        return YouTubeLiveClient.ReadVideoDetails(Venue, document.RootElement);
    }

    private static object Video(string id, string title, string content, string? start, string? end, string privacy = "public") => new
    {
        id,
        snippet = new { title, liveBroadcastContent = content, publishedAt = start ?? "2026-10-08T00:00:00Z" },
        status = new { privacyStatus = privacy, embeddable = true },
        liveStreamingDetails = start is null ? null : new { actualStartTime = start, actualEndTime = end },
    };

    private static string Videos(params object[] items) => JsonSerializer.Serialize(new { items });

    private static string Playlist(string? next, string oldest, params string[] ids) => JsonSerializer.Serialize(new
    {
        nextPageToken = next,
        items = ids.Select(id => new { contentDetails = new { videoId = id, videoPublishedAt = oldest } }),
    });

    /// <summary>Answers the two Data API calls a poll makes; a null body fails the call.</summary>
    private sealed class RoutedHandler(Func<string, string?> playlist, Func<string, string?> videos) : HttpMessageHandler
    {
        public List<string> Calls { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var url = request.RequestUri!.ToString();
            Calls.Add(url);

            var body = url.Contains("/playlistItems", StringComparison.Ordinal) ? playlist(url) : videos(url);
            return Task.FromResult(body is null
                ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable) { Content = new StringContent("down") }
                : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body) });
        }
    }
}
