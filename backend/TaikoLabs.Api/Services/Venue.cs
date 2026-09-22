using System.Text.RegularExpressions;
using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// A validated venue: its configuration plus the derived lookups the rest of the app needs.
/// Built once at startup by <see cref="VenueRegistry"/>.
/// </summary>
public sealed class Venue
{
    /// <summary>
    /// Title patterns come from configuration, so a bad one must not be able to hang a
    /// thread through catastrophic backtracking.
    /// </summary>
    private static readonly TimeSpan MatchTimeout = TimeSpan.FromMilliseconds(250);

    private readonly Dictionary<string, string> _aliasToStationId;
    private readonly Dictionary<string, StationDefinition> _stationsById;

    private Venue(VenueDefinition definition, Regex titlePattern)
    {
        Definition = definition;
        TitlePattern = titlePattern;

        _stationsById = definition.Stations.ToDictionary(station => station.Id, StringComparer.Ordinal);
        _aliasToStationId = BuildAliasIndex(definition.Stations);
    }

    public VenueDefinition Definition { get; }

    public Regex TitlePattern { get; }

    public string Id => Definition.Id;

    public string Name => Definition.Name;

    public IReadOnlyList<StationDefinition> Stations => Definition.Stations;

    public bool HasLayout => Definition.Layout is not null;

    public static Venue Create(VenueDefinition definition)
    {
        var pattern = new Regex(definition.TitlePattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, MatchTimeout);
        return new Venue(definition, pattern);
    }

    public StationDefinition? Station(string stationId) =>
        _stationsById.GetValueOrDefault(stationId);

    /// <summary>
    /// Maps the <c>name</c> captured from a stream title onto a cabinet id. Matching
    /// ignores case, whitespace and separators so "THE BASE", "the-base" and
    /// "SECTOR A 1번 기체" all land where they should.
    /// </summary>
    public string? ResolveStationId(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        var normalized = Normalize(name);
        return normalized.Length == 0 ? null : _aliasToStationId.GetValueOrDefault(normalized);
    }

    public OpeningWindow? WindowFor(DayOfWeek day)
    {
        foreach (var key in (string[])[day.ToString(), day.ToString()[..3]])
        {
            if (Definition.Hours.TryGetValue(key, out var value))
            {
                return OpeningWindow.Parse(value);
            }
        }

        return null;
    }

    public IReadOnlySet<DateOnly> ManualClosedDates { get; private set; } = new HashSet<DateOnly>();

    internal void ResolveClosedDates()
    {
        var dates = new HashSet<DateOnly>();

        foreach (var raw in Definition.ClosedDates)
        {
            if (DateOnly.TryParse(raw, out var date))
            {
                dates.Add(date);
            }
        }

        ManualClosedDates = dates;
    }

    private static Dictionary<string, string> BuildAliasIndex(IEnumerable<StationDefinition> stations)
    {
        var index = new Dictionary<string, string>(StringComparer.Ordinal);

        foreach (var station in stations)
        {
            foreach (var alias in station.Aliases.Prepend(station.Label).Prepend(station.Id))
            {
                var key = Normalize(alias);
                if (key.Length > 0)
                {
                    // First definition wins, so an explicit alias cannot be clobbered later.
                    index.TryAdd(key, station.Id);
                }
            }
        }

        return index;
    }

    /// <summary>Uppercases and strips everything that is not a letter or digit.</summary>
    private static string Normalize(string value)
    {
        Span<char> buffer = stackalloc char[value.Length];
        var length = 0;

        foreach (var ch in value)
        {
            if (char.IsLetterOrDigit(ch))
            {
                buffer[length++] = char.ToUpperInvariant(ch);
            }
        }

        return new string(buffer[..length]);
    }
}
