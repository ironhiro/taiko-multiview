using System.Text.RegularExpressions;
using TaikoLabs.VenueEditor.Models;

namespace TaikoLabs.VenueEditor.Services;

/// <summary>
/// Mirrors the checks the API performs at startup, so a venue that would be silently
/// skipped there is caught here instead.
/// </summary>
public static class VenueValidator
{
    public sealed record Issue(bool IsError, string Message)
    {
        public override string ToString() => (IsError ? "✖ " : "▲ ") + Message;
    }

    public static IReadOnlyList<Issue> Validate(VenueDraft draft, IEnumerable<VenueDraft> allVenues)
    {
        var issues = new List<Issue>();

        if (string.IsNullOrWhiteSpace(draft.Id))
        {
            issues.Add(new Issue(true, "id가 비어 있습니다."));
        }
        else if (!Regex.IsMatch(draft.Id, "^[a-z0-9][a-z0-9-]*$"))
        {
            issues.Add(new Issue(false, "id는 영소문자·숫자·하이픈만 쓰는 편이 URL에서 안전합니다."));
        }

        var duplicates = allVenues.Count(other =>
            !ReferenceEquals(other, draft) && other.Id.Trim().Equals(draft.Id.Trim(), StringComparison.OrdinalIgnoreCase));

        if (duplicates > 0)
        {
            issues.Add(new Issue(true, $"id '{draft.Id}'가 다른 매장과 중복됩니다."));
        }

        if (string.IsNullOrWhiteSpace(draft.Name))
        {
            issues.Add(new Issue(false, "name이 비어 있습니다. 탭에 표시할 이름입니다."));
        }

        if (string.IsNullOrWhiteSpace(draft.ChannelId))
        {
            issues.Add(new Issue(true, "channelId가 없습니다. 이 매장은 로드되지 않습니다."));
        }
        else if (!Regex.IsMatch(draft.ChannelId.Trim(), "^UC[A-Za-z0-9_-]{22}$"))
        {
            issues.Add(new Issue(false, "channelId 형식이 일반적이지 않습니다 (UC + 22자)."));
        }

        if (!PatternBuilder.TryCompile(draft.TitlePattern, out _, out var patternError))
        {
            issues.Add(new Issue(true, $"titlePattern: {patternError}"));
        }

        var stations = draft.Stations.Where(station => station.Id.Trim().Length > 0).ToList();

        if (stations.Count == 0)
        {
            issues.Add(new Issue(true, "기체가 하나도 없습니다. 이 매장은 로드되지 않습니다."));
        }

        foreach (var group in stations.GroupBy(station => station.Id.Trim(), StringComparer.Ordinal).Where(g => g.Count() > 1))
        {
            issues.Add(new Issue(true, $"기체 id '{group.Key}'가 중복됩니다."));
        }

        foreach (var station in stations.Where(station => station.Label.Trim().Length == 0))
        {
            issues.Add(new Issue(false, $"기체 '{station.Id}'에 label이 없습니다."));
        }

        var zoneIds = draft.Zones.Select(zone => zone.Id.Trim()).Where(id => id.Length > 0).ToHashSet(StringComparer.Ordinal);

        foreach (var station in stations)
        {
            var zoneId = station.ZoneId.Trim();
            if (zoneId.Length > 0 && !zoneIds.Contains(zoneId))
            {
                issues.Add(new Issue(false, $"기체 '{station.Id}'의 zoneId '{zoneId}'에 해당하는 구역이 없습니다."));
            }
        }

        foreach (var hour in draft.Hours.Where(hour => !hour.IsClosed))
        {
            if (!TryParseMinutes(hour.Open, out var start) || !TryParseMinutes(hour.Close, out var end))
            {
                issues.Add(new Issue(true, $"{hour.DayLabel}요일 영업시간 형식이 잘못됐습니다 (HH:mm)."));
            }
            else if (end <= start)
            {
                issues.Add(new Issue(true, $"{hour.DayLabel}요일 마감이 오픈보다 빠릅니다. 자정을 넘기면 29:00처럼 적으세요."));
            }
        }

        foreach (var date in draft.ClosedDates.Split(['\n', '\r', ','], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!DateOnly.TryParse(date, out _))
            {
                issues.Add(new Issue(false, $"휴무일 '{date}'을 날짜로 읽을 수 없습니다 (yyyy-MM-dd)."));
            }
        }

        if (draft.Layout is null && draft.Zones.Count > 1)
        {
            issues.Add(new Issue(false, "배치도가 없어도 구역이 2개 이상이면 구역별 보기가 생깁니다. 의도한 것인지 확인하세요."));
        }

        return issues;
    }

    private static bool TryParseMinutes(string value, out int minutes)
    {
        minutes = 0;

        var parts = value.Trim().Split(':', 2);
        if (parts.Length != 2 || !int.TryParse(parts[0], out var hours) || !int.TryParse(parts[1], out var mins))
        {
            return false;
        }

        if (hours is < 0 or > 47 || mins is < 0 or > 59)
        {
            return false;
        }

        minutes = (hours * 60) + mins;
        return true;
    }
}
