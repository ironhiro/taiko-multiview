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
        var monitor = new TestOptionsMonitor<VenuesOptions>(TestVenues.Options(TestVenues.TaikoLabs()));
        using var registry = new VenueRegistry(monitor, NullLogger<VenueRegistry>.Instance);
        var before = registry.Version;

        var renamed = TestVenues.TaikoLabs();
        renamed.Stations[0].Label = "A1-바뀜";
        var added = TestVenues.TaikoLabs();
        added.Id = "p2zone";
        monitor.Set(TestVenues.Options(renamed, added));

        Assert.True(registry.Version > before);
        Assert.Equal(2, registry.All.Count);
        Assert.Equal("A1-바뀜", registry.Find("taikolabs")!.Stations[0].Label);
        Assert.NotNull(registry.Find("p2zone"));
    }

    [Fact]
    public void A_broken_venue_in_the_new_file_is_skipped_not_fatal()
    {
        var monitor = new TestOptionsMonitor<VenuesOptions>(TestVenues.Options(TestVenues.TaikoLabs()));
        using var registry = new VenueRegistry(monitor, NullLogger<VenueRegistry>.Instance);

        var broken = TestVenues.TaikoLabs();
        broken.Id = "broken";
        broken.TitlePattern = "^(.+)$"; // no name group
        monitor.Set(TestVenues.Options(TestVenues.TaikoLabs(), broken));

        Assert.Single(registry.All);
        Assert.Null(registry.Find("broken"));
    }
}
