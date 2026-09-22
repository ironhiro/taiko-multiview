using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Reads upcoming irregular closures from the venue's Naver place page.
///
/// Naver ships the mobile page with a hydration blob containing
/// <c>newBusinessHours[].comingIrregularClosedDays</c>, which is exactly the field the
/// owner fills in when the shop shuts for a day. There is no public API for it, so this
/// parses the hydration state — a best-effort source, queried once a day.
///
/// Every failure mode here is non-fatal: the caller keeps its previous answer, and the
/// app falls back to the configured weekly hours.
/// </summary>
public sealed partial class NaverClosureFeed(HttpClient http, ILogger<NaverClosureFeed> logger)
{
    [GeneratedRegex(@"window\.__APOLLO_STATE__\s*=\s*", RegexOptions.CultureInvariant)]
    private static partial Regex ApolloAssignment();

    /// <summary>Any yyyy-MM-dd found inside the closure subtree.</summary>
    [GeneratedRegex(@"(\d{4})-(\d{2})-(\d{2})", RegexOptions.CultureInvariant)]
    private static partial Regex IsoDate();

    /// <summary>Naver sometimes writes closures as bare "10.03" without a year.</summary>
    [GeneratedRegex(@"(?<!\d)(\d{1,2})\.(\d{1,2})(?!\d)", RegexOptions.CultureInvariant)]
    private static partial Regex MonthDay();

    public async Task<IReadOnlyList<DateOnly>?> FetchAsync(string placeId, CancellationToken ct)
    {
        try
        {
            var url = $"https://m.place.naver.com/place/{Uri.EscapeDataString(placeId)}/home";
            using var response = await http.GetAsync(url, ct);

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning(
                    "Naver place lookup returned {Status}; keeping the previous closure list",
                    (int)response.StatusCode);
                return null;
            }

            var html = await response.Content.ReadAsStringAsync(ct);
            var state = ExtractApolloState(html);
            if (state is null)
            {
                logger.LogWarning("Could not find the hydration state on the Naver place page");
                return null;
            }

            using var document = state;
            var subtrees = new List<string>();
            CollectClosureSubtrees(document.RootElement, subtrees);

            if (subtrees.Count == 0)
            {
                // The field is present but empty whenever nothing is scheduled.
                logger.LogDebug("Naver lists no upcoming closures");
                return [];
            }

            var dates = ParseDates(subtrees);
            logger.LogInformation("Naver reports {Count} upcoming closure(s)", dates.Count);
            return dates;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Naver closure lookup failed; keeping the previous closure list");
            return null;
        }
    }

    /// <summary>
    /// The assignment is followed by a JSON object and then more script, so the value is
    /// read with a streaming reader rather than by matching to a closing brace.
    /// </summary>
    private static JsonDocument? ExtractApolloState(string html)
    {
        var match = ApolloAssignment().Match(html);
        if (!match.Success)
        {
            return null;
        }

        var start = html.IndexOf('{', match.Index + match.Length);
        if (start < 0)
        {
            return null;
        }

        try
        {
            var reader = new Utf8JsonReader(
                System.Text.Encoding.UTF8.GetBytes(html[start..]),
                new JsonReaderOptions { AllowTrailingCommas = true });

            return JsonDocument.ParseValue(ref reader);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static void CollectClosureSubtrees(JsonElement element, List<string> found)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    if (property.NameEquals("comingIrregularClosedDays"))
                    {
                        var raw = property.Value.GetRawText();
                        if (raw is not ("[]" or "null"))
                        {
                            found.Add(raw);
                        }
                    }

                    CollectClosureSubtrees(property.Value, found);
                }

                break;

            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    CollectClosureSubtrees(item, found);
                }

                break;
        }
    }

    /// <summary>
    /// The populated shape is undocumented, so both an explicit yyyy-MM-dd and a bare
    /// month/day are accepted. A bare month/day is assumed to be the next occurrence.
    /// </summary>
    private static List<DateOnly> ParseDates(IEnumerable<string> subtrees)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(9)); // venue-local enough for a year guess
        var dates = new SortedSet<DateOnly>();

        foreach (var subtree in subtrees)
        {
            var sawIso = false;

            foreach (Match match in IsoDate().Matches(subtree))
            {
                if (DateOnly.TryParseExact(match.Value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
                {
                    dates.Add(parsed);
                    sawIso = true;
                }
            }

            if (sawIso)
            {
                continue;
            }

            foreach (Match match in MonthDay().Matches(subtree))
            {
                if (!int.TryParse(match.Groups[1].Value, out var month)
                    || !int.TryParse(match.Groups[2].Value, out var day)
                    || month is < 1 or > 12
                    || day is < 1 or > 31)
                {
                    continue;
                }

                foreach (var year in (int[])[today.Year, today.Year + 1])
                {
                    if (day > DateTime.DaysInMonth(year, month))
                    {
                        continue;
                    }

                    var candidate = new DateOnly(year, month, day);
                    if (candidate >= today)
                    {
                        dates.Add(candidate);
                        break;
                    }
                }
            }
        }

        return [.. dates];
    }
}
