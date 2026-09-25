using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using TaikoLabs.Api.Models;
using TaikoLabs.Api.Services;

namespace TaikoLabs.Api.Tests;

/// <summary>Venues and plumbing shaped like the real configuration.</summary>
internal static class TestVenues
{
    public static readonly TimeZoneInfo Seoul = TimeZoneInfo.FindSystemTimeZoneById("Asia/Seoul");

    public static VenueDefinition TaikoLabs(string hours = "10:00-24:00") => new()
    {
        Id = "taikolabs",
        Name = "TAIKO LABS",
        ChannelId = "UC0tzRzxBMM1-riQVHHYoADw",
        TitlePattern = @"^\s*TAIKO\s+LABS\s+(?<name>.+?)\s+Live\s+Streaming\s+(?<date>\d{2}\.\d{2}\.\d{2})(?:\s*-\s*(?<part>\d+)\s*부)?\s*$",
        Stations =
        [
            new StationDefinition { Id = "a1", Label = "A1" },
            new StationDefinition { Id = "base", Label = "THE BASE", Aliases = ["BASE"] },
        ],
        Hours = new(StringComparer.OrdinalIgnoreCase)
        {
            ["Monday"] = hours, ["Tuesday"] = hours, ["Wednesday"] = hours, ["Thursday"] = hours,
            ["Friday"] = "10:00-29:00", ["Saturday"] = "07:00-29:00", ["Sunday"] = "07:00-24:00",
        },
    };

    public static Venue Create(VenueDefinition definition)
    {
        var venue = Venue.Create(definition);
        venue.ResolveClosedDates();
        return venue;
    }

    public static VenuesOptions Options(params VenueDefinition[] venues) => new()
    {
        TimeZone = "Asia/Seoul",
        // Somewhere harmless: the closure store reads and writes this.
        ClosureCachePath = Path.Combine(Path.GetTempPath(), $"taiko-closures-{Guid.NewGuid():N}.json"),
        Items = [.. venues],
    };

    public static VenueClosureStore Closures(VenuesOptions options) =>
        new(Microsoft.Extensions.Options.Options.Create(options), new FakeHost(), NullLogger<VenueClosureStore>.Instance);

    private sealed class FakeHost : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Test";
        public string ApplicationName { get; set; } = "Tests";
        public string ContentRootPath { get; set; } = Path.GetTempPath();
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } =
            new Microsoft.Extensions.FileProviders.NullFileProvider();
    }
}

/// <summary>An options monitor whose value the test changes, as a saved settings file would.</summary>
internal sealed class TestOptionsMonitor<T>(T value) : IOptionsMonitor<T>
{
    private readonly List<Action<T, string?>> _listeners = [];

    public T CurrentValue { get; private set; } = value;

    public T Get(string? name) => CurrentValue;

    public IDisposable OnChange(Action<T, string?> listener)
    {
        _listeners.Add(listener);
        return new Unsubscribe(() => _listeners.Remove(listener));
    }

    public void Set(T value)
    {
        CurrentValue = value;
        foreach (var listener in _listeners.ToList())
        {
            listener(value, null);
        }
    }

    private sealed class Unsubscribe(Action action) : IDisposable
    {
        public void Dispose() => action();
    }
}

/// <summary>A clock the test moves by hand.</summary>
internal sealed class TestClock(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;

    public override DateTimeOffset GetUtcNow() => Now;
}
