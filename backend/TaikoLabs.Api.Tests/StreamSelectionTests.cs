using TaikoLabs.Api.Models;
using TaikoLabs.Api.Services;

namespace TaikoLabs.Api.Tests;

public class StreamSelectionTests
{
    private static readonly Venue Venue = TestVenues.Create(TestVenues.TaikoLabs());

    private static LiveStream Stream(string id, string station, int? part, string started, bool live = true) => new()
    {
        VideoId = id,
        Title = id,
        Name = station,
        StationId = station,
        Part = part,
        IsLive = live,
        ActualStartTime = DateTimeOffset.Parse(started),
    };

    [Fact]
    public void Newest_broadcast_wins_over_a_higher_part_left_live_from_yesterday()
    {
        // YouTube kept yesterday's 3부 flagged live for hours; ranking by 부 first put
        // that dead stream on the wall instead of today's 1부.
        var snapshot = YouTubeLiveClient.BuildSnapshot(
            Venue,
            [
                Stream("yesterday-3", "a1", 3, "2026-09-24T12:46:00Z"),
                Stream("today-1", "a1", 1, "2026-09-25T00:53:00Z"),
            ],
            LiveSourceMode.Api,
            isFallbackSource: false);

        Assert.Equal("today-1", Assert.Single(snapshot.Streams).VideoId);
    }

    [Fact]
    public void Part_breaks_a_tie_on_start_time()
    {
        var snapshot = YouTubeLiveClient.BuildSnapshot(
            Venue,
            [Stream("part-1", "a1", 1, "2026-09-25T00:53:00Z"), Stream("part-2", "a1", 2, "2026-09-25T00:53:00Z")],
            LiveSourceMode.Api,
            isFallbackSource: false);

        Assert.Equal("part-2", Assert.Single(snapshot.Streams).VideoId);
    }

    [Fact]
    public void Finished_broadcasts_never_show_as_replays()
    {
        var snapshot = YouTubeLiveClient.BuildSnapshot(
            Venue,
            [Stream("ended", "a1", 1, "2026-09-25T00:53:00Z", live: false)],
            LiveSourceMode.Api,
            isFallbackSource: false);

        Assert.Empty(snapshot.Streams);
    }

    [Fact]
    public void Live_streams_for_unknown_cabinets_are_kept_aside()
    {
        var unknown = Stream("x", "b9", 1, "2026-09-25T00:53:00Z") with { StationId = null, Name = "B9" };

        var snapshot = YouTubeLiveClient.BuildSnapshot(Venue, [unknown], LiveSourceMode.Api, isFallbackSource: false);

        Assert.Empty(snapshot.Streams);
        Assert.Equal("x", Assert.Single(snapshot.Unmatched).VideoId);
    }

    [Fact]
    public void An_unknown_cabinet_keeps_only_its_newest_broadcast()
    {
        // THE BASE 2 went on air before it was in the settings, and YouTube still had the
        // morning's 1부 flagged live beside the 2부: the wall put the cabinet up twice.
        var snapshot = YouTubeLiveClient.BuildSnapshot(
            Venue,
            [
                Unknown("base2-part-1", "THE BASE 2", 1, "2026-09-25T00:53:00Z"),
                Unknown("base2-part-2", "the base 2", 2, "2026-09-25T05:10:00Z"),
            ],
            LiveSourceMode.Api,
            isFallbackSource: false);

        Assert.Equal("base2-part-2", Assert.Single(snapshot.Unmatched).VideoId);
    }

    [Fact]
    public void Unknown_cabinets_break_a_tie_on_part_and_come_out_in_name_order()
    {
        var snapshot = YouTubeLiveClient.BuildSnapshot(
            Venue,
            [
                Unknown("z-part-1", "Z9", 1, "2026-09-25T00:53:00Z"),
                Unknown("b-part-1", "THE BASE 2", 1, "2026-09-25T00:53:00Z"),
                Unknown("b-part-2", "THE-BASE-2", 2, "2026-09-25T00:53:00Z"),
            ],
            LiveSourceMode.Api,
            isFallbackSource: false);

        Assert.Equal(["b-part-2", "z-part-1"], snapshot.Unmatched.Select(s => s.VideoId));
    }

    private static LiveStream Unknown(string id, string name, int part, string started) =>
        Stream(id, name, part, started) with { StationId = null };

    [Theory]
    [InlineData("TAIKO LABS A1 Live Streaming 26.09.25 - 1부", "A1", 1)]
    [InlineData("TAIKO LABS THE BASE Live Streaming 26.09.24 - 3부", "THE BASE", 3)]
    [InlineData("TAIKO LABS A1 Live Streaming 26.09.25", "A1", null)]
    public void Titles_are_read_into_cabinet_and_part(string title, string name, int? part)
    {
        var parsed = StreamTitleParser.Parse(Venue.TitlePattern, title);

        Assert.NotNull(parsed);
        Assert.Equal(name, parsed.Name);
        Assert.Equal(part, parsed.Part);
    }

    [Fact]
    public void Cabinet_names_resolve_through_labels_and_aliases()
    {
        Assert.Equal("base", Venue.ResolveStationId("THE BASE"));
        Assert.Equal("base", Venue.ResolveStationId("BASE"));
        Assert.Null(Venue.ResolveStationId("B9"));
    }
}
