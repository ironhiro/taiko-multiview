using System.Globalization;
using System.Net;
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

    /// <summary>
    /// One poll of one venue: the live snapshot, and - from the same answers - what 다시보기
    /// keeps (<see cref="ReplayArchive"/>). <paramref name="replay"/> says how far back to fill
    /// the archive on this poll, if at all; without it nothing is read beyond the usual page.
    /// </summary>
    public async Task<LivePoll> FetchAsync(Venue venue, CancellationToken ct, ReplayFetch? replay = null)
    {
        var mode = Options.EffectiveMode;

        try
        {
            return mode switch
            {
                LiveSourceMode.Mock => new LivePoll(
                    BuildMockSnapshot(venue, Options.MockVideoIds),
                    BuildMockReplay(venue, Options.MockVideoIds, replay?.TimeZone ?? TimeZoneInfo.Utc, DateTimeOffset.UtcNow, Options.ReplayDaysClamped)),
                LiveSourceMode.Public => await FetchFromPublicPagesAsync(venue, ct),
                LiveSourceMode.Api => await FetchFromApiAsync(venue, replay, ct),
                _ => await FetchFromPublicPagesAsync(venue, ct),
            };
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (YouTubeQuotaExceededException ex)
        {
            // Logged apart from the rest because the fix is a configuration one - fewer
            // venues, longer intervals, or Public mode - and because every venue will fail
            // the same way until the allowance resets.
            logger.LogError(
                "YouTube daily quota is exhausted; '{Venue}' and every other venue stay empty until it resets at midnight Pacific time. Compare the quota estimate logged at startup with YouTube:PollIntervalSeconds",
                venue.Id);
            return new LivePoll(LiveSnapshot.Empty(mode, ex.Message));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to fetch live streams for '{Venue}' in {Mode} mode", venue.Id, mode);
            return new LivePoll(LiveSnapshot.Empty(mode, ex.Message));
        }
    }

    // ---------------------------------------------------------------- API mode

    private async Task<LivePoll> FetchFromApiAsync(Venue venue, ReplayFetch? replay, CancellationToken ct)
    {
        if (!Options.HasApiKey)
        {
            return new LivePoll(LiveSnapshot.Empty(LiveSourceMode.Api, "YouTube:ApiKey is not configured."));
        }

        var page = await GetRecentVideoIdsAsync(venue, pageToken: null, ct);
        if (page.VideoIds.Count == 0)
        {
            return new LivePoll(
                LiveSnapshot.Empty(LiveSourceMode.Api),
                ReplayHarvest.None with { Backfilled = replay?.BackfillSince is not null });
        }

        var readings = await GetVideoDetailsAsync(venue, page.VideoIds, ct);
        var snapshot = BuildSnapshot(venue, [.. readings.Select(reading => reading.Stream)], LiveSourceMode.Api, isFallbackSource: false);

        var harvest = new HarvestBuilder();
        harvest.Add(page.VideoIds, readings);

        var backfilled = false;
        if (replay?.BackfillSince is not null)
        {
            backfilled = true;
            await BackfillAsync(venue, page, replay, harvest, ct);
        }

        return new LivePoll(snapshot, harvest.Build(backfilled));
    }

    /// <summary>
    /// Reads older pages of uploads, for 다시보기 after a start that remembered nothing, until
    /// it has the days with broadcasts it wants (<see cref="ReplayFetch.DaysWanted"/>) or the
    /// pages reach back past <see cref="ReplayFetch.BackfillSince"/>. At most
    /// <see cref="YouTubeOptions.ReplayBackfillPages"/> pages of 2 units each, once per venue
    /// per process (<see cref="ReplayArchive.BackfillSince"/>). A failure ends it with what it
    /// has so far: the live snapshot was already taken, and must not be lost to this.
    /// </summary>
    private async Task BackfillAsync(Venue venue, UploadsPage first, ReplayFetch replay, HarvestBuilder harvest, CancellationToken ct)
    {
        var since = replay.BackfillSince!.Value;
        var page = first;
        var pages = 0;

        try
        {
            while (page.NextPageToken is { } token
                   && page.OldestPublishedAt is { } oldest
                   && oldest >= since
                   && !HasDaysWanted(venue, replay, harvest)
                   && pages < Options.ReplayBackfillPagesClamped)
            {
                page = await GetRecentVideoIdsAsync(venue, token, ct);
                pages++;

                if (page.VideoIds.Count > 0)
                {
                    harvest.Add(page.VideoIds, await GetVideoDetailsAsync(venue, page.VideoIds, ct));
                }
            }

            logger.LogInformation(
                "{Venue}: read {Pages} older page(s) of uploads ({Units} quota units) to fill 다시보기; {Days} earlier day(s) with broadcasts, looking back to {Since:u} at most",
                venue.Id,
                pages,
                pages * QuotaEstimate.UnitsPerPoll,
                PastDaysWithBroadcasts(venue, replay, harvest),
                since);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "{Venue}: filling 다시보기 back stopped after {Pages} page(s)", venue.Id, pages);
        }
    }

    /// <summary>
    /// Profile pictures for the given channels, keyed by channel id (1 quota unit for up to
    /// 50 channels). Empty without an API key - the public pages offer no stable equivalent.
    /// </summary>
    public async Task<Dictionary<string, string>> FetchChannelAvatarsAsync(
        IReadOnlyCollection<string> channelIds,
        CancellationToken ct)
    {
        var avatars = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!Options.HasApiKey || channelIds.Count == 0)
        {
            return avatars;
        }

        var url = $"{ApiBase}/channels?part=snippet" +
                  $"&id={Uri.EscapeDataString(string.Join(',', channelIds.Take(50)))}" +
                  $"&key={Uri.EscapeDataString(Options.ApiKey)}";

        using var document = await GetJsonAsync(url, ct);
        if (!document.RootElement.TryGetProperty("items", out var items))
        {
            return avatars;
        }

        foreach (var item in items.EnumerateArray())
        {
            var id = item.GetPropertyOrNull("id")?.GetString();
            var thumbnails = item.GetPropertyOrNull("snippet")?.GetPropertyOrNull("thumbnails");

            // 240px is plenty for a logo slot and a fraction of the 800px "high" size.
            var avatar = thumbnails is null
                ? null
                : ((string[])["medium", "high", "default"])
                    .Select(size => thumbnails.Value.GetPropertyOrNull(size)?.GetPropertyOrNull("url")?.GetString())
                    .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));

            if (!string.IsNullOrWhiteSpace(id) && avatar is not null)
            {
                avatars[id] = avatar;
            }
        }

        return avatars;
    }

    /// <summary>
    /// Whether the days with broadcasts before today - the archive's and those found so far -
    /// already outnumber those wanted. One more than wanted, so the oldest wanted day is known
    /// to be whole: pages run newest first, and a day can straddle two of them.
    /// </summary>
    internal static bool HasDaysWanted(Venue venue, ReplayFetch replay, HarvestBuilder harvest) =>
        replay.DaysWanted > 0 && PastDaysWithBroadcasts(venue, replay, harvest) > replay.DaysWanted;

    private static int PastDaysWithBroadcasts(Venue venue, ReplayFetch replay, HarvestBuilder harvest)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, replay.TimeZone).DateTime);
        var days = new HashSet<DateOnly>(replay.KnownDays ?? new HashSet<DateOnly>());
        days.UnionWith(harvest.Ended.Select(broadcast => ReplayArchive.BroadcastDay(venue, replay.TimeZone, broadcast)));
        return days.Count(day => day < today);
    }

    /// <summary>
    /// One page of the uploads playlist, newest first (1 quota unit). Live broadcasts appear
    /// here once started; the first page is what every poll reads, the rest only a backfill.
    /// </summary>
    private async Task<UploadsPage> GetRecentVideoIdsAsync(Venue venue, string? pageToken, CancellationToken ct)
    {
        var url = $"{ApiBase}/playlistItems?part=contentDetails" +
                  $"&maxResults={Options.MaxVideoIdsClamped}" +
                  $"&playlistId={Uri.EscapeDataString(YouTubeOptions.UploadsPlaylistId(venue.Definition.ChannelId))}" +
                  (pageToken is null ? string.Empty : $"&pageToken={Uri.EscapeDataString(pageToken)}") +
                  $"&key={Uri.EscapeDataString(Options.ApiKey)}";

        using var document = await GetJsonAsync(url, ct);
        return ReadUploadsPage(document.RootElement);
    }

    /// <summary>The playlistItems.list answer, read; apart from the call so tests can hand it one.</summary>
    internal static UploadsPage ReadUploadsPage(JsonElement root)
    {
        var ids = new List<string>();
        DateTimeOffset? oldest = null;
        if (root.TryGetProperty("items", out var items))
        {
            foreach (var item in items.EnumerateArray())
            {
                var details = item.GetPropertyOrNull("contentDetails");
                var id = details?.GetPropertyOrNull("videoId")?.GetString();
                if (!string.IsNullOrWhiteSpace(id))
                {
                    ids.Add(id);
                }

                if (ParseDate(details?.GetPropertyOrNull("videoPublishedAt")?.GetString()) is { } published
                    && (oldest is null || published < oldest))
                {
                    oldest = published;
                }
            }
        }

        var next = root.GetPropertyOrNull("nextPageToken")?.GetString();
        return new UploadsPage(ids, string.IsNullOrWhiteSpace(next) ? null : next, oldest);
    }

    internal sealed record UploadsPage(List<string> VideoIds, string? NextPageToken, DateTimeOffset? OldestPublishedAt);

    /// <summary>
    /// One video as videos.list described it: the stream the wall would show, plus what only
    /// 다시보기 needs - whether it is still public, and whether and when it ended.
    /// </summary>
    internal sealed record VideoReading(LiveStream Stream, string? BroadcastContent, bool IsPublic, DateTimeOffset? EndedAt)
    {
        /// <summary>
        /// A broadcast worth watching again: finished (no longer live or upcoming, with an end
        /// time), public, and longer than a false start. Plain uploads have no start and fail.
        /// </summary>
        public PastBroadcast? AsPastBroadcast()
        {
            if (!IsPublic
                || !string.Equals(BroadcastContent, "none", StringComparison.OrdinalIgnoreCase)
                || Stream.ActualStartTime is not { } started
                || EndedAt is not { } ended
                || ended - started < ReplayArchive.ShortestReplay)
            {
                return null;
            }

            return new PastBroadcast
            {
                VideoId = Stream.VideoId,
                Title = Stream.Title,
                Name = Stream.Name,
                StreamDate = Stream.StreamDate,
                Part = Stream.Part,
                StartedAt = started,
                EndedAt = ended,
                Embeddable = Stream.Embeddable,
            };
        }
    }

    /// <summary>Collects a poll's readings, page by page, into one <see cref="ReplayHarvest"/>.</summary>
    internal sealed class HarvestBuilder
    {
        private readonly List<PastBroadcast> _ended = [];
        private readonly HashSet<string> _checked = new(StringComparer.Ordinal);
        private readonly HashSet<string> _stillPublic = new(StringComparer.Ordinal);

        public IReadOnlyList<PastBroadcast> Ended => _ended;

        public void Add(IEnumerable<string> asked, IEnumerable<VideoReading> readings)
        {
            _checked.UnionWith(asked);

            foreach (var reading in readings)
            {
                if (reading.IsPublic)
                {
                    _stillPublic.Add(reading.Stream.VideoId);
                }

                if (reading.AsPastBroadcast() is { } past)
                {
                    _ended.Add(past);
                }
            }
        }

        public ReplayHarvest Build(bool backfilled) => new(_ended, _checked, _stillPublic, backfilled);
    }

    /// <summary>
    /// Confirms liveness and reads titles/viewer counts (1 quota unit for up to 50 ids). The
    /// same answer carries what 다시보기 needs - end times and privacy - at no extra cost.
    /// </summary>
    private async Task<List<VideoReading>> GetVideoDetailsAsync(Venue venue, IReadOnlyList<string> videoIds, CancellationToken ct)
    {
        var url = $"{ApiBase}/videos?part=snippet,status,liveStreamingDetails" +
                  $"&id={Uri.EscapeDataString(string.Join(',', videoIds))}" +
                  $"&key={Uri.EscapeDataString(Options.ApiKey)}";

        using var document = await GetJsonAsync(url, ct);
        return ReadVideoDetails(venue, document.RootElement);
    }

    /// <summary>
    /// The videos.list answer, read; apart from the call so tests can hand it one. Only videos
    /// whose titles fit the venue's pattern are kept. A deleted or private video does not come
    /// back from videos.list at all, which is how the archive learns it is gone.
    /// </summary>
    internal static List<VideoReading> ReadVideoDetails(Venue venue, JsonElement root)
    {
        var results = new List<VideoReading>();
        if (!root.TryGetProperty("items", out var items))
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
            var status = item.GetPropertyOrNull("status");
            var broadcastContent = snippet?.GetPropertyOrNull("liveBroadcastContent")?.GetString();
            // Absent is read as public: the field is always sent, and an answer without it
            // should not empty the archive.
            var privacy = status?.GetPropertyOrNull("privacyStatus")?.GetString();

            results.Add(new VideoReading(
                new LiveStream
                {
                    StationId = venue.ResolveStationId(parsed.Name),
                    VideoId = videoId,
                    Title = title,
                    Name = parsed.Name,
                    StreamDate = parsed.StreamDate,
                    Part = parsed.Part,
                    IsLive = string.Equals(broadcastContent, "live", StringComparison.OrdinalIgnoreCase),
                    Embeddable = status?.GetPropertyOrNull("embeddable")?.GetBoolean() ?? true,
                    ConcurrentViewers = ParseLong(liveDetails?.GetPropertyOrNull("concurrentViewers")?.GetString()),
                    ActualStartTime = ParseDate(liveDetails?.GetPropertyOrNull("actualStartTime")?.GetString()),
                    PublishedAt = ParseDate(snippet?.GetPropertyOrNull("publishedAt")?.GetString()),
                    ThumbnailUrl = ReadThumbnail(snippet),
                },
                broadcastContent,
                privacy is null || string.Equals(privacy, "public", StringComparison.OrdinalIgnoreCase),
                ParseDate(liveDetails?.GetPropertyOrNull("actualEndTime")?.GetString())));
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
    private async Task<LivePoll> FetchFromPublicPagesAsync(Venue venue, CancellationToken ct)
    {
        var candidates = await ReadRssCandidatesAsync(venue, ct);
        if (candidates.Count == 0)
        {
            return new LivePoll(LiveSnapshot.Empty(LiveSourceMode.Public));
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

        return new LivePoll(
            BuildSnapshot(venue, live, LiveSourceMode.Public, isFallbackSource: true),
            new ReplayHarvest(EndedFromProbe(candidates, statuses), Checked: [], StillPublic: []));
    }

    /// <summary>
    /// What Public mode can give 다시보기: the broadcasts the watch page has just shown to be
    /// over. Each is probed once and then remembered as ended (<see cref="EndedBroadcastCache"/>),
    /// so it is harvested once. The RSS feed holds only the newest fifteen uploads and nothing
    /// there says whether one was deleted, so this path neither fills back nor prunes; Api
    /// mode does both.
    /// </summary>
    internal static List<PastBroadcast> EndedFromProbe(
        IEnumerable<LiveStream> candidates,
        IReadOnlyDictionary<string, PublicLiveProbe.LiveStatus> statuses) =>
        candidates
            .Where(candidate => statuses.TryGetValue(candidate.VideoId, out var status)
                                && status is { HasEnded: true, IsLiveNow: false, StartedAt: not null }
                                && (status.EndedAt is null || status.EndedAt - status.StartedAt >= ReplayArchive.ShortestReplay))
            .Select(candidate => new PastBroadcast
            {
                VideoId = candidate.VideoId,
                Title = candidate.Title,
                Name = candidate.Name,
                StreamDate = candidate.StreamDate,
                Part = candidate.Part,
                StartedAt = statuses[candidate.VideoId].StartedAt!.Value,
                EndedAt = statuses[candidate.VideoId].EndedAt,
                Embeddable = candidate.Embeddable,
            })
            .ToList();

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
                // An assumption, not a fact: nothing on this path knows whether the channel
                // allows the broadcast to be embedded. The RSS feed does not say, and the
                // watch-page probe reads only liveBroadcastDetails (PublicLiveProbe.cs), so
                // "unknown" is sent as true. A broadcast that turns out to be blocked reaches
                // the wall and fails in the player instead, which the tile then has to handle
                // (lib/tilePlayer.ts). Api mode reads status.embeddable and knows for real.
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
    /// as non-embeddable, the rest empty so the 준비중 placeholder renders too. Given
    /// real video ids instead, every station streams one of them, embeddable - players
    /// and all, for measuring load (the player then does reach YouTube).
    /// </summary>
    internal static LiveSnapshot BuildMockSnapshot(Venue venue, IReadOnlyList<string> videoIds)
    {
        var today = DateOnly.FromDateTime(DateTime.Now).ToString("yy.MM.dd");
        var playable = videoIds.Count > 0;

        // Every other cabinet, so both the live tile and the 준비중 placeholder render.
        var streams = venue.Stations
            .Where((_, index) => playable || index % 2 == 0)
            .Select((s, index) => new LiveStream
            {
                StationId = s.Id,
                VideoId = playable ? videoIds[index % videoIds.Count] : $"mock-{venue.Id}-{s.Id}",
                Title = $"{venue.Name} {s.Label} Live Streaming {today} - 1부",
                Name = s.Label,
                StreamDate = today,
                Part = 1,
                IsLive = true,
                Embeddable = playable,
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

    /// <summary>The name the mock archive gives a cabinet the venue does not list.</summary>
    internal const string MockUnlistedCabinet = "NEW CABINET";

    /// <summary>
    /// Finished broadcasts for 다시보기 in Mock mode: on each of the last <paramref name="days"/>
    /// days, a 1부 from 10:00 and a 2부 from 17:00, six hours each, on every cabinet - plus, in
    /// the newest day's 2부, one cabinet the venue does not list, which cannot be embedded, so
    /// both of those paths show too. With real video ids the broadcasts play one of them; without,
    /// their ids are made up and nothing reaches YouTube.
    /// </summary>
    internal static ReplayHarvest BuildMockReplay(
        Venue venue,
        IReadOnlyList<string> videoIds,
        TimeZoneInfo timeZone,
        DateTimeOffset now,
        int days)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, timeZone).DateTime);
        var ended = new List<PastBroadcast>();
        var played = 0;

        PastBroadcast Make(string name, DateOnly date, int part, int index, bool embeddable)
        {
            var naive = date.ToDateTime(new TimeOnly(10, 0)).AddHours((part - 1) * 7).AddMinutes(index);
            var started = new DateTimeOffset(naive, timeZone.GetUtcOffset(naive));
            var written = date.ToString("yy.MM.dd", CultureInfo.InvariantCulture);
            var videoId = videoIds.Count > 0
                ? videoIds[played++ % videoIds.Count]
                : $"mock-replay-{venue.Id}-{Venue.Normalize(name).ToLowerInvariant()}-{date:yyMMdd}-{part}";

            return new PastBroadcast
            {
                VideoId = videoId,
                Title = $"{venue.Name} {name} Live Streaming {written} - {part}부",
                Name = name,
                StreamDate = written,
                Part = part,
                StartedAt = started,
                EndedAt = started.AddHours(6),
                Embeddable = embeddable,
            };
        }

        for (var back = 1; back <= days; back++)
        {
            var date = today.AddDays(-back);
            foreach (var part in (int[])[1, 2])
            {
                ended.AddRange(venue.Stations.Select((station, index) => Make(station.Label, date, part, index, embeddable: true)));
            }
        }

        if (days > 0)
        {
            ended.Add(Make(MockUnlistedCabinet, today.AddDays(-1), 2, venue.Stations.Count, embeddable: false));
        }

        // Real ids repeat across cabinets, and the archive otherwise keys broadcasts by id: the
        // made-up day replaces the venue's whole archive instead, every poll.
        return new ReplayHarvest(ended, Checked: [], StillPublic: []) { ReplacesAll = true };
    }

    // ----------------------------------------------------------------- helpers

    /// <summary>
    /// Keeps one stream per station: the one that started most recently, with 부 only
    /// breaking ties. Start time has to lead because YouTube can keep a finished broadcast
    /// flagged "live" for hours - ranking by 부 first let yesterday's 3부 beat today's 1부
    /// and put a dead stream on the wall. Only live broadcasts survive: a station whose
    /// stream has ended must read as idle, not as a replay.
    /// </summary>
    internal static LiveSnapshot BuildSnapshot(Venue venue, IReadOnlyList<LiveStream> candidates, LiveSourceMode source, bool isFallbackSource)
    {
        var live = candidates.Where(c => c.IsLive).ToList();

        var streams = live
            .Where(c => c.StationId is not null)
            .GroupBy(c => c.StationId!)
            .Select(NewestOf)
            .OrderBy(c => venue.Stations.ToList().FindIndex(s => s.Id == c.StationId))
            .ToList();

        // A cabinet the venue does not list yet gets a tile of its own on the wall, so it
        // follows the same one-broadcast rule: without it, a 1부 YouTube left flagged live
        // beside today's 2부 put the same cabinet up twice. Grouped by the name as a
        // station alias would be matched, and sorted by it so the wall's order holds still.
        var unmatched = live
            .Where(c => c.StationId is null)
            .GroupBy(c => Venue.Normalize(c.Name))
            .Select(NewestOf)
            .OrderBy(c => Venue.Normalize(c.Name), StringComparer.Ordinal)
            .ToList();

        return new LiveSnapshot
        {
            Streams = streams,
            Unmatched = unmatched,
            Source = source,
            IsFallbackSource = isFallbackSource,
        };
    }

    private static LiveStream NewestOf(IEnumerable<LiveStream> sameCabinet) => sameCabinet
        .OrderByDescending(c => c.ActualStartTime ?? c.PublishedAt ?? DateTimeOffset.MinValue)
        .ThenByDescending(c => c.Part ?? 0)
        .First();

    private async Task<JsonDocument> GetJsonAsync(string url, CancellationToken ct)
    {
        using var response = await http.GetAsync(url, ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);

            if (IsQuotaExceeded(response.StatusCode, body))
            {
                // Deliberately without the upstream body: this message ends up in the
                // snapshot any anonymous client can read, and it already says everything
                // that can be done about it.
                throw new YouTubeQuotaExceededException(
                    "YouTube Data API daily quota is exhausted; it resets at midnight Pacific time.");
            }

            throw new HttpRequestException(
                $"YouTube API returned {(int)response.StatusCode} {response.ReasonPhrase}: {Truncate(body, 400)}");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        return await JsonDocument.ParseAsync(stream, cancellationToken: ct);
    }

    /// <summary>
    /// Whether a refused call was refused for want of quota. The Data API answers 403 to
    /// several unrelated things - a key restricted to other referrers, the API switched off
    /// for the project - so the reason in the body has to be read, not just the status.
    /// </summary>
    internal static bool IsQuotaExceeded(HttpStatusCode status, string body) =>
        status == HttpStatusCode.Forbidden
        && (body.Contains("quotaExceeded", StringComparison.Ordinal)
            || body.Contains("dailyLimitExceeded", StringComparison.Ordinal));

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

/// <summary>
/// What a poll is to do for 다시보기 beyond reading the newest uploads.
/// </summary>
/// <param name="TimeZone">The venues' time zone, which decides what "a day" is.</param>
/// <param name="BackfillSince">Read older pages of uploads back to this at most, or null for none.</param>
/// <param name="DaysWanted">Stop reading back once more than this many days before today have broadcasts; 0 for no such stop.</param>
/// <param name="KnownDays">Days before today the archive already has broadcasts on.</param>
public sealed record ReplayFetch(
    TimeZoneInfo TimeZone,
    DateTimeOffset? BackfillSince,
    int DaysWanted = 0,
    IReadOnlySet<DateOnly>? KnownDays = null);

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
