using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;
using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Builds the venue list from configuration once, dropping any entry that cannot work
/// rather than letting it fail later on every poll.
/// </summary>
public sealed class VenueRegistry
{
    private readonly Dictionary<string, Venue> _byId;

    public VenueRegistry(IOptions<VenuesOptions> options, ILogger<VenueRegistry> logger)
    {
        Options = options.Value;

        var venues = new List<Venue>();

        foreach (var definition in Options.Items)
        {
            if (!Validate(definition, logger, out var reason))
            {
                logger.LogError("Venue '{Id}' was skipped: {Reason}", definition.Id, reason);
                continue;
            }

            var venue = Venue.Create(definition);
            venue.ResolveClosedDates();
            venues.Add(venue);

            logger.LogInformation(
                "Venue '{Id}' ({Name}): {Stations} cabinet(s), layout {Layout}",
                venue.Id,
                venue.Name,
                venue.Stations.Count,
                venue.HasLayout ? "yes" : "no");
        }

        All = venues;
        _byId = venues.ToDictionary(venue => venue.Id, StringComparer.OrdinalIgnoreCase);

        if (venues.Count == 0)
        {
            logger.LogError("No usable venues are configured; the app will show nothing.");
        }

        if (!Options.TryResolveTimeZone(out var timeZone, out var error))
        {
            logger.LogError("{Error} Opening hours will be wrong until this is fixed.", error);
        }

        TimeZone = timeZone;
    }

    public VenuesOptions Options { get; }

    public IReadOnlyList<Venue> All { get; }

    public TimeZoneInfo TimeZone { get; }

    public Venue? Find(string id) => _byId.GetValueOrDefault(id);

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
