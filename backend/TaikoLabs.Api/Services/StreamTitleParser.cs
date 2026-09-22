using System.Globalization;
using System.Text.RegularExpressions;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Pulls the cabinet name out of a stream title using the venue's own pattern.
/// Every venue writes its titles differently, so the pattern is configuration rather
/// than a constant — only the <c>name</c> group is required.
/// </summary>
public static class StreamTitleParser
{
    public sealed record ParsedTitle(string Name, string? StreamDate, int? Part);

    public static ParsedTitle? Parse(Regex pattern, string? title)
    {
        if (string.IsNullOrWhiteSpace(title))
        {
            return null;
        }

        Match match;
        try
        {
            match = pattern.Match(title);
        }
        catch (RegexMatchTimeoutException)
        {
            // A pathological configured pattern must not take the whole poll down.
            return null;
        }

        if (!match.Success)
        {
            return null;
        }

        var name = match.Groups["name"].Value.Trim();
        if (name.Length == 0)
        {
            return null;
        }

        var date = match.Groups["date"] is { Success: true } dateGroup ? dateGroup.Value : null;

        int? part = match.Groups["part"] is { Success: true } partGroup
            && int.TryParse(partGroup.Value, NumberStyles.None, CultureInfo.InvariantCulture, out var parsedPart)
                ? parsedPart
                : null;

        return new ParsedTitle(name, date, part);
    }
}
