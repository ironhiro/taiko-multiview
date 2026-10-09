using System.Buffers;
using System.Collections.Frozen;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Settings for the reports the page sends about its own trouble (POST /api/diagnostics).
/// Off unless <see cref="ClientReports"/> is set; once on, every limit here is what keeps a
/// public, unauthenticated endpoint from writing whatever it is sent into a paid log.
/// </summary>
public sealed class ClientDiagnosticsOptions
{
    public const string SectionName = "Diagnostics";

    /// <summary>Maps the endpoint at all. Unmapped, the page's first report gets a 404 and it stops for the session.</summary>
    public bool ClientReports { get; set; }

    /// <summary>
    /// Reports one address may send a minute. Viewers in one venue share its Wi-Fi, and a
    /// phone carrier puts many behind one address, so this is not one person's allowance.
    /// </summary>
    public int PerClientPerMinute { get; set; } = 30;

    /// <summary>Reports the whole server takes a minute, whoever sends them: the ceiling on what the log can cost.</summary>
    public int TotalPerMinute { get; set; } = 300;

    /// <summary>
    /// The share of sessions whose informational reports (a stall that recovered, a jump
    /// back to live) are kept, from 0 to 1. Errors and warnings are always kept. The page
    /// asks for this value and does not send what would be dropped.
    /// </summary>
    public double InfoSampleRate { get; set; }

    public double InfoSampleRateClamped => double.IsFinite(InfoSampleRate) ? Math.Clamp(InfoSampleRate, 0, 1) : 0;
}

public enum ClientReportSeverity
{
    Error,
    Warning,
    Info,
}

/// <summary>
/// Every kind of report the page sends, and how much it matters. The server decides this,
/// not the report: a client claiming "error" for chatter would otherwise get it past the
/// sampling. frontend/src/lib/diagnosticKinds.ts holds the same table so the page does not
/// send what would be dropped; a frontend test checks the two agree.
/// </summary>
public static class ClientReportKinds
{
    public static readonly FrozenDictionary<string, ClientReportSeverity> Severity =
        new Dictionary<string, ClientReportSeverity>(StringComparer.Ordinal)
        {
            // Something the viewer sees broken.
            ["js-error"] = ClientReportSeverity.Error,
            ["js-unhandled-rejection"] = ClientReportSeverity.Error,
            ["player-error"] = ClientReportSeverity.Error,
            ["player-load-failed"] = ClientReportSeverity.Error,
            ["venues-fetch-failed"] = ClientReportSeverity.Error,
            ["live-fetch-failed"] = ClientReportSeverity.Error,
            ["replay-fetch-failed"] = ClientReportSeverity.Error,

            // Playback going wrong in a way that may or may not fix itself.
            ["player-destroy-failed"] = ClientReportSeverity.Warning,
            ["autoplay-timeout"] = ClientReportSeverity.Warning,
            ["buffering-long"] = ClientReportSeverity.Warning,
            ["playback-stalled"] = ClientReportSeverity.Warning,
            ["behind-live"] = ClientReportSeverity.Warning,
            ["ended-while-live"] = ClientReportSeverity.Warning,
            ["video-swapped"] = ClientReportSeverity.Warning,

            // It fixed itself, or the page fixed it: useful for soak tests, noise on a busy day.
            ["playback-stall-recovered"] = ClientReportSeverity.Info,
            ["autoplay-recovered"] = ClientReportSeverity.Info,
            ["buffering-recovered"] = ClientReportSeverity.Info,
            ["behind-live-recovered"] = ClientReportSeverity.Info,
            ["jumped-to-live"] = ClientReportSeverity.Info,
            ["ended-reload"] = ClientReportSeverity.Info,
            ["resynced"] = ClientReportSeverity.Info,
        }.ToFrozenDictionary(StringComparer.Ordinal);
}

/// <summary>One report, reduced to the fields we know and cut to length.</summary>
public sealed record ClientReport
{
    public required string Kind { get; init; }
    public required ClientReportSeverity Severity { get; init; }
    public required string Client { get; init; }
    public required string Build { get; init; }
    public required string Ua { get; init; }
    public string? Session { get; init; }
    public string? Venue { get; init; }
    public string? View { get; init; }
    public string? Station { get; init; }
    public string? VideoId { get; init; }
    public string? Message { get; init; }
    public string? Source { get; init; }
    public string? Stack { get; init; }

    /// <summary>The kind-specific extras (an error code, seconds behind live), as compact JSON; null when there are none.</summary>
    public string? Detail { get; init; }
}

public enum ClientReportOutcome
{
    Logged,
    /// <summary>An informational report from a session outside the sample.</summary>
    SampledOut,
    UnknownKind,
    Malformed,
}

/// <summary>
/// Reads a report body into a <see cref="ClientReport"/>. Nothing from the body reaches the
/// log unless it is a field named here, and every string is cut to a fixed length with its
/// control characters removed, so a report cannot forge a log line or fill the log.
/// </summary>
public static partial class ClientReportReader
{
    public const int MaxBodyBytes = 4096;

    internal const int MessageLimit = 300;
    internal const int SourceLimit = 200;
    internal const int StackLimit = 600;
    internal const int NameLimit = 40;

    private static readonly string[] NumberFields =
        ["code", "failures", "retryInMs", "behindSeconds", "hiddenSeconds", "afterSeconds", "seconds", "atSecond", "state", "line", "column"];

    private static readonly string[] WordFields = ["meaning", "after", "reason", "loaded"];

    public static (ClientReportOutcome Outcome, ClientReport? Report) Read(ReadOnlySpan<byte> body, string? userAgent)
    {
        try
        {
            return ReadDocument(body, userAgent);
        }
        catch (InvalidOperationException)
        {
            // A string that is not valid UTF-8: JsonDocument only checks it once it is read.
            return (ClientReportOutcome.Malformed, null);
        }
    }

    private static (ClientReportOutcome Outcome, ClientReport? Report) ReadDocument(ReadOnlySpan<byte> body, string? userAgent)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(body.ToArray(), new JsonDocumentOptions { MaxDepth = 4 });
        }
        catch (JsonException)
        {
            return (ClientReportOutcome.Malformed, null);
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return (ClientReportOutcome.Malformed, null);
            }

            var kind = Text(root, "kind", NameLimit);
            if (kind is null)
            {
                return (ClientReportOutcome.Malformed, null);
            }

            if (!ClientReportKinds.Severity.TryGetValue(kind, out var severity))
            {
                return (ClientReportOutcome.UnknownKind, null);
            }

            return (ClientReportOutcome.Logged, new ClientReport
            {
                Kind = kind,
                Severity = severity,
                Client = Text(root, "client", NameLimit) switch { "browser" => "browser", "tauri" => "tauri", _ => "other" },
                Build = Text(root, "build", NameLimit) is { } build && BuildPattern().IsMatch(build) ? build : "unknown",
                Ua = UserAgentSummary.Describe(userAgent),
                Session = Text(root, "session", NameLimit) is { } session && SessionPattern().IsMatch(session) ? session : null,
                Venue = Text(root, "venueId", NameLimit),
                View = Text(root, "view", NameLimit),
                Station = Text(root, "station", NameLimit),
                VideoId = Text(root, "videoId", NameLimit) is { } videoId && VideoIdPattern().IsMatch(videoId) ? videoId : null,
                Message = Text(root, "message", MessageLimit),
                Source = Text(root, "source", SourceLimit),
                Stack = Text(root, "stack", StackLimit),
                Detail = DetailOf(root),
            });
        }
    }

    /// <summary>
    /// Whether a session's informational reports are kept. The page picks its session id at
    /// random and makes the same test before sending, so the two agree without asking.
    /// </summary>
    public static bool IsSampled(string? session, double rate)
    {
        if (rate >= 1)
        {
            return true;
        }

        if (rate <= 0 || session is null)
        {
            return false;
        }

        return int.Parse(session.AsSpan(0, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture) / 65536.0 < rate;
    }

    private static string? DetailOf(JsonElement root)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            var any = false;
            writer.WriteStartObject();
            foreach (var field in NumberFields)
            {
                if (root.TryGetProperty(field, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number))
                {
                    writer.WriteNumber(field, Math.Round(number, 2));
                    any = true;
                }
            }

            foreach (var field in WordFields)
            {
                if (Text(root, field, NameLimit) is { } word)
                {
                    writer.WriteString(field, word);
                    any = true;
                }
            }

            writer.WriteEndObject();
            writer.Flush();
            if (!any)
            {
                return null;
            }
        }

        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    /// <summary>A string field, without control, line-separator or bidi formatting characters, cut to <paramref name="limit"/>; null when absent or empty.</summary>
    internal static string? Text(JsonElement root, string name, int limit) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? Clean(value.GetString(), limit)
            : null;

    internal static string? Clean(string? text, int limit)
    {
        if (string.IsNullOrEmpty(text))
        {
            return null;
        }

        var builder = new StringBuilder(Math.Min(text.Length, limit));
        foreach (var c in text)
        {
            if (builder.Length >= limit)
            {
                break;
            }

            var category = char.GetUnicodeCategory(c);
            if (category is UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator)
            {
                builder.Append(' ');
            }
            else if (IsBidiFormatting(c))
            {
                // Direction overrides and isolates would make the line read reversed to a
                // person looking at it, though the JSON itself stays one line.
            }
            else if (char.IsControl(c))
            {
                // Tabs and newlines in a stack become spaces; the rest go.
                if (c is '\n' or '\r' or '\t')
                {
                    builder.Append(' ');
                }
            }
            else
            {
                builder.Append(c);
            }
        }

        // A cut through a surrogate pair would leave half a character.
        if (builder.Length > 0 && char.IsHighSurrogate(builder[^1]))
        {
            builder.Length--;
        }

        var cleaned = builder.ToString().Trim();
        return cleaned.Length == 0 ? null : cleaned;
    }

    /// <summary>U+200E/200F (marks), U+202A-202E (embeddings, overrides), U+2066-2069 (isolates).</summary>
    internal static bool IsBidiFormatting(char c) =>
        c is '\u200E' or '\u200F' or (>= '\u202A' and <= '\u202E') or (>= '\u2066' and <= '\u2069');

    [GeneratedRegex("^[0-9A-Za-z._+-]{1,40}$")]
    private static partial Regex BuildPattern();

    [GeneratedRegex("^[0-9a-f]{8}$")]
    private static partial Regex SessionPattern();

    [GeneratedRegex("^[0-9A-Za-z_-]{1,40}$")]
    private static partial Regex VideoIdPattern();
}

/// <summary>
/// Browser, major version, OS and whether it is a phone, read from a User-Agent. The log
/// keeps this and never the header itself, which is long and close to identifying.
/// </summary>
public static partial class UserAgentSummary
{
    public static string Describe(string? userAgent)
    {
        if (string.IsNullOrWhiteSpace(userAgent))
        {
            return "unknown";
        }

        var (browser, version) = BrowserOf(userAgent);
        var os = OsOf(userAgent);
        var mobile = userAgent.Contains("Mobile", StringComparison.Ordinal) || os is "Android" or "iOS";
        return $"{browser}{(version is null ? "" : " " + version)}/{os}/{(mobile ? "mobile" : "desktop")}";
    }

    private static (string Browser, string? Version) BrowserOf(string ua)
    {
        // Order matters: most browsers also claim Chrome and Safari.
        (string Token, string Name)[] browsers =
        [
            ("HeadlessChrome/", "HeadlessChrome"),
            ("SamsungBrowser/", "Samsung"),
            ("Whale/", "Whale"),
            ("EdgA/", "Edge"),
            ("EdgiOS/", "Edge"),
            ("Edg/", "Edge"),
            ("OPR/", "Opera"),
            ("CriOS/", "Chrome"),
            ("FxiOS/", "Firefox"),
            ("Firefox/", "Firefox"),
            ("Chrome/", "Chrome"),
            ("Version/", "Safari"),
        ];

        foreach (var (token, name) in browsers)
        {
            var at = ua.IndexOf(token, StringComparison.Ordinal);
            if (at >= 0)
            {
                var major = MajorVersion().Match(ua, at + token.Length);
                return (name, major.Success ? major.Value : null);
            }
        }

        // The desktop shell's WebKit on macOS names no browser at all.
        return (ua.Contains("AppleWebKit", StringComparison.Ordinal) ? "WebKit" : "other", null);
    }

    private static string OsOf(string ua) =>
        ua.Contains("iPhone", StringComparison.Ordinal) || ua.Contains("iPad", StringComparison.Ordinal) || ua.Contains("iPod", StringComparison.Ordinal) ? "iOS"
        : ua.Contains("Android", StringComparison.Ordinal) ? "Android"
        : ua.Contains("Windows", StringComparison.Ordinal) ? "Windows"
        : ua.Contains("CrOS", StringComparison.Ordinal) ? "ChromeOS"
        : ua.Contains("Mac OS X", StringComparison.Ordinal) || ua.Contains("Macintosh", StringComparison.Ordinal) ? "macOS"
        : ua.Contains("Linux", StringComparison.Ordinal) ? "Linux"
        : "other";

    [GeneratedRegex(@"\G\d{1,4}")]
    private static partial Regex MajorVersion();
}

/// <summary>
/// Writes accepted reports to the "ClientDiagnostics" log as structured properties, and
/// keeps the server-wide cap. The per-address limit is the endpoint's rate-limit policy;
/// the address itself is never logged.
/// </summary>
public sealed class ClientReportLog
{
    public const string Category = "ClientDiagnostics";

    private readonly ILogger _log;
    private readonly ClientDiagnosticsOptions _options;
    private readonly ClientReportLimiter _limiter;
    private readonly TimeProvider _time;
    private readonly object _gate = new();
    private DateTimeOffset _unknownSince;
    private int _unknown;

    public ClientReportLog(ILoggerFactory loggers, IOptions<ClientDiagnosticsOptions> options, TimeProvider? time = null)
    {
        _log = loggers.CreateLogger(Category);
        _options = options.Value;
        _time = time ?? TimeProvider.System;
        _limiter = new ClientReportLimiter(_options.TotalPerMinute, _time);
        _unknownSince = _time.GetUtcNow();
    }

    public double InfoSampleRate => _options.InfoSampleRateClamped;

    /// <summary>False once the server has taken its fill of reports this minute.</summary>
    public bool TryTakeOne() => _limiter.TryAcquire();

    public ClientReportOutcome Write(ReadOnlySpan<byte> body, string? userAgent)
    {
        var (outcome, report) = ClientReportReader.Read(body, userAgent);
        FlushUnknownCount(outcome == ClientReportOutcome.UnknownKind);

        if (report is null)
        {
            return outcome;
        }

        if (report.Severity == ClientReportSeverity.Info && !ClientReportReader.IsSampled(report.Session, InfoSampleRate))
        {
            return ClientReportOutcome.SampledOut;
        }

        _log.Log(
            report.Severity == ClientReportSeverity.Info ? LogLevel.Information : LogLevel.Warning,
            "CLIENT {Kind} {Severity} {Message} | client={Client} build={Build} ua={Ua} venue={Venue} view={View} station={Station} video={VideoId} source={Source} session={Session} detail={Detail} stack={Stack}",
            report.Kind,
            report.Severity.ToString().ToLowerInvariant(),
            report.Message,
            report.Client,
            report.Build,
            report.Ua,
            report.Venue,
            report.View,
            report.Station,
            report.VideoId,
            report.Source,
            report.Session,
            report.Detail,
            report.Stack);
        return ClientReportOutcome.Logged;
    }

    /// <summary>
    /// Unknown kinds are counted, never written: the kind is the sender's own text. Once a
    /// minute at most the count goes to the log, so a stale page or a probe still shows.
    /// </summary>
    private void FlushUnknownCount(bool oneMore)
    {
        int count;
        lock (_gate)
        {
            if (oneMore)
            {
                _unknown++;
            }

            var now = _time.GetUtcNow();
            if (_unknown == 0 || now - _unknownSince < TimeSpan.FromMinutes(1))
            {
                if (_unknown == 0)
                {
                    _unknownSince = now;
                }

                return;
            }

            count = _unknown;
            _unknown = 0;
            _unknownSince = now;
        }

        _log.LogWarning("CLIENT dropped {UnknownKindCount} reports of unknown kind", count);
    }
}

/// <summary>A fixed-window cap, so all clients together cannot flood the log.</summary>
public sealed class ClientReportLimiter(int perMinute, TimeProvider time)
{
    private readonly object _gate = new();
    private DateTimeOffset _windowStart = DateTimeOffset.MinValue;
    private int _count;

    public bool TryAcquire()
    {
        lock (_gate)
        {
            var now = time.GetUtcNow();
            if (now - _windowStart >= TimeSpan.FromMinutes(1))
            {
                _windowStart = now;
                _count = 0;
            }

            return ++_count <= perMinute;
        }
    }
}
