using System.Text.Json;
using System.Xml.Linq;
using Microsoft.Extensions.Options;
using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Resolves which TAIKO LABS cabinets are currently streaming.
///
/// Quota strategy: candidate video ids come from the channel's uploads playlist
/// (1 unit) and liveness is confirmed with a single videos.list call (1 unit),
/// so a poll costs 2 units instead of the 100 a search.list call would cost.
/// Demo mode uses the public RSS feed and costs nothing.
/// </summary>
public sealed class YouTubeLiveClient(
    HttpClient http,
    PublicLiveProbe probe,
    IOptions<YouTubeOptions> options,
    ILogger<YouTubeLiveClient> logger)
{
    private const string ApiBase = "https://www.googleapis.com/youtube/v3";

    private static readonly XNamespace Atom = "http://www.w3.org/2005/Atom";
    private static readonly XNamespace YtNs = "http://www.youtube.com/xml/schemas/2015";
    private static readonly XNamespace MediaNs = "http://search.yahoo.com/mrss/";

    private YouTubeOptions Options => options.Value;

    public async Task<LiveSnapshot> FetchAsync(Venue venue, CancellationToken ct)
    {
        var mode = Options.EffectiveMode;

        try
        {
            return mode switch
            {
                LiveSourceMode.Mock => BuildMockSnapshot(venue),
                LiveSourceMode.Public => await FetchFromPublicPagesAsync(venue, ct),
                LiveSourceMode.Api => await FetchFromApiAsync(venue, ct),
                _ => await FetchFromPublicPagesAsync(venue, ct),
            };
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to fetch live streams for '{Venue}' in {Mode} mode", venue.Id, mode);
            return LiveSnapshot.Empty(mode, ex.Message);
        }
    }

    // ---------------------------------------------------------------- API mode

    private async Task<LiveSnapshot> FetchFromApiAsync(Venue venue, CancellationToken ct)
    {
        if (!Options.HasApiKey)
        {
            return LiveSnapshot.Empty(LiveSourceMode.Api, "YouTube:ApiKey is not configured.");
        }

        var videoIds = await GetRecentVideoIdsAsync(venue, ct);
        if (videoIds.Count == 0)
        {
            return LiveSnapshot.Empty(LiveSourceMode.Api);
        }

        var candidates = await GetVideoDetailsAsync(venue, videoIds, ct);

        return BuildSnapshot(venue, candidates, LiveSourceMode.Api, isFallbackSource: false);
    }

    /// <summary>Reads the newest uploads (1 quota unit). Live broadcasts appear here once started.</summary>
    private async Task<List<string>> GetRecentVideoIdsAsync(Venue venue, CancellationToken ct)
    {
        var url = $"{ApiBase}/playlistItems?part=contentDetails" +
                  $"&maxResults={Options.MaxVideoIdsClamped}" +
                  $"&playlistId={Uri.EscapeDataString(YouTubeOptions.UploadsPlaylistId(venue.Definition.ChannelId))}" +
                  $"&key={Uri.EscapeDataString(Options.ApiKey)}";

        using var document = await GetJsonAsync(url, ct);

        var ids = new List<string>();
        if (document.RootElement.TryGetProperty("items", out var items))
        {
            foreach (var item in items.EnumerateArray())
            {
                var id = item.GetPropertyOrNull("contentDetails")?.GetPropertyOrNull("videoId")?.GetString();
                if (!string.IsNullOrWhiteSpace(id))
                {
                    ids.Add(id);
                }
            }
        }

        return ids;
    }

    /// <summary>Confirms liveness and reads titles/viewer counts (1 quota unit for up to 50 ids).</summary>
    private async Task<List<LiveStream>> GetVideoDetailsAsync(Venue venue, IReadOnlyList<string> videoIds, CancellationToken ct)
    {
        var url = $"{ApiBase}/videos?part=snippet,status,liveStreamingDetails" +
                  $"&id={Uri.EscapeDataString(string.Join(',', videoIds))}" +
                  $"&key={Uri.EscapeDataString(Options.ApiKey)}";

        using var document = await GetJsonAsync(url, ct);

        var results = new List<LiveStream>();
        if (!document.RootElement.TryGetProperty("items", out var items))
        {
            return results;
        }

        foreach (var item in items.EnumerateArray())
        {
            var videoId = item.GetPropertyOrNull("id")?.GetString();
            var snippet = item.GetPropertyOrNull("snippet");
            var title = snippet?.GetPropertyOrNull("title")?.GetString();

            if (string.IsNullOrWhiteSpace(videoId) || string.IsNullOrWhiteSpace(title))
            {
                continue;
            }

            var parsed = StreamTitleParser.Parse(venue.TitlePattern, title);
            if (parsed is null)
            {
                continue;
            }

            var liveDetails = item.GetPropertyOrNull("liveStreamingDetails");
            var isLive = string.Equals(
                snippet?.GetPropertyOrNull("liveBroadcastContent")?.GetString(),
                "live",
                StringComparison.OrdinalIgnoreCase);

            results.Add(new LiveStream
            {
                StationId = venue.ResolveStationId(parsed.Name),
                VideoId = videoId,
                Title = title,
                Name = parsed.Name,
                StreamDate = parsed.StreamDate,
                Part = parsed.Part,
                IsLive = isLive,
                Embeddable = item.GetPropertyOrNull("status")?.GetPropertyOrNull("embeddable")?.GetBoolean() ?? true,
                ConcurrentViewers = ParseLong(liveDetails?.GetPropertyOrNull("concurrentViewers")?.GetString()),
                ActualStartTime = ParseDate(liveDetails?.GetPropertyOrNull("actualStartTime")?.GetString()),
                PublishedAt = ParseDate(snippet?.GetPropertyOrNull("publishedAt")?.GetString()),
                ThumbnailUrl = ReadThumbnail(snippet),
            });
        }

        return results;
    }

    // ------------------------------------------------------------- Public mode

    /// <summary>
    /// Key-free path: the RSS feed lists recent videos (no quota, but it never says
    /// whether a video is live), so each candidate's live status is then confirmed
    /// against its public watch page. Anything not live right now is dropped, which
    /// is what keeps finished broadcasts from lingering as "replays".
    /// </summary>
    private async Task<LiveSnapshot> FetchFromPublicPagesAsync(Venue venue, CancellationToken ct)
    {
        var candidates = await ReadRssCandidatesAsync(venue, ct);
        if (candidates.Count == 0)
        {
            return LiveSnapshot.Empty(LiveSourceMode.Public);
        }

        var statuses = await probe.ProbeAsync(candidates.Select(c => c.VideoId), ct);

        var live = candidates
            .Where(candidate => statuses.TryGetValue(candidate.VideoId, out var status) && status.IsLiveNow)
            .Select(candidate => candidate with
            {
                IsLive = true,
                ActualStartTime = statuses[candidate.VideoId].StartedAt,
            })
            .ToList();

        return BuildSnapshot(venue, live, LiveSourceMode.Public, isFallbackSource: true);
    }

    /// <summary>Recent videos whose titles match the stream pattern. Costs no quota.</summary>
    private async Task<List<LiveStream>> ReadRssCandidatesAsync(Venue venue, CancellationToken ct)
    {
        using var response = await http.GetAsync(YouTubeOptions.RssFeedUrl(venue.Definition.ChannelId), ct);
        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        var feed = await XDocument.LoadAsync(stream, LoadOptions.None, ct);

        var entries = new List<LiveStream>();

        foreach (var entry in feed.Descendants(Atom + "entry"))
        {
            var videoId = entry.Element(YtNs + "videoId")?.Value;
            var title = entry.Element(Atom + "title")?.Value;

            if (string.IsNullOrWhiteSpace(videoId) || string.IsNullOrWhiteSpace(title))
            {
                continue;
            }

            // Skip anything already confirmed finished - it can never go live again.
            if (probe.IsKnownEnded(videoId))
            {
                continue;
            }

            var parsed = StreamTitleParser.Parse(venue.TitlePattern, title);
            if (parsed is null)
            {
                continue;
            }

            var group = entry.Element(MediaNs + "group");

            entries.Add(new LiveStream
            {
                StationId = venue.ResolveStationId(parsed.Name),
                VideoId = videoId,
                Title = title,
                Name = parsed.Name,
                StreamDate = parsed.StreamDate,
                Part = parsed.Part,
                IsLive = false,
                Embeddable = true,
                PublishedAt = ParseDate(entry.Element(Atom + "published")?.Value),
                ThumbnailUrl = group?.Element(MediaNs + "thumbnail")?.Attribute("url")?.Value,
            });
        }

        return entries;
    }

    // --------------------------------------------------------------- Mock mode

    /// <summary>
    /// Fully offline data for exercising the UI: a few stations "streaming" but flagged
    /// as non-embeddable, the rest empty so the 준비중 placeholder renders too.
    /// </summary>
    private static LiveSnapshot BuildMockSnapshot(Venue venue)
    {
        var today = DateOnly.FromDateTime(DateTime.Now).ToString("yy.MM.dd");

        // Every other cabinet, so both the live tile and the 준비중 placeholder render.
        var streams = venue.Stations
            .Where((_, index) => index % 2 == 0)
            .Select((s, index) => new LiveStream
            {
                StationId = s.Id,
                VideoId = $"mock-{venue.Id}-{s.Id}",
                Title = $"{venue.Name} {s.Label} Live Streaming {today} - 1부",
                Name = s.Label,
                StreamDate = today,
                Part = 1,
                IsLive = true,
                Embeddable = false,
                ConcurrentViewers = 10 + (index * 7),
                ActualStartTime = DateTimeOffset.UtcNow.AddMinutes(-30 - (index * 5)),
            })
            .ToList();

        return new LiveSnapshot
        {
            Streams = streams,
            Source = LiveSourceMode.Mock,
            IsFallbackSource = true,
        };
    }

    // ----------------------------------------------------------------- helpers

    /// <summary>
    /// Keeps one stream per station, highest 부 first then newest. Only live broadcasts
    /// survive: a station whose stream has ended must read as idle, not as a replay.
    /// </summary>
    private static LiveSnapshot BuildSnapshot(Venue venue, IReadOnlyList<LiveStream> candidates, LiveSourceMode source, bool isFallbackSource)
    {
        var live = candidates.Where(c => c.IsLive).ToList();

        var streams = live
            .Where(c => c.StationId is not null)
            .GroupBy(c => c.StationId!)
            .Select(group => group
                .OrderByDescending(c => c.Part ?? 0)
                .ThenByDescending(c => c.ActualStartTime ?? c.PublishedAt ?? DateTimeOffset.MinValue)
                .First())
            .OrderBy(c => venue.Stations.ToList().FindIndex(s => s.Id == c.StationId))
            .ToList();

        var unmatched = live.Where(c => c.StationId is null).ToList();

        return new LiveSnapshot
        {
            Streams = streams,
            Unmatched = unmatched,
            Source = source,
            IsFallbackSource = isFallbackSource,
        };
    }

    private async Task<JsonDocument> GetJsonAsync(string url, CancellationToken ct)
    {
        using var response = await http.GetAsync(url, ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException(
                $"YouTube API returned {(int)response.StatusCode} {response.ReasonPhrase}: {Truncate(body, 400)}");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        return await JsonDocument.ParseAsync(stream, cancellationToken: ct);
    }

    private static string? ReadThumbnail(JsonElement? snippet)
    {
        var thumbnails = snippet?.GetPropertyOrNull("thumbnails");
        if (thumbnails is null)
        {
            return null;
        }

        foreach (var size in (string[])["maxres", "standard", "high", "medium", "default"])
        {
            var url = thumbnails.Value.GetPropertyOrNull(size)?.GetPropertyOrNull("url")?.GetString();
            if (!string.IsNullOrWhiteSpace(url))
            {
                return url;
            }
        }

        return null;
    }

    private static long? ParseLong(string? value) =>
        long.TryParse(value, out var parsed) ? parsed : null;

    private static DateTimeOffset? ParseDate(string? value) =>
        DateTimeOffset.TryParse(value, out var parsed) ? parsed : null;

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max] + "...";
}

internal static class JsonElementExtensions
{
    /// <summary>Property lookup that yields null instead of throwing on a missing key.</summary>
    public static JsonElement? GetPropertyOrNull(this JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value)
            ? value
            : null;

    public static JsonElement? GetPropertyOrNull(this JsonElement? element, string name) =>
        element?.GetPropertyOrNull(name);
}
