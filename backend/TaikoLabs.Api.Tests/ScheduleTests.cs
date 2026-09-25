using TaikoLabs.Api.Models;
using TaikoLabs.Api.Services;

namespace TaikoLabs.Api.Tests;

public class ScheduleTests
{
    private static readonly Venue Venue = TestVenues.Create(TestVenues.TaikoLabs());

    private static VenueStatus At(string seoulTime, IReadOnlySet<DateOnly>? closed = null) =>
        VenueScheduleEvaluator.Evaluate(
            DateTimeOffset.Parse(seoulTime + "+09:00").ToUniversalTime(),
            Venue,
            TestVenues.Seoul,
            closed ?? new HashSet<DateOnly>());

    [Fact]
    public void Open_during_listed_hours()
    {
        // 2026-09-24 is a Thursday: 10:00-24:00.
        Assert.Equal(VenueState.Open, At("2026-09-24T15:00:00").State);
        Assert.Equal(VenueState.OutsideHours, At("2026-09-24T09:30:00").State);
    }

    [Fact]
    public void A_window_past_midnight_still_belongs_to_the_day_it_started()
    {
        // Friday 10:00-29:00 runs to 05:00 on Saturday morning.
        var status = At("2026-09-26T03:00:00");
        Assert.Equal(VenueState.Open, status.State);
        Assert.Equal(new DateOnly(2026, 9, 25), status.BusinessDate);

        Assert.Equal(VenueState.OutsideHours, At("2026-09-26T05:30:00").State);
    }

    [Fact]
    public void A_closed_date_reads_as_a_holiday_and_points_to_the_next_opening()
    {
        var status = At("2026-09-24T15:00:00", new HashSet<DateOnly> { new(2026, 9, 24) });

        Assert.Equal(VenueState.ClosedForHoliday, status.State);
        Assert.NotNull(status.OpensAt);
        Assert.True(status.OpensAt > DateTimeOffset.Parse("2026-09-25T00:00:00+09:00"));
    }
}
