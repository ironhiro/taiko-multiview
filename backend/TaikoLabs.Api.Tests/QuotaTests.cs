using System.Net;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using TaikoLabs.Api.Models;
using TaikoLabs.Api.Services;

namespace TaikoLabs.Api.Tests;

/// <summary>What a day of polling costs, and what happens when the day's quota is gone.</summary>
public class QuotaTests
{
    private static YouTubeOptions Defaults() => new()
    {
        PollIntervalSeconds = 60,
        ClosedPollIntervalSeconds = 600,
        PreOpenMinutes = 30,
    };

    [Fact]
    public void A_venue_costs_what_its_opening_hours_come_to()
    {
        // Open 10:00-24:00 on weekdays, later at the weekend: 16.29 hours a day on average.
        var venue = TestVenues.Create(TestVenues.TaikoLabs());

        var quota = QuotaEstimate.For((Venue[])[venue], Defaults());

        Assert.Equal(1, quota.Venues);
        Assert.Equal(16.29, quota.OpenHoursPerDay, 2);
        // 16.29h + half an hour before opening at 60s a poll, the remaining 7.2h at 600s,
        // two units a poll, plus one for the day's channel avatars.
        Assert.InRange(quota.UnitsPerDay, 2_100, 2_200);
        Assert.False(quota.IsCrowded);
    }

    [Fact]
    public void Four_venues_of_these_hours_take_most_of_the_daily_limit()
    {
        // The shape of the configured four: 65.8 venue-hours a day between them.
        string[] hours = ["10:00-24:00", "10:30-29:00", "09:00-24:00", "09:00-25:00"];
        Venue[] venues = [.. hours.Select((value, index) => TestVenues.Create(EveryDay($"venue-{index}", value)))];

        var quota = QuotaEstimate.For(venues, Defaults());

        Assert.Equal(4, quota.Venues);
        // The review's own figure for this configuration: about 8,500 units, 85% of the limit.
        Assert.InRange(quota.UnitsPerDay, 8_000, 9_000);
        Assert.InRange(quota.PercentOfLimit, 80, 90);
        // No room for a fifth venue, which is what the warning at startup is for.
        Assert.True(quota.IsCrowded);
    }

    [Fact]
    public void Polling_less_often_costs_less()
    {
        var venues = (Venue[])[TestVenues.Create(TestVenues.TaikoLabs())];
        var options = Defaults();
        options.PollIntervalSeconds = 120;

        Assert.True(QuotaEstimate.For(venues, options).UnitsPerDay < QuotaEstimate.For(venues, Defaults()).UnitsPerDay);
    }

    [Theory]
    // The body Google sends when the day's allowance is spent.
    [InlineData(HttpStatusCode.Forbidden, """{"error":{"errors":[{"reason":"quotaExceeded"}]}}""", true)]
    [InlineData(HttpStatusCode.Forbidden, """{"error":{"errors":[{"reason":"dailyLimitExceeded"}]}}""", true)]
    // Other 403s are ordinary failures: retrying them next round is the right thing to do.
    [InlineData(HttpStatusCode.Forbidden, """{"error":{"errors":[{"reason":"ipRefererBlocked"}]}}""", false)]
    [InlineData(HttpStatusCode.NotFound, """{"error":{"errors":[{"reason":"quotaExceeded"}]}}""", false)]
    public void Only_a_403_that_names_the_quota_counts_as_quota_exhausted(HttpStatusCode status, string body, bool expected)
    {
        Assert.Equal(expected, YouTubeLiveClient.IsQuotaExceeded(status, body));
    }

    [Fact]
    public async Task An_exhausted_quota_leaves_a_snapshot_that_says_so_without_quoting_youtube()
    {
        var snapshot = await FetchWith(
            HttpStatusCode.Forbidden,
            """{"error":{"errors":[{"reason":"quotaExceeded","message":"secret upstream detail"}]}}""");

        Assert.Empty(snapshot.Streams);
        Assert.Contains("quota", snapshot.Error, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("secret upstream detail", snapshot.Error);
    }

    [Fact]
    public async Task Another_refusal_still_reports_the_status_it_failed_with()
    {
        var snapshot = await FetchWith(HttpStatusCode.ServiceUnavailable, "upstream is down");

        Assert.Empty(snapshot.Streams);
        Assert.Contains("503", snapshot.Error);
        Assert.DoesNotContain("quota", snapshot.Error, StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<LiveSnapshot> FetchWith(HttpStatusCode status, string body)
    {
        var http = new HttpClient(new StubHandler(status, body));
        var options = Options.Create(new YouTubeOptions { ApiKey = "test-key", Mode = LiveSourceMode.Api });
        var client = new YouTubeLiveClient(
            http,
            new PublicLiveProbe(http, new EndedBroadcastCache(), NullLogger<PublicLiveProbe>.Instance),
            options,
            NullLogger<YouTubeLiveClient>.Instance);

        return (await client.FetchAsync(TestVenues.Create(TestVenues.TaikoLabs()), CancellationToken.None)).Snapshot;
    }

    private static VenueDefinition EveryDay(string id, string hours)
    {
        var definition = TestVenues.TaikoLabs();
        definition.Id = id;
        definition.Hours = new(StringComparer.OrdinalIgnoreCase);
        foreach (var day in Enum.GetValues<DayOfWeek>())
        {
            definition.Hours[day.ToString()] = hours;
        }

        return definition;
    }

    /// <summary>Answers every call the same way, as an API in trouble would.</summary>
    private sealed class StubHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body) });
    }
}
