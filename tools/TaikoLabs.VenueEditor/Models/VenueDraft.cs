using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;

namespace TaikoLabs.VenueEditor.Models;

public abstract class Observable : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    protected void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }

    protected void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

/// <summary>One venue being edited. Mirrors the <c>Venues:Items[]</c> shape.</summary>
public sealed class VenueDraft : Observable
{
    private string _id = string.Empty;
    private string _name = string.Empty;
    private string _accent = "#E8B24A";
    private string _channelId = string.Empty;
    private string _channelUrl = string.Empty;
    private string _titlePattern = string.Empty;
    private string _naverPlaceId = string.Empty;
    private string _closedDates = string.Empty;

    public string Id
    {
        get => _id;
        set { Set(ref _id, value); Raise(nameof(Display)); }
    }

    public string Name
    {
        get => _name;
        set { Set(ref _name, value); Raise(nameof(Display)); }
    }

    public string Accent { get => _accent; set => Set(ref _accent, value); }

    public string ChannelId { get => _channelId; set => Set(ref _channelId, value); }

    public string ChannelUrl { get => _channelUrl; set => Set(ref _channelUrl, value); }

    public string TitlePattern { get => _titlePattern; set => Set(ref _titlePattern, value); }

    public string NaverPlaceId { get => _naverPlaceId; set => Set(ref _naverPlaceId, value); }

    /// <summary>One <c>yyyy-MM-dd</c> per line.</summary>
    public string ClosedDates { get => _closedDates; set => Set(ref _closedDates, value); }

    public ObservableCollection<StationDraft> Stations { get; } = [];

    public ObservableCollection<ZoneDraft> Zones { get; } = [];

    public ObservableCollection<HourDraft> Hours { get; } = [];

    /// <summary>
    /// Kept as raw JSON and written back untouched. This editor deliberately does not
    /// edit floor plan coordinates — there is no sane way to type them, and the venues
    /// being added here do not publish a map.
    /// </summary>
    public JsonNode? Layout { get; set; }

    public string Display => string.IsNullOrWhiteSpace(Name) ? (Id.Length > 0 ? Id : "(이름 없음)") : Name;

    public string LayoutSummary => Layout is JsonObject layout && layout["units"] is JsonArray units
        ? $"좌표 {units.Count}개 — 저장 시 그대로 보존됩니다."
        : "없음 — 이 매장은 그리드 보기만 제공합니다.";

    public static VenueDraft CreateNew() => WithDefaultHours(new VenueDraft
    {
        Id = "new-venue",
        Name = "새 매장",
        Accent = "#5B8DEF",
    });

    public static VenueDraft WithDefaultHours(VenueDraft draft)
    {
        if (draft.Hours.Count == 0)
        {
            foreach (var day in HourDraft.WeekOrder)
            {
                draft.Hours.Add(new HourDraft(day) { Open = "10:00", Close = "24:00" });
            }
        }

        return draft;
    }
}

public sealed class StationDraft : Observable
{
    private string _id = string.Empty;
    private string _label = string.Empty;
    private string _zoneId = string.Empty;
    private string _aliases = string.Empty;

    public string Id { get => _id; set => Set(ref _id, value); }

    public string Label { get => _label; set => Set(ref _label, value); }

    public string ZoneId { get => _zoneId; set => Set(ref _zoneId, value); }

    /// <summary>Comma separated in the grid; split on save.</summary>
    public string Aliases { get => _aliases; set => Set(ref _aliases, value); }
}

public sealed class ZoneDraft : Observable
{
    private string _id = string.Empty;
    private string _code = string.Empty;
    private string _label = string.Empty;

    public string Id { get => _id; set => Set(ref _id, value); }

    public string Code { get => _code; set => Set(ref _code, value); }

    public string Label { get => _label; set => Set(ref _label, value); }
}

public sealed class HourDraft : Observable
{
    public static readonly string[] WeekOrder =
        ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    private static readonly Dictionary<string, string> KoreanNames = new()
    {
        ["Monday"] = "월", ["Tuesday"] = "화", ["Wednesday"] = "수", ["Thursday"] = "목",
        ["Friday"] = "금", ["Saturday"] = "토", ["Sunday"] = "일",
    };

    private string _open = "10:00";
    private string _close = "24:00";
    private bool _isClosed;

    public HourDraft(string day) => Day = day;

    public string Day { get; }

    public string DayLabel => KoreanNames.GetValueOrDefault(Day, Day);

    public string Open { get => _open; set => Set(ref _open, value); }

    /// <summary>Hours past 24 express a closing time after midnight, e.g. 29:00 is 05:00.</summary>
    public string Close { get => _close; set => Set(ref _close, value); }

    public bool IsClosed { get => _isClosed; set => Set(ref _isClosed, value); }

    public string Value => IsClosed ? string.Empty : $"{Open.Trim()}-{Close.Trim()}";
}
