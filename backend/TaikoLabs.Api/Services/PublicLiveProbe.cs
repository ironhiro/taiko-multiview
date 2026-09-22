using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Determines liveness without an API key by reading the public watch page, which
/// carries a <c>liveBroadcastDetails</c> object:
///
/// <code>
/// live:  {"isLiveNow":true,"startTimestamp":"..."}
/// ended: {"isLiveNow":false,"startTimestamp":"...","endTimestamp":"..."}
/// </code>
///
/// This is a best-effort fallback that depends on YouTube's page markup, not a
/// supported API. Configure <c>YouTube:ApiKey</c> for the reliable path.
///
/// A watch page is ~1.2 MB, so two things keep the cost down: reading stops as soon
/// as the marker is found, and a video seen to have ended is remembered forever —
/// broadcasts never restart, so those are never fetched again. In steady state only
/// newly published videos are probed.
/// </summary>
public sealed partial class PublicLiveProbe(
    HttpClient http,
    EndedBroadcastCache endedCache,
    ILogger<PublicLiveProbe> logger)
{
    /// <summary>The marker sits around 60% into the page; stop well after that rather than reading it all.</summary>
    private const int MaxBytesToScan = 1_400_000;

    private const int MaxConcurrentProbes = 4;

    [GeneratedRegex(@"""liveBroadcastDetails"":\s*(\{[^}]*\})", RegexOptions.CultureInvariant)]
    private static partial Regex LiveBroadcastDetails();

    public sealed record LiveStatus(bool IsLiveNow, DateTimeOffset? StartedAt, bool HasEnded);

    public bool IsKnownEnded(string videoId) => endedCache.Contains(videoId);

    /// <summary>Probes several videos at once, skipping any already known to have ended.</summary>
    public async Task<Dictionary<string, LiveStatus>> ProbeAsync(IEnumerable<string> videoIds, CancellationToken ct)
    {
        var pending = videoIds.Where(id => !IsKnownEnded(id)).Distinct().ToList();
        var results = new ConcurrentDictionary<string, LiveStatus>();

        if (pending.Count == 0)
        {
            return new Dictionary<string, LiveStatus>();
        }

        using var gate = new SemaphoreSlim(MaxConcurrentProbes);

        await Task.WhenAll(pending.Select(async videoId =>
        {
            await gate.WaitAsync(ct);
            try
            {
                var status = await ProbeOneAsync(videoId, ct);
                if (status is null)
                {
                    return;
                }

                results[videoId] = status;

                if (status.HasEnded)
                {
                    endedCache.Add(videoId);
                }
            }
            finally
            {
                gate.Release();
            }
        }));

        return new Dictionary<string, LiveStatus>(results);
    }

    private async Task<LiveStatus?> ProbeOneAsync(string videoId, CancellationToken ct)
    {
        try
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Get,
                $"https://www.youtube.com/watch?v={Uri.EscapeDataString(videoId)}");

            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogDebug("Watch page for {VideoId} returned {Status}", videoId, (int)response.StatusCode);
                return null;
            }

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            var payload = await ReadUntilMarkerAsync(stream, ct);

            var match = LiveBroadcastDetails().Match(payload);
            if (!match.Success)
            {
                // No broadcast details at all means it is a plain upload, not a stream.
                return new LiveStatus(false, null, HasEnded: true);
            }

            using var details = JsonDocument.Parse(match.Groups[1].Value);
            var root = details.RootElement;

            var isLiveNow = root.TryGetProperty("isLiveNow", out var liveNow)
                && liveNow.ValueKind == JsonValueKind.True;

            var hasEnded = root.TryGetProperty("endTimestamp", out _);

            DateTimeOffset? startedAt =
                root.TryGetProperty("startTimestamp", out var start)
                && DateTimeOffset.TryParse(start.GetString(), out var parsed)
                    ? parsed
                    : null;

            return new LiveStatus(isLiveNow, startedAt, hasEnded);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "Could not probe liveness for {VideoId}", videoId);
            return null;
        }
    }

    /// <summary>
    /// Reads only as far as the marker. Bails out at <see cref="MaxBytesToScan"/> so a
    /// page without one cannot pull the whole document into memory.
    /// </summary>
    private static async Task<string> ReadUntilMarkerAsync(Stream stream, CancellationToken ct)
    {
        const string marker = "\"liveBroadcastDetails\"";
        // Enough trailing room for the JSON object that follows the marker.
        const int tailBytes = 512;

        var builder = new StringBuilder();
        var buffer = new char[16 * 1024];
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: false);

        var markerIndex = -1;

        while (builder.Length < MaxBytesToScan)
        {
            var read = await reader.ReadAsync(buffer, ct);
            if (read == 0)
            {
                break;
            }

            var searchFrom = Math.Max(0, builder.Length - marker.Length);
            builder.Append(buffer, 0, read);

            if (markerIndex < 0)
            {
                markerIndex = builder.ToString(searchFrom, builder.Length - searchFrom) is var chunk
                    && chunk.Contains(marker, StringComparison.Ordinal)
                        ? searchFrom + chunk.IndexOf(marker, StringComparison.Ordinal)
                        : -1;
            }

            if (markerIndex >= 0 && builder.Length >= markerIndex + marker.Length + tailBytes)
            {
                break;
            }
        }

        return builder.ToString();
    }

}
