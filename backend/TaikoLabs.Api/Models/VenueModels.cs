namespace TaikoLabs.Api.Models;

/// <summary>
/// Everything that makes one venue different from another, as written in configuration.
/// Adding a venue should never require a code change.
/// </summary>
public sealed class VenueDefinition
{
    public string Id { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    /// <summary>Accent colour for the venue tab. Venues are separate businesses, not branches.</summary>
    public string? Accent { get; set; }

    /// <summary>
    /// Optional logo, as a path under the frontend's <c>logos/</c> folder or an absolute URL.
    /// Wins over the channel's profile picture, which is used when this is empty.
    /// </summary>
    public string? Logo { get; set; }

    public string ChannelId { get; set; } = string.Empty;

    /// <summary>Public channel link, shown so traffic can find its way back to the venue.</summary>
    public string? ChannelUrl { get; set; }

    /// <summary>
    /// Regex over the stream title. Must expose a <c>name</c> group identifying the cabinet;
    /// <c>date</c> and <c>part</c> are optional.
    /// </summary>
    public string TitlePattern { get; set; } = string.Empty;

    /// <summary>Optional grouping shown as extra entries in the view picker.</summary>
    public List<ZoneDefinition> Zones { get; set; } = [];

    public List<StationDefinition> Stations { get; set; } = [];

    /// <summary>
    /// Floor plan geometry. Null for venues that do not publish a map — those get the
    /// plain grid only, and the 배치도 entry never appears in their view picker.
    /// </summary>
    public LayoutDefinition? Layout { get; set; }

    /// <summary>Opening hours per weekday, e.g. <c>"07:00-29:00"</c> for a 05:00 close next morning.</summary>
    public Dictionary<string, string> Hours { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public List<string> ClosedDates { get; set; } = [];

    /// <summary>Naver place id used for the daily irregular-closure lookup. Null disables it.</summary>
    public string? NaverPlaceId { get; set; }
}

public sealed class ZoneDefinition
{
    public string Id { get; set; } = string.Empty;

    /// <summary>Printed on the floor plan, e.g. "SECTOR A".</summary>
    public string Code { get; set; } = string.Empty;

    /// <summary>Shown in the view picker, e.g. "A 사이트".</summary>
    public string Label { get; set; } = string.Empty;
}

public sealed class StationDefinition
{
    public string Id { get; set; } = string.Empty;

    public string Label { get; set; } = string.Empty;

    public string? ZoneId { get; set; }

    /// <summary>Extra spellings that should resolve to this cabinet, beyond the label itself.</summary>
    public List<string> Aliases { get; set; } = [];
}

public sealed class LayoutDefinition
{
    public SizeDefinition Canvas { get; set; } = new();

    /// <summary>Side of the square a cabinet occupies on the source map.</summary>
    public double UnitSize { get; set; } = 130;

    /// <summary>Width of the 16:9 video tile drawn over that square.</summary>
    public double TileWidth { get; set; } = 230;

    public List<LayoutZone> Zones { get; set; } = [];

    public List<LayoutUnit> Units { get; set; } = [];

    /// <summary>Rooms drawn for orientation but never streamed, such as a lounge.</summary>
    public List<LayoutDecoration> Decorations { get; set; } = [];
}

public sealed class SizeDefinition
{
    public double Width { get; set; }

    public double Height { get; set; }
}

public sealed class RectDefinition
{
    public double X { get; set; }

    public double Y { get; set; }

    public double Width { get; set; }

    public double Height { get; set; }
}

public sealed class LayoutZone
{
    public string Id { get; set; } = string.Empty;

    public RectDefinition Outline { get; set; } = new();
}

public sealed class LayoutUnit
{
    public string StationId { get; set; } = string.Empty;

    /// <summary>Top-left of the cabinet square on the source map.</summary>
    public double X { get; set; }

    public double Y { get; set; }
}

public sealed class LayoutDecoration
{
    public string Label { get; set; } = string.Empty;

    public string? Note { get; set; }

    public RectDefinition Outline { get; set; } = new();
}

/// <summary>Global settings shared by every venue.</summary>
public sealed class VenuesOptions
{
    public const string SectionName = "Venues";

    public string TimeZone { get; set; } = "Asia/Seoul";

    /// <summary>Local hour at which the daily closure lookup runs.</summary>
    public int ClosureRefreshHour { get; set; } = 5;

    public string ClosureCachePath { get; set; } = "closures.cache.json";

    public List<VenueDefinition> Items { get; set; } = [];

    /// <summary>
    /// Resolves the configured zone. Falling back to UTC would silently shift every
    /// opening time by nine hours, so the failure is reported rather than swallowed.
    /// </summary>
    public bool TryResolveTimeZone(out TimeZoneInfo timeZone, out string? error)
    {
        try
        {
            timeZone = TimeZoneInfo.FindSystemTimeZoneById(TimeZone);
            error = null;
            return true;
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            timeZone = TimeZoneInfo.Utc;
            error = $"Time zone '{TimeZone}' could not be resolved ({ex.GetType().Name}); falling back to UTC.";
            return false;
        }
    }
}
