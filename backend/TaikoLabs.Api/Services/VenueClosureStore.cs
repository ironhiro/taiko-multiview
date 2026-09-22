using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.Extensions.Options;
using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Holds auto-detected closure dates per venue, backed by a small file so a restart —
/// or a failed lookup — does not silently drop yesterday's answer.
/// </summary>
public sealed class VenueClosureStore
{
    private static readonly IReadOnlySet<DateOnly> Empty = new HashSet<DateOnly>();

    private readonly ILogger<VenueClosureStore> _logger;
    private readonly string _cachePath;
    private readonly ConcurrentDictionary<string, IReadOnlySet<DateOnly>> _byVenue = new(StringComparer.OrdinalIgnoreCase);

    public VenueClosureStore(
        IOptions<VenuesOptions> options,
        IHostEnvironment environment,
        ILogger<VenueClosureStore> logger)
    {
        _logger = logger;

        var configured = options.Value.ClosureCachePath;
        _cachePath = Path.IsPathRooted(configured)
            ? configured
            : Path.Combine(environment.ContentRootPath, configured);

        Load();
    }

    public DateTimeOffset? LastUpdated { get; private set; }

    public IReadOnlySet<DateOnly> For(string venueId) =>
        _byVenue.GetValueOrDefault(venueId, Empty);

    public void Publish(string venueId, IReadOnlyList<DateOnly> dates)
    {
        _byVenue[venueId] = dates.ToHashSet();
        LastUpdated = DateTimeOffset.UtcNow;
        Save();
    }

    private sealed record CacheFile(DateTimeOffset FetchedAt, Dictionary<string, List<string>> Venues);

    private void Load()
    {
        if (!File.Exists(_cachePath))
        {
            return;
        }

        try
        {
            var cached = JsonSerializer.Deserialize<CacheFile>(File.ReadAllText(_cachePath));
            if (cached is null)
            {
                return;
            }

            foreach (var (venueId, values) in cached.Venues)
            {
                _byVenue[venueId] = values
                    .Select(value => DateOnly.TryParse(value, out var parsed) ? parsed : (DateOnly?)null)
                    .Where(date => date is not null)
                    .Select(date => date!.Value)
                    .ToHashSet();
            }

            LastUpdated = cached.FetchedAt;
            _logger.LogInformation("Loaded cached closures for {Count} venue(s)", _byVenue.Count);
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            _logger.LogDebug(ex, "Closure cache could not be read; starting empty");
        }
    }

    private void Save()
    {
        try
        {
            var payload = new CacheFile(
                DateTimeOffset.UtcNow,
                _byVenue.ToDictionary(
                    pair => pair.Key,
                    pair => pair.Value.Select(date => date.ToString("yyyy-MM-dd")).ToList()));

            File.WriteAllText(_cachePath, JsonSerializer.Serialize(payload));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // A read-only or ephemeral filesystem just means no warm cache.
            _logger.LogDebug(ex, "Could not write the closure cache");
        }
    }
}
