using System.Globalization;

namespace TaikoLabs.Api.Services;

/// <summary>Minutes from that day's midnight. <see cref="EndMinutes"/> may exceed 1440.</summary>
public sealed record OpeningWindow(int StartMinutes, int EndMinutes)
{
    public bool EndsNextDay => EndMinutes > 24 * 60;

    public static OpeningWindow? Parse(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var parts = value.Split('-', 2, StringSplitOptions.TrimEntries);
        if (parts.Length != 2)
        {
            return null;
        }

        if (!TryParseMinutes(parts[0], out var start) || !TryParseMinutes(parts[1], out var end))
        {
            return null;
        }

        return end <= start ? null : new OpeningWindow(start, end);
    }

    public string Describe() => $"{Format(StartMinutes)}-{Format(EndMinutes)}";

    private static string Format(int minutes) =>
        $"{minutes / 60:D2}:{minutes % 60:D2}";

    private static bool TryParseMinutes(string value, out int minutes)
    {
        minutes = 0;

        var parts = value.Split(':', 2);
        if (parts.Length != 2
            || !int.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var hours)
            || !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var mins))
        {
            return false;
        }

        // Hours run past 24 on purpose to express a closing time after midnight.
        if (hours is < 0 or > 47 || mins is < 0 or > 59)
        {
            return false;
        }

        minutes = (hours * 60) + mins;
        return true;
    }
}
