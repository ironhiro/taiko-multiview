using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Options;
using TaikoLabs.Api.Models;
using TaikoLabs.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// The stack is nobody's business.
builder.WebHost.ConfigureKestrel(kestrel => kestrel.AddServerHeader = false);

// Azure Container Apps ends TLS at its ingress and passes the client on in X-Forwarded-*.
// The proxy's address is not fixed, so none is listed; ForwardLimit (1) still takes only
// the last hop, the one the ingress itself appended, so a client cannot pick its own IP.
builder.Services.Configure<ForwardedHeadersOptions>(forwarded =>
{
    forwarded.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    forwarded.KnownIPNetworks.Clear();
    forwarded.KnownProxies.Clear();
});

// A person presses 새로고침 now and then; anything faster is a script. The per-venue
// cooldown already keeps YouTube calls down - this keeps the requests themselves down.
const string RefreshLimit = "refresh";
builder.Services.AddRateLimiter(limiter =>
{
    limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    limiter.AddPolicy(RefreshLimit, context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 6, Window = TimeSpan.FromMinutes(1) }));
});

// The venue list lives in a file of its own, apart from the app's settings: it is data
// that changes as venues come and go, edited with the venue editor and reviewed in git,
// while appsettings.json holds how the app runs. Both bind into the one "Venues"
// section, and edits are picked up while running (VenueRegistry rebuilds on change).
builder.Configuration.AddJsonFile("venues.json", optional: false, reloadOnChange: true);

builder.Services.Configure<YouTubeOptions>(builder.Configuration.GetSection(YouTubeOptions.SectionName));
builder.Services.Configure<VenuesOptions>(builder.Configuration.GetSection(VenuesOptions.SectionName));

builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

builder.Services.AddHttpClient<YouTubeLiveClient>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(20);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("TaikoMultiview/1.0");
});

builder.Services.AddHttpClient<PublicLiveProbe>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(25);
    // The watch page serves a trimmed payload to clients it does not recognise.
    client.DefaultRequestHeaders.UserAgent.ParseAdd(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36");
    client.DefaultRequestHeaders.AcceptLanguage.ParseAdd("en-US,en;q=0.9");
});

builder.Services.AddHttpClient<NaverClosureFeed>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(20);
    client.DefaultRequestHeaders.UserAgent.ParseAdd(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
    client.DefaultRequestHeaders.Referrer = new Uri("https://map.naver.com/");
});

builder.Services.AddSingleton<VenueRegistry>();
builder.Services.AddSingleton<EndedBroadcastCache>();
builder.Services.AddSingleton<VenueClosureStore>();
builder.Services.AddSingleton<VenueScheduleProvider>();
builder.Services.AddSingleton<LiveStreamStore>();
builder.Services.AddSingleton<ChannelAvatarCache>();

builder.Services.AddSingleton<LivePollingService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<LivePollingService>());
builder.Services.AddHostedService<ClosureRefreshService>();

const string CorsPolicy = "frontend";
builder.Services.AddCors(cors => cors.AddPolicy(CorsPolicy, policy =>
{
    var origins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];

    if (origins.Length == 0 || origins.Contains("*"))
    {
        policy.AllowAnyOrigin();
    }
    else
    {
        policy.WithOrigins(origins);
    }

    policy.AllowAnyHeader().AllowAnyMethod();
}));

// The OpenAPI document, Swagger UI and the status page. On in Development; elsewhere only
// when ApiDocs:Enabled is set, since they describe the API to anyone who asks.
var apiDocs = builder.Configuration.GetValue<bool?>("ApiDocs:Enabled") ?? builder.Environment.IsDevelopment();
if (apiDocs)
{
    builder.Services.AddOpenApi(options => options.AddDocumentTransformer((document, _, _) =>
    {
        document.Info.Title = "태고 멀티뷰 API";
        document.Info.Description =
            "매장 설정(venues.json)과 매장별 유튜브 라이브 방송 상태를 제공합니다. " +
            "한눈에 보려면 [/status](/status) 페이지를 여세요.";
        return Task.CompletedTask;
    }));
}

var app = builder.Build();
var startedAt = DateTimeOffset.UtcNow;

// The container image puts the frontend build in wwwroot, so one server answers both the
// page and /api on one origin: no CORS, no proxy. Run locally from source there is no
// build in it, and the Vite dev server serves the page instead.
var frontendIndex = app.Environment.WebRootPath is { } webRoot ? Path.Combine(webRoot, "index.html") : null;
var hasFrontend = frontendIndex is not null && File.Exists(frontendIndex);

app.UseForwardedHeaders();
app.Use((context, next) =>
{
    SetSecurityHeaders(context, app.Environment);
    return next(context);
});
app.UseCors(CorsPolicy);
app.UseRateLimiter();

if (hasFrontend)
{
    app.UseDefaultFiles();
    app.UseStaticFiles(new StaticFileOptions { OnPrepareResponse = context => SetCacheHeaders(context.Context) });
}

if (apiDocs)
{
    app.MapOpenApi();
    app.UseSwaggerUI(ui =>
    {
        ui.SwaggerEndpoint("/openapi/v1.json", "태고 멀티뷰 API v1");
        ui.DocumentTitle = "태고 멀티뷰 API";
    });

    // A visual reading of /api/health, /api/venues and /api/live, in one page.
    app.MapGet("/status", (IWebHostEnvironment env) =>
            Results.File(Path.Combine(env.ContentRootPath, "Status", "status.html"), "text/html; charset=utf-8"))
        .ExcludeFromDescription();

    // With no frontend here, the bare address has nothing else to show.
    if (!hasFrontend)
    {
        app.MapGet("/", () => Results.Redirect("/status")).ExcludeFromDescription();
    }
}

app.MapGet("/api/health", (
    VenueRegistry registry,
    IOptions<YouTubeOptions> options,
    IWebHostEnvironment env) =>
{
    var now = DateTimeOffset.UtcNow;
    var youtube = options.Value;

    return TypedResults.Ok(new HealthResponse
    {
        Status = "ok",
        Time = now,
        StartedAt = startedAt,
        UptimeSeconds = (long)(now - startedAt).TotalSeconds,
        Environment = env.EnvironmentName,
        YouTubeMode = youtube.Mode,
        HasApiKey = !string.IsNullOrWhiteSpace(youtube.ApiKey),
        PollIntervalSeconds = youtube.PollIntervalSecondsClamped,
        ClosedPollIntervalSeconds = youtube.ClosedPollIntervalSecondsClamped,
        VenueCount = registry.All.Count,
        VenuesVersion = registry.Version,
    });
})
    .WithTags("상태")
    .WithSummary("서버 상태")
    .WithDescription("서버가 살아 있는지, 어떤 모드로 돌고 있는지. API 키는 설정 여부만 알려주고 값은 절대 내보내지 않습니다.");

// Static per-venue configuration, fetched once and cached by the client. Adding a venue
// is a configuration change, never a frontend deploy.
app.MapGet("/api/venues", async (
    VenueRegistry registry,
    YouTubeLiveClient youtube,
    ChannelAvatarCache avatars,
    CancellationToken ct) =>
{
    var channelIds = registry.All.Select(venue => venue.Definition.ChannelId).Distinct().ToList();
    var avatarByChannel = await avatars.GetAsync(youtube, channelIds, ct);

    return TypedResults.Ok(new VenuesResponse
    {
        Version = registry.Version,
        Venues = registry.All.Select(venue => DescribeVenue(venue, avatarByChannel)).ToList(),
    });
})
    .WithTags("매장")
    .WithSummary("매장 설정")
    .WithDescription("venues.json의 매장 목록: 이름, 색, 로고, 유튜브 채널, 구역과 기체. 로고를 따로 지정하지 않은 매장은 채널 프로필 사진을 씁니다.");

// Every venue's current streams in one response, so the venue tabs can show live counts
// without a request each.
app.MapGet("/api/live", (
    VenueRegistry registry,
    LiveStreamStore store,
    VenueScheduleProvider schedule,
    IOptions<YouTubeOptions> options) =>
    TypedResults.Ok(ProjectAll(registry, store, schedule, options.Value)))
    .WithTags("라이브")
    .WithSummary("매장별 현재 방송")
    .WithDescription("매장마다 기체에 연결된 방송(streams), 기체를 못 찾은 방송(unmatched), 데이터 출처, 영업 상태. 서버가 주기적으로 폴링한 결과를 그대로 돌려주므로 호출해도 유튜브 API 사용량은 늘지 않습니다.");

// Forces an immediate refresh - handy while developing and from the desktop shell.
app.MapPost("/api/live/refresh", async (
    LivePollingService poller,
    VenueRegistry registry,
    LiveStreamStore store,
    VenueScheduleProvider schedule,
    IOptions<YouTubeOptions> options,
    string? venueId,
    CancellationToken ct) =>
{
    await poller.RefreshAsync(ct, venueId);
    return TypedResults.Ok(ProjectAll(registry, store, schedule, options.Value));
})
    .RequireRateLimiting(RefreshLimit)
    .WithTags("라이브")
    .WithSummary("지금 다시 확인")
    .WithDescription("venueId를 주면 그 매장만, 없으면 전체를 바로 폴링합니다. 매장마다 쿨다운이 있어 연달아 불러도 유튜브 API는 한 번만 호출됩니다. IP당 분당 6회 제한(초과 시 429).");

// Playback trouble reported by clients (the desktop shell's webview has no reachable
// console). Off unless Diagnostics:ClientReports is set, so production never maps it.
if (app.Configuration.GetValue<bool>("Diagnostics:ClientReports"))
{
    var clientLog = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("ClientDiagnostics");
    var limiter = new ClientReportLimiter(perMinute: 120);

    app.MapPost("/api/diagnostics", async (HttpRequest request) =>
    {
        if (!limiter.TryAcquire())
        {
            return Results.StatusCode(StatusCodes.Status429TooManyRequests);
        }

        using var reader = new StreamReader(request.Body);
        var buffer = new char[2048];
        var read = await reader.ReadBlockAsync(buffer, 0, buffer.Length);
        var body = new string(buffer, 0, read).ReplaceLineEndings(" ");

        clientLog.LogWarning("CLIENT {Report}", body);
        return Results.NoContent();
    })
        .WithTags("진단")
        .WithSummary("클라이언트 재생 문제 보고")
        .WithDescription("앱이 재생 문제를 서버 로그로 보냅니다. 분당 120건 제한.");
}

if (hasFrontend)
{
    // An unknown /api path is an error, not a page; anything else is a client-side route.
    app.MapFallback("/api/{**rest}", () => Results.NotFound()).ExcludeFromDescription();
    app.MapFallbackToFile("index.html", new StaticFileOptions { OnPrepareResponse = context => SetCacheHeaders(context.Context) });
}

app.Run();

// Vite names every built asset after its content, so those never change and can be kept
// for a year; index.html names them, so it is always revalidated.
static void SetCacheHeaders(HttpContext context)
{
    context.Response.Headers.CacheControl = context.Request.Path.StartsWithSegments("/assets")
        ? "public, max-age=31536000, immutable"
        : "no-cache";
}

// The page embeds YouTube players and chat, loads the iframe API from youtube.com, and
// shows thumbnails and logos from wherever a venue keeps them. connect-src is left open
// on purpose: the desktop shell can load this page and point it at an API elsewhere.
// Swagger UI and /status run inline script of their own, so they go without a CSP.
const string ContentSecurityPolicy =
    "script-src 'self' https://www.youtube.com https://s.ytimg.com; " +
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com; " +
    "img-src 'self' data: https:; " +
    "style-src 'self' 'unsafe-inline'; " +
    "font-src 'self' data:; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

static void SetSecurityHeaders(HttpContext context, IWebHostEnvironment env)
{
    var headers = context.Response.Headers;
    headers.XContentTypeOptions = "nosniff";
    headers.XFrameOptions = "DENY";
    // The browser default, stated. YouTube refuses to play embeds that send no referrer.
    headers["Referrer-Policy"] = "strict-origin-when-cross-origin";

    if (!context.Request.Path.StartsWithSegments("/swagger") && !context.Request.Path.StartsWithSegments("/status"))
    {
        headers.ContentSecurityPolicy = ContentSecurityPolicy;
    }

    // Only over HTTPS, and never on a developer's localhost, which HSTS would pin for a year.
    if (context.Request.IsHttps && !env.IsDevelopment())
    {
        headers.StrictTransportSecurity = "max-age=31536000";
    }
}

static LiveResponse ProjectAll(
    VenueRegistry registry,
    LiveStreamStore store,
    VenueScheduleProvider schedule,
    YouTubeOptions options) => new()
{
    PollIntervalSeconds = options.PollIntervalSecondsClamped,
    // Clients refetch /api/venues when this moves: the settings file was edited.
    VenuesVersion = registry.Version,
    Venues = registry.All
        .Select(venue => Project(venue, store.For(venue.Id), schedule.For(venue)))
        .ToList(),
};

static VenueInfo DescribeVenue(Venue venue, IReadOnlyDictionary<string, string> avatarByChannel) => new()
{
    Id = venue.Id,
    Name = venue.Name,
    Accent = venue.Definition.Accent,
    // A configured logo wins; otherwise the channel's own profile picture, if the API gave one.
    Logo = string.IsNullOrWhiteSpace(venue.Definition.Logo)
        ? avatarByChannel.GetValueOrDefault(venue.Definition.ChannelId)
        : venue.Definition.Logo,
    ChannelId = venue.Definition.ChannelId,
    ChannelUrl = venue.Definition.ChannelUrl,
    Zones = venue.Definition.Zones,
    Stations = venue.Definition.Stations
        .Select(station => new StationInfo(station.Id, station.Label, station.ZoneId))
        .ToList(),
    // Null for venues with no published map; the client then offers the grid only.
    Layout = venue.Definition.Layout,
};

static VenueLive Project(Venue venue, LiveSnapshot snapshot, VenueStatus status) => new()
{
    VenueId = venue.Id,
    UpdatedAt = snapshot.UpdatedAt,
    Streams = snapshot.Streams,
    Unmatched = snapshot.Unmatched,
    Source = snapshot.Source,
    IsFallbackSource = snapshot.IsFallbackSource,
    Error = snapshot.Error,
    Venue = status,
};

/// <summary>A fixed-window cap, so a misbehaving client cannot flood the log.</summary>
sealed class ClientReportLimiter(int perMinute)
{
    private readonly object _gate = new();
    private DateTimeOffset _windowStart = DateTimeOffset.MinValue;
    private int _count;

    public bool TryAcquire()
    {
        lock (_gate)
        {
            var now = DateTimeOffset.UtcNow;
            if (now - _windowStart >= TimeSpan.FromMinutes(1))
            {
                _windowStart = now;
                _count = 0;
            }

            return ++_count <= perMinute;
        }
    }
}
