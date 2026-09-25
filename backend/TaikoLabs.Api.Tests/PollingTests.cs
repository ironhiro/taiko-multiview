using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using TaikoLabs.Api.Models;
using TaikoLabs.Api.Services;

namespace TaikoLabs.Api.Tests;

/// <summary>Which venues a polling round spends quota on.</summary>
public class PollingTests
{
    private sealed record Rig(LivePollingService Poller, LiveStreamStore Store, Venue Venue, TestClock Clock);

    private static Rig Build(string seoulNow)
    {
        var options = TestVenues.Options(TestVenues.TaikoLabs());
        var registry = new VenueRegistry(new TestOptionsMonitor<VenuesOptions>(options), NullLogger<VenueRegistry>.Instance);
        var clock = new TestClock(DateTimeOffset.Parse(seoulNow + "+09:00"));
        var schedule = new VenueScheduleProvider(registry, TestVenues.Closures(options), clock);
        var store = new LiveStreamStore();
        var poller = new LivePollingService(
            scopeFactory: null!, // IsDue never polls.
            registry,
            store,
            schedule,
            Options.Create(new YouTubeOptions { PollIntervalSeconds = 60, ClosedPollIntervalSeconds = 600, PreOpenMinutes = 30 }),
            NullLogger<LivePollingService>.Instance,
            clock);

        return new Rig(poller, store, registry.All[0], clock);
    }

    /// <summary>Marks the venue as polled now, the way a real round would.</summary>
    private static void PolledNow(Rig rig)
    {
        var field = typeof(LivePollingService).GetField("_lastPolled", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!;
        var polled = (Dictionary<string, DateTimeOffset>)field.GetValue(rig.Poller)!;
        polled[rig.Venue.Id] = rig.Clock.GetUtcNow();
    }

    [Fact]
    public void A_venue_never_polled_is_due()
    {
        var rig = Build("2026-09-24T03:00:00");
        Assert.True(rig.Poller.IsDue(rig.Venue));
    }

    [Fact]
    public void An_open_venue_is_polled_every_round()
    {
        var rig = Build("2026-09-24T15:00:00");
        PolledNow(rig);
        rig.Clock.Now += TimeSpan.FromSeconds(60);
        Assert.True(rig.Poller.IsDue(rig.Venue));
    }

    [Fact]
    public void A_closed_venue_with_nothing_on_air_waits_ten_minutes()
    {
        var rig = Build("2026-09-24T03:00:00"); // Thursday, opens 10:00
        PolledNow(rig);

        rig.Clock.Now += TimeSpan.FromMinutes(5);
        Assert.False(rig.Poller.IsDue(rig.Venue));

        rig.Clock.Now += TimeSpan.FromMinutes(5);
        Assert.True(rig.Poller.IsDue(rig.Venue));
    }

    [Fact]
    public void A_closed_venue_that_is_streaming_stays_on_the_full_rate()
    {
        // TAIKO LABS streams THE BASE outside its listed hours; the end must still be seen.
        var rig = Build("2026-09-24T03:00:00");
        rig.Store.Publish(rig.Venue.Id, new LiveSnapshot
        {
            Streams = [new LiveStream { VideoId = "v", Title = "t", Name = "THE BASE", StationId = "base", IsLive = true }],
        });
        PolledNow(rig);
        rig.Clock.Now += TimeSpan.FromSeconds(60);
        Assert.True(rig.Poller.IsDue(rig.Venue));
    }

    [Fact]
    public void Half_an_hour_before_opening_goes_back_to_the_full_rate()
    {
        var rig = Build("2026-09-24T09:35:00"); // opens 10:00
        PolledNow(rig);
        rig.Clock.Now += TimeSpan.FromSeconds(60);
        Assert.True(rig.Poller.IsDue(rig.Venue));
    }
}
