using System.Net.Http;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace TaikoLabs.VenueEditor.Services;

/// <summary>
/// Turns whatever a person pastes — a handle, a channel URL, a bare id — into a channel
/// id, then lists recent stream titles from the public RSS feed so the title pattern can
/// be written against real data instead of guesswork.
/// </summary>
public sealed partial class ChannelLookup
{
    private static readonly XNamespace Atom = "http://www.w3.org/2005/Atom";
    private static readonly XNamespace YtNs = "http://www.youtube.com/xml/schemas/2015";

    private readonly HttpClient _http = new()
    {
        Timeout = TimeSpan.FromSeconds(20),
    };

    public ChannelLookup() =>
        _http.DefaultRequestHeaders.UserAgent.ParseAdd(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36");

    [GeneratedRegex(@"^UC[A-Za-z0-9_-]{22}$", RegexOptions.CultureInvariant)]
    private static partial Regex BareChannelId();

    [GeneratedRegex(@"""channelId""\s*:\s*""(UC[A-Za-z0-9_-]{22})""", RegexOptions.CultureInvariant)]
    private static partial Regex EmbeddedChannelId();

    /// <summary>Accepts a channel id, a /channel/ URL, an @handle, or a handle URL.</summary>
    public async Task<string?> ResolveChannelIdAsync(string input, CancellationToken ct = default)
    {
        var value = input.Trim();
        if (value.Length == 0)
        {
            return null;
        }

        if (BareChannelId().IsMatch(value))
        {
            return value;
        }

        var fromUrl = Regex.Match(value, @"/channel/(UC[A-Za-z0-9_-]{22})");
        if (fromUrl.Success)
        {
            return fromUrl.Groups[1].Value;
        }

        var url = value.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? value
            : $"https://www.youtube.com/{(value.StartsWith('@') ? value : "@" + value)}";

        using var response = await _http.GetAsync(url, ct);
        if (!response.IsSuccessStatusCode)
        {
            return null;
        }

        var html = await response.Content.ReadAsStringAsync(ct);
        var match = EmbeddedChannelId().Match(html);

        return match.Success ? match.Groups[1].Value : null;
    }

    /// <summary>The 15 most recent videos. Costs no API quota.</summary>
    public async Task<IReadOnlyList<string>> FetchRecentTitlesAsync(string channelId, CancellationToken ct = default)
    {
        var url = $"https://www.youtube.com/feeds/videos.xml?channel_id={Uri.EscapeDataString(channelId)}";

        using var response = await _http.GetAsync(url, ct);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        var feed = await XDocument.LoadAsync(stream, LoadOptions.None, ct);

        return feed.Descendants(Atom + "entry")
            .Select(entry => entry.Element(Atom + "title")?.Value ?? string.Empty)
            .Where(title => title.Length > 0)
            .ToList();
    }

    public async Task<string?> FetchChannelNameAsync(string channelId, CancellationToken ct = default)
    {
        var url = $"https://www.youtube.com/feeds/videos.xml?channel_id={Uri.EscapeDataString(channelId)}";

        using var response = await _http.GetAsync(url, ct);
        if (!response.IsSuccessStatusCode)
        {
            return null;
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        var feed = await XDocument.LoadAsync(stream, LoadOptions.None, ct);

        return feed.Root?.Element(Atom + "author")?.Element(Atom + "name")?.Value;
    }

    /// <summary>Video ids, kept alongside titles for anyone who wants to check a stream.</summary>
    public static string WatchUrl(string videoId) => $"https://www.youtube.com/watch?v={videoId}";

    public static string? VideoIdOf(XElement entry) => entry.Element(YtNs + "videoId")?.Value;
}
