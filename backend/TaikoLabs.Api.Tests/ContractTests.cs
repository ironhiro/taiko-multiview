using System.Text.Json;
using System.Text.Json.Nodes;
using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Tests;

/// <summary>
/// The API's answers, written the way the server writes them, against the frontend's copy
/// in frontend/src/test/contract. The frontend checks the same files against its types
/// (contract.test.ts there), so a field renamed, dropped or made nullable on one side
/// fails a test on the other instead of reaching a page.
/// </summary>
public class ContractTests
{
    private static readonly JsonSerializerOptions Options = CreateOptions();

    private static JsonSerializerOptions CreateOptions()
    {
        // The defaults ASP.NET Core starts minimal APIs from, then the app's own settings.
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJson.Configure(options);
        return options;
    }

    private static readonly DateTimeOffset Noon = new(2026, 10, 2, 12, 0, 0, TimeSpan.FromHours(9));

    [Fact]
    public void Live_answer_matches_the_frontends_copy()
    {
        var response = new LiveResponse
        {
            PollIntervalSeconds = 60,
            VenuesVersion = 3,
            Venues =
            [
                new VenueLive
                {
                    VenueId = "taikolabs",
                    UpdatedAt = Noon,
                    Streams =
                    [
                        new LiveStream
                        {
                            StationId = "a1",
                            VideoId = "videoA1",
                            Title = "TAIKO LABS A1 Live Streaming 26.10.02 - 1부",
                            Name = "A1",
                            StreamDate = "26.10.02",
                            Part = 1,
                            IsLive = true,
                            Embeddable = true,
                            ConcurrentViewers = 12,
                            ActualStartTime = Noon.AddHours(-2),
                            PublishedAt = Noon.AddHours(-2),
                            ThumbnailUrl = "https://i.ytimg.com/vi/videoA1/hqdefault_live.jpg",
                        },
                    ],
                    // Named by no cabinet: no station id, and so none in the answer.
                    Unmatched =
                    [
                        new LiveStream
                        {
                            VideoId = "videoBase2",
                            Title = "TAIKO LABS THE BASE 2 Live Streaming 26.10.02",
                            Name = "THE BASE 2",
                            IsLive = true,
                            Embeddable = false,
                        },
                    ],
                    Source = LiveSourceMode.Api,
                    IsFallbackSource = false,
                    Venue = new VenueStatus
                    {
                        State = VenueState.Open,
                        LocalTime = Noon,
                        BusinessDate = new DateOnly(2026, 10, 2),
                        TodayHours = "10:00-24:00",
                    },
                },
                // Never polled yet, and closed: every optional field left out.
                new VenueLive
                {
                    VenueId = "p2zone",
                    Streams = [],
                    Unmatched = [],
                    Source = LiveSourceMode.Auto,
                    IsFallbackSource = true,
                    Error = "채널 조회 실패",
                    Venue = new VenueStatus
                    {
                        State = VenueState.ClosedForHoliday,
                        LocalTime = Noon,
                        OpensAt = Noon.AddDays(1).AddHours(-2),
                        ClosureReason = "naver",
                    },
                },
            ],
        };

        AssertMatches("live.json", response);
    }

    [Fact]
    public void Venue_list_matches_the_frontends_copy()
    {
        var response = new VenuesResponse
        {
            Version = 3,
            Venues =
            [
                new VenueInfo
                {
                    Id = "taikolabs",
                    Name = "TAIKO LABS",
                    Accent = "#E8B24A",
                    Logo = "/logos/taikolabs.png",
                    ChannelId = "UC0tzRzxBMM1-riQVHHYoADw",
                    ChannelUrl = "https://www.youtube.com/@TAIKO_LABS",
                    Zones = [new ZoneDefinition { Id = "sector-a", Code = "SECTOR A", Label = "A 사이트" }],
                    // A cabinet in no zone has no zoneId in the answer.
                    Stations = [new StationInfo("a1", "A1", "sector-a"), new StationInfo("base", "THE BASE", null)],
                },
                new VenueInfo
                {
                    Id = "p2zone",
                    Name = "부천 P2존",
                    ChannelId = "UCp2zone",
                    Zones = [],
                    Stations = [],
                },
            ],
        };

        AssertMatches("venues.json", response);
    }

    private static void AssertMatches<T>(string file, T response)
    {
        var actual = JsonSerializer.SerializeToNode(response, Options);
        var expected = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "contract", file)));

        Assert.True(
            JsonNode.DeepEquals(expected, actual),
            $"frontend/src/test/contract/{file} no longer matches what the server writes:\n{actual!.ToJsonString(new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping })}");
    }
}
