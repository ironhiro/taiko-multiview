using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using TaikoLabs.Api.Models;
using TaikoLabs.Api.Services;

namespace TaikoLabs.Api.Tests;

/// <summary>
/// The venue file as the API reads it: through configuration, in the shape the venue editor
/// writes, watched while running.
/// </summary>
public class FileVenueSourceTests : IDisposable
{
    private readonly string _folder = Directory.CreateTempSubdirectory("taiko-venues-").FullName;

    public void Dispose() => Directory.Delete(_folder, recursive: true);

    [Fact]
    public void The_venue_file_is_read_in_the_shape_the_editor_writes()
    {
        var file = Write("venues.json", TestVenues.TaikoLabs());
        using var configuration = Configuration(file);

        var venue = Assert.Single(new FileVenueSource(configuration).Load());

        Assert.Equal("taikolabs", venue.Id);
        Assert.Equal(["a1", "base"], venue.Stations.Select(station => station.Id));
        Assert.Equal(["BASE"], venue.Stations[1].Aliases);
        Assert.Equal("10:00-29:00", venue.Hours["friday"]);
    }

    [Fact]
    public void The_global_settings_still_bind_from_the_same_section()
    {
        // appsettings.json and the venue file both write under "Venues"; the settings must
        // come out the same with the list no longer part of them.
        var file = Write("venues.json", TestVenues.TaikoLabs());
        using var configuration = Configuration(file, new Dictionary<string, string?>
        {
            ["Venues:TimeZone"] = "Asia/Tokyo",
            ["Venues:ClosureRefreshHour"] = "6",
            ["Venues:ClosureCachePath"] = "c.json",
            ["Venues:LiveCachePath"] = "l.json",
            ["Venues:ReplayCachePath"] = "r.json",
        });
        using var services = Services(configuration);

        var settings = services.GetRequiredService<IOptions<VenuesOptions>>().Value;

        Assert.Equal("Asia/Tokyo", settings.TimeZone);
        Assert.Equal(6, settings.ClosureRefreshHour);
        Assert.Equal("c.json", settings.ClosureCachePath);
        Assert.Equal("l.json", settings.LiveCachePath);
        Assert.Equal("r.json", settings.ReplayCachePath);
        Assert.Single(services.GetRequiredService<VenueRegistry>().All);
    }

    [Fact]
    public void Venues_File_names_another_list()
    {
        Write("venues.json", TestVenues.TaikoLabs());
        var mock = TestVenues.TaikoLabs();
        mock.Id = "mock-01";
        var file = Write("venues.mock.json", mock);
        using var configuration = Configuration(file);

        Assert.Equal("mock-01", Assert.Single(new FileVenueSource(configuration).Load()).Id);
    }

    [Fact]
    public async Task Saving_the_venue_file_while_running_rebuilds_the_registry()
    {
        // What the venue editor relies on: save, and the wall picks it up without a restart.
        var file = Write("venues.json", TestVenues.TaikoLabs());
        using var configuration = Configuration(file);
        using var services = Services(configuration);
        var registry = services.GetRequiredService<VenueRegistry>();
        Assert.Equal(1, registry.Version);

        var renamed = TestVenues.TaikoLabs();
        renamed.Name = "TAIKO LABS 바뀜";
        Write("venues.json", renamed);
        await Until(() => registry.Find("taikolabs")?.Name == "TAIKO LABS 바뀜");
        var afterSave = registry.Version;
        Assert.True(afterSave > 1);

        // And back again.
        Write("venues.json", TestVenues.TaikoLabs());
        await Until(() => registry.Find("taikolabs")?.Name == "TAIKO LABS");
        Assert.True(registry.Version > afterSave);
    }

    [Fact]
    public void A_configuration_reload_tells_the_source_listeners()
    {
        var file = Write("venues.json", TestVenues.TaikoLabs());
        using var configuration = Configuration(file);
        var source = new FileVenueSource(configuration);
        var calls = 0;

        // A reload can notify more than once (the file's provider and the configuration both
        // signal), which is why the registry treats every call as "rebuild", not "count".
        using (source.OnChange(() => calls++))
        {
            ((IConfigurationRoot)configuration).Reload();
            Assert.True(calls > 0);
        }

        var whileSubscribed = calls;
        ((IConfigurationRoot)configuration).Reload();

        Assert.Equal(whileSubscribed, calls);
    }

    private string Write(string name, params VenueDefinition[] venues)
    {
        var path = Path.Combine(_folder, name);
        File.WriteAllText(path, JsonSerializer.Serialize(
            new { Venues = new { Items = venues } },
            new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }));
        return path;
    }

    /// <summary>Configuration put together the way Program.cs does it, the venue file last.</summary>
    private static ConfigurationManager Configuration(string file, Dictionary<string, string?>? settings = null)
    {
        var configuration = new ConfigurationManager();
        configuration.AddInMemoryCollection(new Dictionary<string, string?>(settings ?? [])
        {
            [FileVenueSource.FileKey] = file,
        });
        FileVenueSource.AddFile(configuration);
        return configuration;
    }

    /// <summary>The registrations Program.cs makes for the venues.</summary>
    private static ServiceProvider Services(ConfigurationManager configuration)
    {
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(configuration);
        services.AddLogging();
        services.Configure<VenuesOptions>(configuration.GetSection(VenuesOptions.SectionName));
        services.AddSingleton<IVenueSource, FileVenueSource>();
        services.AddSingleton<VenueRegistry>();
        return services.BuildServiceProvider();
    }

    private static async Task Until(Func<bool> condition)
    {
        // The file watcher waits a moment after a save before it reloads.
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (!condition())
        {
            Assert.True(DateTime.UtcNow < deadline, "The venue file change was not picked up.");
            await Task.Delay(50);
        }
    }
}
