using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;
using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Builds the venue list from its source, dropping any entry that cannot work rather
/// than letting it fail later on every poll - and builds it again whenever the source
/// changes, so the venue editor's saves show up without restarting the API.
///
/// Each build is a complete snapshot swapped in at once: a poll that is halfway through
/// the old list never sees a half-built new one.
/// </summary>
public sealed class VenueRegistry : IDisposable
{
    private readonly IVenueSource _source;
    private readonly IOptionsMonitor<VenuesOptions> _settings;
    private readonly ILogger<VenueRegistry> _logger;
    private readonly IDisposable? _sourceSubscription;
    private readonly IDisposable? _settingsSubscription;
    private Snapshot _current;

    private sealed record Snapshot(
        IReadOnlyList<Venue> All,
        Dictionary<string, Venue> ById,
        string TimeZoneId,
        TimeZoneInfo TimeZone,
        int Version);

    public VenueRegistry(IVenueSource source, IOptionsMonitor<VenuesOptions> settings, ILogger<VenueRegistry> logger)
    {
        _source = source;
        _settings = settings;
        _logger = logger;
        _current = Build(source.Load(), settings.CurrentValue, version: 1);

        // The file watcher can fire more than once for a single save; rebuilding is cheap
        // and gives the same result, so every notification simply rebuilds.
        _sourceSubscription = source.OnChange(() => Rebuild(_settings.CurrentValue));

        // The time zone is a global setting, but opening hours are worked out in it, so a
        // new one has to reach the list too. With the venue file it arrives in the same
        // reload as the list, and the two notifications run in no fixed order: when the
        // source's runs first it may still read the old settings, and this one catches the
        // difference. Comparing first keeps the usual reload, time zone unchanged, at one
        // rebuild.
        _settingsSubscription = settings.OnChange(next =>
        {
            if (!string.Equals(next.TimeZone, _current.TimeZoneId, StringComparison.Ordinal))
            {
                Rebuild(next);
            }
        });
    }

    /// <summary>The global settings as they are now, shared by every venue.</summary>
    public VenuesOptions Options => _settings.CurrentValue;

    public IReadOnlyList<Venue> All => _current.All;

    public TimeZoneInfo TimeZone => _current.TimeZone;

    /// <summary>Goes up on every rebuild; clients compare it to know their venue list is stale.</summary>
    public int Version => _current.Version;

    public Venue? Find(string id) => _current.ById.GetValueOrDefault(id);

    public void Dispose()
    {
        _sourceSubscription?.Dispose();
        _settingsSubscription?.Dispose();
    }

    private void Rebuild(VenuesOptions settings)
    {
        var rebuilt = Build(_source.Load(), settings, _current.Version + 1);
        _current = rebuilt;
        _logger.LogInformation("Venue settings reloaded: {Count} venue(s), version {Version}", rebuilt.All.Count, rebuilt.Version);
    }

    private Snapshot Build(IReadOnlyList<VenueDefinition> definitions, VenuesOptions settings, int version)
    {
        var venues = new List<Venue>();

        foreach (var definition in definitions)
        {
            if (!Validate(definition, _logger, out var reason))
            {
                _logger.LogError("Venue '{Id}' was skipped: {Reason}", definition.Id, reason);
                continue;
            }

            var venue = Venue.Create(definition);
            venue.ResolveClosedDates();
            venues.Add(venue);

            _logger.LogInformation(
                "Venue '{Id}' ({Name}): {Stations} cabinet(s), layout {Layout}",
                venue.Id,
                venue.Name,
                venue.Stations.Count,
                venue.HasLayout ? "yes" : "no");
        }

        if (venues.Count == 0)
        {
            _logger.LogError("No usable venues are configured; the app will show nothing.");
        }

        if (!settings.TryResolveTimeZone(out var timeZone, out var error))
        {
            _logger.LogError("{Error} Opening hours will be wrong until this is fixed.", error);
        }

        return new Snapshot(
            venues,
            venues.ToDictionary(venue => venue.Id, StringComparer.OrdinalIgnoreCase),
            settings.TimeZone,
            timeZone,
            version);
    }

    private static bool Validate(VenueDefinition definition, ILogger logger, out string reason)
    {
        if (string.IsNullOrWhiteSpace(definition.Id))
        {
            reason = "no id";
            return false;
        }

        if (string.IsNullOrWhiteSpace(definition.ChannelId))
        {
            reason = "no channelId";
            return false;
        }

        if (definition.Stations.Count == 0)
        {
            reason = "no stations";
            return false;
        }

        if (string.IsNullOrWhiteSpace(definition.TitlePattern))
        {
            reason = "no titlePattern";
            return false;
        }

        try
        {
            var probe = new Regex(definition.TitlePattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            if (!probe.GetGroupNames().Contains("name"))
            {
                reason = "titlePattern has no (?<name>...) group";
                return false;
            }
        }
        catch (ArgumentException ex)
        {
            reason = $"titlePattern is not a valid regex: {ex.Message}";
            return false;
        }

        // A layout that references unknown cabinets would silently render empty slots.
        if (definition.Layout is { } layout)
        {
            var known = definition.Stations.Select(station => station.Id).ToHashSet(StringComparer.Ordinal);
            var orphans = layout.Units.Where(unit => !known.Contains(unit.StationId)).ToList();

            if (orphans.Count > 0)
            {
                logger.LogWarning(
                    "Venue '{Id}' layout references unknown cabinet(s): {Ids}",
                    definition.Id,
                    string.Join(", ", orphans.Select(unit => unit.StationId)));
            }
        }

        reason = string.Empty;
        return true;
    }
}
