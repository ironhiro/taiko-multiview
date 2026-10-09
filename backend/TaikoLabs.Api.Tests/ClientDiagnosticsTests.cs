using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using TaikoLabs.Api.Services;

namespace TaikoLabs.Api.Tests;

/// <summary>
/// POST /api/diagnostics is public and writes into a paid log once it is switched on, so
/// what it takes is bounded: per address, for the whole server, and per report.
/// </summary>
public class ClientDiagnosticsTests
{
    private const string Iphone =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

    // --- over HTTP --------------------------------------------------------------

    [Fact]
    public async Task Switched_off_the_endpoint_does_not_exist()
    {
        await using var app = new DiagnosticsApp(clientReports: false);
        using var client = app.CreateClient();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/diagnostics")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, """{"kind":"js-error"}""")).StatusCode);
    }

    [Fact]
    public async Task One_address_is_held_to_its_own_limit_while_another_still_gets_through()
    {
        await using var app = new DiagnosticsApp(perClient: 3, total: 100);
        using var client = app.CreateClient();

        for (var i = 0; i < 3; i++)
        {
            Assert.Equal(HttpStatusCode.NoContent, (await Send(client, """{"kind":"js-error"}""", from: "203.0.113.1")).StatusCode);
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, (await Send(client, """{"kind":"js-error"}""", from: "203.0.113.1")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, """{"kind":"js-error"}""", from: "203.0.113.2")).StatusCode);
    }

    [Fact]
    public async Task The_whole_server_stops_at_its_cap_whoever_sends()
    {
        await using var app = new DiagnosticsApp(perClient: 100, total: 4);
        using var client = app.CreateClient();

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 6; i++)
        {
            statuses.Add((await Send(client, """{"kind":"js-error"}""", from: $"203.0.113.{i + 1}")).StatusCode);
        }

        Assert.Equal(4, statuses.Count(status => status == HttpStatusCode.NoContent));
        Assert.Equal(2, statuses.Count(status => status == HttpStatusCode.TooManyRequests));
        Assert.Equal(4, app.Logs.ClientLines.Count);
    }

    [Fact]
    public async Task The_log_keeps_the_report_but_never_the_address_or_the_full_user_agent()
    {
        await using var app = new DiagnosticsApp();
        using var client = app.CreateClient();

        var response = await Send(
            client,
            """{"kind":"player-error","client":"browser","build":"8f9d25c","station":"A1","videoId":"4xDzrJKXOOY","code":150,"meaning":"embedding not allowed"}""",
            from: "198.51.100.77",
            userAgent: Iphone);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var line = Assert.Single(app.Logs.ClientLines);
        Assert.Equal("player-error", line.Properties["Kind"]);
        Assert.Equal("error", line.Properties["Severity"]);
        Assert.Equal("Safari 18/iOS/mobile", line.Properties["Ua"]);
        Assert.Equal("""{"code":150,"meaning":"embedding not allowed"}""", line.Properties["Detail"]);
        Assert.Equal(LogLevel.Warning, line.Level);

        var everything = string.Join("\n", app.Logs.All.Select(entry => entry.Text + string.Join(" ", entry.Properties.Values)));
        Assert.DoesNotContain("198.51.100.77", everything);
        Assert.DoesNotContain("AppleWebKit/605.1.15", everything);
    }

    [Fact]
    public async Task A_kind_not_on_the_list_is_dropped_and_only_counted()
    {
        var time = new ManualTime();
        await using var app = new DiagnosticsApp(time: time);
        using var client = app.CreateClient();

        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, """{"kind":"fail: forged line"}""")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, """{"kind":"made-up"}""")).StatusCode);
        Assert.Empty(app.Logs.ClientLines);

        // The count goes out with the first report after a minute, and the kinds never do.
        time.Advance(TimeSpan.FromMinutes(2));
        await Send(client, """{"kind":"made-up"}""");

        var count = Assert.Single(app.Logs.All, entry => entry.Properties.ContainsKey("UnknownKindCount"));
        Assert.Equal(3, count.Properties["UnknownKindCount"]);
        Assert.DoesNotContain(app.Logs.All, entry => entry.Text.Contains("forged") || entry.Text.Contains("made-up"));
    }

    [Theory]
    [InlineData(0.0, 0)]
    [InlineData(1.0, 1)]
    public async Task Informational_reports_are_kept_at_the_configured_rate(double rate, int expected)
    {
        await using var app = new DiagnosticsApp(infoSampleRate: rate);
        using var client = app.CreateClient();

        var config = await client.GetFromJsonAsync<Dictionary<string, double>>("/api/diagnostics");
        Assert.Equal(rate, config!["infoSampleRate"]);

        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, """{"kind":"resynced","session":"00000000","behindSeconds":42}""")).StatusCode);
        // An error is kept whatever the rate.
        await Send(client, """{"kind":"player-error","session":"00000000"}""");

        Assert.Equal(expected, app.Logs.ClientLines.Count(line => (string?)line.Properties["Kind"] == "resynced"));
        Assert.Single(app.Logs.ClientLines, line => (string?)line.Properties["Kind"] == "player-error");
    }

    [Fact]
    public async Task A_body_over_the_limit_or_not_json_is_refused()
    {
        await using var app = new DiagnosticsApp();
        using var client = app.CreateClient();

        var tooLong = $$"""{"kind":"js-error","message":"{{new string('x', ClientReportReader.MaxBodyBytes)}}"}""";
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await Send(client, tooLong)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, "not json")).StatusCode);

        // Not valid UTF-8 inside a string: caught when the field is read, not by the parser.
        var invalid = new ByteArrayContent([.. Encoding.UTF8.GetBytes("""{"kind":"js-error","message":" """), 0xB9, 0x22, 0x7D]);
        invalid.Headers.ContentType = new("application/json");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/diagnostics", invalid)).StatusCode);
        Assert.Empty(app.Logs.ClientLines);
    }

    // --- the reader --------------------------------------------------------------

    [Fact]
    public void Only_named_fields_are_kept_and_each_is_cut_to_its_length()
    {
        var json = $$"""
            {
              "kind": "js-error",
              "message": "{{new string('m', 1000)}}",
              "source": "{{new string('s', 1000)}}",
              "stack": "{{new string('t', 5000)}}",
              "station": "{{new string('a', 1000)}}",
              "ip": "1.2.3.4",
              "cookie": "secret",
              "code": "150",
              "line": 12
            }
            """;

        var (outcome, report) = ClientReportReader.Read(Encoding.UTF8.GetBytes(json), null);

        Assert.Equal(ClientReportOutcome.Logged, outcome);
        Assert.Equal(ClientReportReader.MessageLimit, report!.Message!.Length);
        Assert.Equal(ClientReportReader.SourceLimit, report.Source!.Length);
        Assert.Equal(ClientReportReader.StackLimit, report.Stack!.Length);
        Assert.Equal(ClientReportReader.NameLimit, report.Station!.Length);
        // A number sent as a string is not a number; unknown fields are not carried at all.
        Assert.Equal("""{"line":12}""", report.Detail);
        Assert.DoesNotContain("secret", report.ToString());
        Assert.DoesNotContain("1.2.3.4", report.ToString());
    }

    [Fact]
    public void Line_breaks_and_control_characters_cannot_start_a_new_log_line()
    {
        var json = """{"kind":"js-error","message":"boom\r\nfail: Forged[0]\u2028\u0007end"}""";

        var (_, report) = ClientReportReader.Read(Encoding.UTF8.GetBytes(json), null);

        Assert.Equal("boom  fail: Forged[0] end", report!.Message);
    }

    [Fact]
    public void Direction_overrides_cannot_make_a_line_read_backwards()
    {
        // RLO, LRE, PDF, the isolates and the marks: format characters, not controls.
        var json = """{"kind":"js-error","message":"a\u202Eb\u202Ac\u202Cd\u2066e\u2069f\u200Eg\u200Fh","station":"\u202EA1"}""";

        var (_, report) = ClientReportReader.Read(Encoding.UTF8.GetBytes(json), null);

        Assert.Equal("abcdefgh", report!.Message);
        Assert.Equal("A1", report.Station);
    }

    [Fact]
    public void Fields_with_a_fixed_shape_fall_back_rather_than_pass_through()
    {
        var json = """{"kind":"player-error","client":"curl","build":"x y","session":"ZZZZ","videoId":"<script>"}""";

        var (_, report) = ClientReportReader.Read(Encoding.UTF8.GetBytes(json), null);

        Assert.Equal("other", report!.Client);
        Assert.Equal("unknown", report.Build);
        Assert.Null(report.Session);
        Assert.Null(report.VideoId);
        Assert.Equal("unknown", report.Ua);
    }

    [Theory]
    [InlineData("00000000", 0.1, true)]
    [InlineData("19990000", 0.1, true)] // 0x1999 / 65536 = 0.09999
    [InlineData("1a000000", 0.1, false)]
    [InlineData("ffffffff", 0.99, false)]
    [InlineData("ffffffff", 1.0, true)]
    [InlineData("00000000", 0.0, false)]
    [InlineData(null, 0.5, false)]
    public void A_session_is_in_the_sample_by_its_first_four_hex_digits(string? session, double rate, bool sampled)
    {
        Assert.Equal(sampled, ClientReportReader.IsSampled(session, rate));
    }

    [Theory]
    [InlineData(Iphone, "Safari 18/iOS/mobile")]
    [InlineData("Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36", "Samsung 26/Android/mobile")]
    [InlineData("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0", "Edge 141/Windows/desktop")]
    [InlineData("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)", "WebKit/macOS/desktop")]
    [InlineData("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36", "HeadlessChrome 141/Linux/desktop")]
    [InlineData("", "unknown")]
    public void A_user_agent_is_reduced_to_browser_os_and_form(string userAgent, string expected)
    {
        Assert.Equal(expected, UserAgentSummary.Describe(userAgent));
    }

    [Fact]
    public void Every_kind_has_a_severity_and_the_chatter_is_informational()
    {
        Assert.Equal(ClientReportSeverity.Error, ClientReportKinds.Severity["js-error"]);
        Assert.Equal(ClientReportSeverity.Warning, ClientReportKinds.Severity["playback-stalled"]);
        Assert.All(
            ClientReportKinds.Severity.Where(kind => kind.Key.EndsWith("-recovered") || kind.Key is "resynced" or "jumped-to-live"),
            kind => Assert.Equal(ClientReportSeverity.Info, kind.Value));
    }

    // --- helpers -------------------------------------------------------------------

    private static Task<HttpResponseMessage> Send(HttpClient client, string json, string? from = null, string? userAgent = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/diagnostics")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        if (from is not null)
        {
            // The app trusts the last X-Forwarded-For hop, the one Container Apps' ingress adds.
            request.Headers.Add("X-Forwarded-For", from);
        }

        if (userAgent is not null)
        {
            request.Headers.TryAddWithoutValidation("User-Agent", userAgent);
        }

        return client.SendAsync(request);
    }

    private sealed class DiagnosticsApp(
        bool clientReports = true,
        int perClient = 30,
        int total = 300,
        double infoSampleRate = 0,
        TimeProvider? time = null) : WebApplicationFactory<Program>
    {
        private readonly string _scratch = Path.Combine(Path.GetTempPath(), $"taiko-diag-test-{Guid.NewGuid():N}");

        public CapturedLogs Logs { get; } = new();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Production");
            builder.UseSetting("YouTube:Mode", "Mock");
            builder.UseSetting("YouTube:ApiKey", "");
            builder.UseSetting("Venues:ClosureCachePath", Path.Combine(_scratch, "closures.json"));
            builder.UseSetting("Venues:LiveCachePath", Path.Combine(_scratch, "live.json"));
            builder.UseSetting("Diagnostics:ClientReports", clientReports ? "true" : "false");
            builder.UseSetting("Diagnostics:PerClientPerMinute", perClient.ToString());
            builder.UseSetting("Diagnostics:TotalPerMinute", total.ToString());
            builder.UseSetting("Diagnostics:InfoSampleRate", infoSampleRate.ToString(System.Globalization.CultureInfo.InvariantCulture));
            builder.ConfigureLogging(logging => logging.AddProvider(Logs));
            builder.ConfigureTestServices(services =>
            {
                // No polling of YouTube or the closure feed while testing an unrelated endpoint.
                services.RemoveAll<IHostedService>();
                if (time is not null)
                {
                    services.RemoveAll<ClientReportLog>();
                    services.AddSingleton(provider => new ClientReportLog(
                        provider.GetRequiredService<ILoggerFactory>(),
                        provider.GetRequiredService<Microsoft.Extensions.Options.IOptions<ClientDiagnosticsOptions>>(),
                        time));
                }
            });
        }
    }

    internal sealed record LogEntry(string Category, LogLevel Level, string Text, IReadOnlyDictionary<string, object?> Properties);

    internal sealed class CapturedLogs : ILoggerProvider
    {
        private readonly ConcurrentQueue<LogEntry> _entries = new();

        public IReadOnlyList<LogEntry> All => [.. _entries];

        public IReadOnlyList<LogEntry> ClientLines =>
            [.. _entries.Where(entry => entry.Category == ClientReportLog.Category && entry.Properties.ContainsKey("Kind"))];

        public ILogger CreateLogger(string categoryName) => new Logger(categoryName, _entries);

        public void Dispose()
        {
        }

        private sealed class Logger(string category, ConcurrentQueue<LogEntry> entries) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            {
                var properties = state is IEnumerable<KeyValuePair<string, object?>> pairs
                    ? pairs.ToDictionary(pair => pair.Key, pair => pair.Value)
                    : [];
                entries.Enqueue(new LogEntry(category, logLevel, formatter(state, exception), properties));
            }
        }
    }

    private sealed class ManualTime : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 10, 10, 12, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan by) => _now += by;
    }
}
