using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using TaikoLabs.Api.Models;
using TaikoLabs.Api.Services;

var builder = WebApplication.CreateBuilder(args);

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

var app = builder.Build();

app.UseCors(CorsPolicy);

app.MapGet("/api/health", () => Results.Ok(new
{
    status = "ok",
    time = DateTimeOffset.UtcNow,
}));

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

    return Results.Ok(new
    {
        venues = registry.All.Select(venue => DescribeVenue(venue, avatarByChannel)),
    });
});

// Every venue's current streams in one response, so the venue tabs can show live counts
// without a request each.
app.MapGet("/api/live", (
    VenueRegistry registry,
    LiveStreamStore store,
    VenueScheduleProvider schedule,
    IOptions<YouTubeOptions> options) =>
    Results.Ok(ProjectAll(registry, store, schedule, options.Value)));

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
    return Results.Ok(ProjectAll(registry, store, schedule, options.Value));
});

app.Run();

static object ProjectAll(
    VenueRegistry registry,
    LiveStreamStore store,
    VenueScheduleProvider schedule,
    YouTubeOptions options) => new
{
    pollIntervalSeconds = options.PollIntervalSecondsClamped,
    venues = registry.All
        .Select(venue => Project(venue, store.For(venue.Id), schedule.For(venue)))
        .ToList(),
};

static object DescribeVenue(Venue venue, IReadOnlyDictionary<string, string> avatarByChannel) => new
{
    venue.Id,
    venue.Name,
    venue.Definition.Accent,
    // A configured logo wins; otherwise the channel's own profile picture, if the API gave one.
    logo = string.IsNullOrWhiteSpace(venue.Definition.Logo)
        ? avatarByChannel.GetValueOrDefault(venue.Definition.ChannelId)
        : venue.Definition.Logo,
    venue.Definition.ChannelId,
    venue.Definition.ChannelUrl,
    zones = venue.Definition.Zones,
    stations = venue.Definition.Stations.Select(station => new
    {
        station.Id,
        station.Label,
        station.ZoneId,
    }),
    // Null for venues with no published map; the client then offers the grid only.
    venue.Definition.Layout,
};

static object Project(Venue venue, LiveSnapshot snapshot, VenueStatus status) => new
{
    venueId = venue.Id,
    snapshot.UpdatedAt,
    snapshot.Streams,
    snapshot.Unmatched,
    snapshot.Source,
    snapshot.IsFallbackSource,
    snapshot.Error,
    venue = status,
};
