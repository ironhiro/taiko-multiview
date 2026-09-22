using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// The opening-hours algorithm, with no dependency on the clock or on DI so the awkward
/// cases — a window running past midnight, a closure landing on such a day — can be
/// evaluated at an arbitrary instant.
/// </summary>
public static class VenueScheduleEvaluator
{
    /// <summary>How far ahead to look when reporting the next opening.</summary>
    private const int LookaheadDays = 14;

    public static VenueStatus Evaluate(
        DateTimeOffset utcNow,
        Venue venue,
        TimeZoneInfo timeZone,
        IReadOnlySet<DateOnly> autoClosedDates)
    {
        var manual = venue.ManualClosedDates;
        bool IsClosed(DateOnly date) => manual.Contains(date) || autoClosedDates.Contains(date);

        var now = TimeZoneInfo.ConvertTime(utcNow, timeZone);
        var today = DateOnly.FromDateTime(now.DateTime);

        // A window that runs past midnight still belongs to the previous day, so check
        // yesterday as well before concluding that we are outside opening hours.
        foreach (var offset in (int[])[0, -1])
        {
            var date = today.AddDays(offset);
            var window = venue.WindowFor(date.DayOfWeek);
            if (window is null)
            {
                continue;
            }

            var start = ToInstant(date, window.StartMinutes, timeZone);
            var end = ToInstant(date, window.EndMinutes, timeZone);

            if (now < start || now >= end)
            {
                continue;
            }

            var closed = IsClosed(date);

            return new VenueStatus
            {
                State = closed ? VenueState.ClosedForHoliday : VenueState.Open,
                LocalTime = now,
                BusinessDate = date,
                TodayHours = window.Describe(),
                // While shut for the day, the useful answer is the next day that is open.
                OpensAt = NextOpening(now, venue, timeZone, IsClosed, skipBusinessDate: closed ? date : null),
                ClosureReason = closed ? (manual.Contains(date) ? "manual" : "naver") : null,
            };
        }

        return new VenueStatus
        {
            State = VenueState.OutsideHours,
            LocalTime = now,
            OpensAt = NextOpening(now, venue, timeZone, IsClosed, skipBusinessDate: null),
        };
    }

    private static DateTimeOffset? NextOpening(
        DateTimeOffset now,
        Venue venue,
        TimeZoneInfo timeZone,
        Func<DateOnly, bool> isClosed,
        DateOnly? skipBusinessDate)
    {
        var today = DateOnly.FromDateTime(now.DateTime);

        for (var offset = 0; offset <= LookaheadDays; offset++)
        {
            var date = today.AddDays(offset);

            if (date == skipBusinessDate || isClosed(date))
            {
                continue;
            }

            var window = venue.WindowFor(date.DayOfWeek);
            if (window is null)
            {
                continue;
            }

            var start = ToInstant(date, window.StartMinutes, timeZone);
            if (start > now)
            {
                return start;
            }
        }

        return null;
    }

    private static DateTimeOffset ToInstant(DateOnly date, int minutesFromMidnight, TimeZoneInfo timeZone)
    {
        var naive = date.ToDateTime(TimeOnly.MinValue).AddMinutes(minutesFromMidnight);
        return new DateTimeOffset(naive, timeZone.GetUtcOffset(naive));
    }
}
