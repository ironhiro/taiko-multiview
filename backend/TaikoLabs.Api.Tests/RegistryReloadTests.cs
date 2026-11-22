using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using TaikoLabs.Api.Models;
using TaikoLabs.Api.Services;

namespace TaikoLabs.Api.Tests;

public class RegistryReloadTests
{
    [Fact]
    public void A_saved_settings_file_is_picked_up_without_a_restart()
    {
        // The venue editor saved new labels and nothing changed until the API restarted.
        var source = new TestVenueSource(TestVenues.TaikoLabs());
        using var registry = new VenueRegistry(source, new TestOptionsMonitor<VenuesOptions>(TestVenues.Options()), NullLogger<VenueRegistry>.Instance);
        var before = registry.Version;

        var renamed = TestVenues.TaikoLabs();
        renamed.Stations[0].Label = "A1-바뀜";
        var added = TestVenues.TaikoLabs();
        added.Id = "p2zone";
        source.Set(renamed, added);

        Assert.True(registry.Version > before);
        Assert.Equal(2, registry.All.Count);
        Assert.Equal("A1-바뀜", registry.Find("taikolabs")!.Stations[0].Label);
        Assert.NotNull(registry.Find("p2zone"));
    }

    [Fact]
    public void A_broken_venue_in_the_new_file_is_skipped_not_fatal()
    {
        var source = new TestVenueSource(TestVenues.TaikoLabs());
        var logger = new RecordingLogger();
        using var registry = new VenueRegistry(source, new TestOptionsMonitor<VenuesOptions>(TestVenues.Options()), logger);

        var broken = TestVenues.TaikoLabs();
        broken.Id = "broken";
        broken.TitlePattern = "^(.+)$"; // no name group
        source.Set(TestVenues.TaikoLabs(), broken);

        Assert.Single(registry.All);
        Assert.Null(registry.Find("broken"));
        Assert.Contains(
            (LogLevel.Error, "Venue 'broken' was skipped: titlePattern has no (?<name>...) group"),
            logger.Entries);
    }

    [Fact]
    public void The_version_starts_at_one_and_goes_up_by_one_per_change()
    {
        // Clients compare venuesVersion to know their list is stale; a change that left it
        // where it was would leave every open page on the old venues.
        var source = new TestVenueSource(TestVenues.TaikoLabs());
        using var registry = TestRegistry(source, new TestOptionsMonitor<VenuesOptions>(TestVenues.Options()));

        Assert.Equal(1, registry.Version);

        source.Set(TestVenues.TaikoLabs());
        Assert.Equal(2, registry.Version);

        source.Set(TestVenues.TaikoLabs());
        Assert.Equal(3, registry.Version);
    }

    [Fact]
    public void A_new_time_zone_is_picked_up_with_the_venues_kept()
    {
        // The time zone used to be re-read with the list, both being the one "Venues"
        // section; splitting the list off must not leave opening hours on the old zone.
        var source = new TestVenueSource(TestVenues.TaikoLabs());
        var settings = new TestOptionsMonitor<VenuesOptions>(TestVenues.Options());
        using var registry = TestRegistry(source, settings);

        var moved = TestVenues.Options();
        moved.TimeZone = "Asia/Tokyo";
        settings.Set(moved);

        Assert.Equal(TimeZoneInfo.FindSystemTimeZoneById("Asia/Tokyo").Id, registry.TimeZone.Id);
        Assert.Equal("Asia/Tokyo", registry.Options.TimeZone);
        Assert.Equal(2, registry.Version);
        Assert.NotNull(registry.Find("taikolabs"));
    }

    [Fact]
    public void A_settings_reload_with_the_same_time_zone_does_not_rebuild_twice()
    {
        // The venue file's reload reaches both the source and the settings; the venues are
        // rebuilt for the source's notification, and the settings' one adds nothing.
        var source = new TestVenueSource(TestVenues.TaikoLabs());
        var settings = new TestOptionsMonitor<VenuesOptions>(TestVenues.Options());
        using var registry = TestRegistry(source, settings);

        source.Set(TestVenues.TaikoLabs());
        settings.Set(TestVenues.Options());

        Assert.Equal(2, registry.Version);
    }

    [Fact]
    public void A_time_zone_that_arrives_after_the_list_is_still_caught()
    {
        // One reload, two notifications, in no fixed order: the source's may run while the
        // settings still hold the old zone.
        var source = new TestVenueSource(TestVenues.TaikoLabs());
        var settings = new TestOptionsMonitor<VenuesOptions>(TestVenues.Options());
        using var registry = TestRegistry(source, settings);

        source.Set(TestVenues.TaikoLabs());
        Assert.Equal(TestVenues.Seoul.Id, registry.TimeZone.Id);

        var moved = TestVenues.Options();
        moved.TimeZone = "Asia/Tokyo";
        settings.Set(moved);

        Assert.Equal(TimeZoneInfo.FindSystemTimeZoneById("Asia/Tokyo").Id, registry.TimeZone.Id);
    }

    private static VenueRegistry TestRegistry(TestVenueSource source, TestOptionsMonitor<VenuesOptions> settings) =>
        new(source, settings, NullLogger<VenueRegistry>.Instance);
}

/// <summary>A logger that keeps what was written, for tests that pin a message.</summary>
internal sealed class RecordingLogger : ILogger<VenueRegistry>
{
    public List<(LogLevel Level, string Message)> Entries { get; } = [];

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
        Entries.Add((logLevel, formatter(state, exception)));
}
