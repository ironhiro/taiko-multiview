using System.Text;
using System.Text.RegularExpressions;

namespace TaikoLabs.VenueEditor.Services;

/// <summary>
/// Builds a title pattern from a real title by pointing at the cabinet name, which is
/// far easier to get right than writing the regex by hand.
/// </summary>
public static class PatternBuilder
{
    /// <summary>
    /// Given a sample title and the span holding the cabinet name, produces a pattern
    /// whose <c>name</c> group captures that span. Dates and part numbers in the
    /// surrounding text are generalised so the pattern keeps matching tomorrow.
    /// </summary>
    public static string FromSelection(string title, int selectionStart, int selectionLength)
    {
        if (selectionLength <= 0 || selectionStart < 0 || selectionStart + selectionLength > title.Length)
        {
            throw new ArgumentException("제목에서 기체명 부분을 선택해 주세요.");
        }

        var prefix = title[..selectionStart];
        var suffix = title[(selectionStart + selectionLength)..];

        var builder = new StringBuilder("^");
        builder.Append(@"\s*");
        builder.Append(Generalize(prefix));

        if (prefix.Length > 0 && !prefix.EndsWith(' '))
        {
            // No whitespace separates the prefix from the name, so do not invent any.
        }

        builder.Append("(?<name>.+?)");
        builder.Append(Generalize(suffix));
        builder.Append(@"\s*$");

        return builder.ToString();
    }

    /// <summary>
    /// Escapes literal text, then relaxes the two things that change between broadcasts:
    /// runs of whitespace become <c>\s+</c> and runs of digits become <c>\d+</c>.
    /// </summary>
    private static string Generalize(string text)
    {
        if (text.Length == 0)
        {
            return string.Empty;
        }

        var tokens = text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var parts = tokens.Select(token => Regex.Replace(Regex.Escape(token), @"\d+", @"\d+"));

        var joined = string.Join(@"\s+", parts);

        // Preserve whether the original text had padding on either side.
        var leading = text.Length > 0 && char.IsWhiteSpace(text[0]) ? @"\s+" : string.Empty;
        var trailing = text.Length > 0 && char.IsWhiteSpace(text[^1]) ? @"\s+" : string.Empty;

        return leading + joined + trailing;
    }

    /// <summary>Compiles a pattern for previewing, or explains why it cannot be used.</summary>
    public static bool TryCompile(string pattern, out Regex? regex, out string? error)
    {
        regex = null;
        error = null;

        if (string.IsNullOrWhiteSpace(pattern))
        {
            error = "패턴이 비어 있습니다.";
            return false;
        }

        try
        {
            var compiled = new Regex(
                pattern,
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant,
                TimeSpan.FromMilliseconds(250));

            if (!compiled.GetGroupNames().Contains("name"))
            {
                error = "(?<name>...) 그룹이 없습니다. 기체명을 잡는 그룹이 반드시 필요합니다.";
                return false;
            }

            regex = compiled;
            return true;
        }
        catch (ArgumentException ex)
        {
            error = $"정규식 오류: {ex.Message}";
            return false;
        }
    }
}
