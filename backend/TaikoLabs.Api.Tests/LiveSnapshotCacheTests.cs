using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using TaikoLabs.Api.Models;
using TaikoLabs.Api.Services;

namespace TaikoLabs.Api.Tests;

/// <summary>
/// What survives a restart, and what must not: the file is a shortcut, so anything the
/// server cannot trust has to leave it starting empty rather than starting wrong.
/// </summary>
public class LiveSnapshotCacheTests : IDisposable
{
    private static readonly DateTimeOffset Polled = DateTimeOffset.Parse("2026-09-28T11:47:13+00:00");

    private readonly VenuesOptions _options = TestVenues.Options(TestVenues.TaikoLabs());

    public void Dispose() => File.Delete(_options.LiveCachePath);

    private LiveSnapshotCache Cache(VenuesOptions? options = null)
    {
        options ??= _options;
        return new LiveSnapshotCache(
            Options.Create(options),
            TestVenues.Registry(options),
            TestVenues.Host(),
            NullLogger<LiveSnapshotCache>.Instance);
    }

    private static LiveSnapshot Snapshot() => new()
    {
        UpdatedAt = Polled,
        Source = LiveSourceMode.Public,
        IsFallbackSource = true,
        Streams = [new LiveStream { VideoId = "v", Title = "t", Name = "A1", StationId = "a1", IsLive = true }],
    };

    [Fact]
    public void A_restored_snapshot_keeps_the_time_it_was_polled()
    {
        Cache().Save(new Dictionary<string, LiveSnapshot> { ["taikolabs"] = Snapshot() });

        // A second instance is a second start of the process, reading what the first left.
        var restored = Assert.Single(Cache().Restore()).Value;

        Assert.Equal(Polled, restored.UpdatedAt);
        Assert.Equal("v", Assert.Single(restored.Streams).VideoId);
        // Provenance describes the data, not the mode this start happens to run in.
        Assert.Equal(LiveSourceMode.Public, restored.Source);
        Assert.True(restored.IsFallbackSource);
    }

    [Fact]
    public void A_store_built_on_the_cache_answers_before_its_first_poll()
    {
        Cache().Save(new Dictionary<string, LiveSnapshot> { ["taikolabs"] = Snapshot() });

        var store = new LiveStreamStore(Cache());

        Assert.Single(store.For("taikolabs").Streams);
        Assert.Equal(Polled, store.For("taikolabs").UpdatedAt);
    }

    [Fact]
    public void A_venue_never_polled_reports_no_time_at_all()
    {
        // Dated "now", an empty snapshot made the page say "as of 8:02:26" about a reading
        // that had never been taken.
        var snapshot = new LiveStreamStore().For("taikolabs");

        Assert.Null(snapshot.UpdatedAt);
        Assert.Empty(snapshot.Streams);
    }

    [Fact]
    public void A_corrupt_cache_file_is_ignored_and_the_store_still_starts()
    {
        File.WriteAllText(_options.LiveCachePath, "{ this is not json");

        Assert.Empty(Cache().Restore());
        Assert.Empty(new LiveStreamStore(Cache()).For("taikolabs").Streams);
    }

    [Fact]
    public void A_missing_cache_file_is_ignored_and_the_store_still_starts()
    {
        Assert.False(File.Exists(_options.LiveCachePath));

        Assert.Empty(Cache().Restore());
        Assert.Empty(new LiveStreamStore(Cache()).For("taikolabs").Streams);
    }

    [Fact]
    public void A_cache_written_before_the_cabinets_changed_is_ignored()
    {
        Cache().Save(new Dictionary<string, LiveSnapshot> { ["taikolabs"] = Snapshot() });

        // The venue gained a cabinet since the file was written, so its streams no longer
        // describe the wall the page is about to draw.
        var definition = TestVenues.TaikoLabs();
        definition.Stations.Add(new StationDefinition { Id = "a2", Label = "A2" });

        var moved = TestVenues.Options(definition);
        moved.LiveCachePath = _options.LiveCachePath;

        Assert.Empty(Cache(moved).Restore());
    }

    [Fact]
    public void A_stored_snapshot_with_no_time_is_dropped_rather_than_replayed()
    {
        Cache().Save(new Dictionary<string, LiveSnapshot> { ["taikolabs"] = LiveSnapshot.NeverPolled });

        Assert.Empty(Cache().Restore());
    }
}
