namespace TaikoLabs.Api.Services;

/// <summary>
/// The Data API refused a call because the project's daily allowance is spent.
///
/// Told apart from every other failure because nothing can be done about it today: the
/// allowance resets at midnight Pacific time, and until then every poll of every venue gets
/// the same answer. A network blip is worth retrying a minute later; this is not, and the
/// two read alike in a log unless they are separated here.
/// </summary>
public sealed class YouTubeQuotaExceededException(string message) : Exception(message);
