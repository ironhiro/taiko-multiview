using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Answers whether a given venue is open right now.
///
/// This only chooses the wording of the empty state — "준비중", "영업 종료" or
/// "오늘 휴무". A live broadcast always wins over it, so a wrong answer here can never
/// hide a stream that is actually running.
/// </summary>
public sealed class VenueScheduleProvider(
    VenueRegistry registry,
    VenueClosureStore closures,
    TimeProvider? clock = null)
{
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;

    public VenueStatus For(Venue venue) =>
        VenueScheduleEvaluator.Evaluate(
            _clock.GetUtcNow(),
            venue,
            registry.TimeZone,
            closures.For(venue.Id));
}
