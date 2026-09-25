namespace TaikoLabs.Api.Services;

/// <summary>
/// Channel profile pictures, used as venue logos when the configuration names none.
///
/// Fetched lazily on the first /api/venues request and kept for a day: avatars rarely
/// change, and the lookup should never cost more than a unit or two of quota a day.
/// A failed lookup keeps the last good result and is retried after a short back-off, so
/// a YouTube hiccup costs the logo rather than the venue list.
/// </summary>
public sealed class ChannelAvatarCache(ILogger<ChannelAvatarCache> logger)
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromHours(24);
    private static readonly TimeSpan RetryAfterFailure = TimeSpan.FromMinutes(10);

    private readonly SemaphoreSlim _gate = new(1, 1);
    private IReadOnlyDictionary<string, string> _avatars = new Dictionary<string, string>();
    private DateTimeOffset _expiresAt = DateTimeOffset.MinValue;

    public async Task<IReadOnlyDictionary<string, string>> GetAsync(
        YouTubeLiveClient client,
        IReadOnlyCollection<string> channelIds,
        CancellationToken ct)
    {
        if (DateTimeOffset.UtcNow < _expiresAt)
        {
            return _avatars;
        }

        await _gate.WaitAsync(ct);
        try
        {
            if (DateTimeOffset.UtcNow < _expiresAt)
            {
                return _avatars;
            }

            try
            {
                _avatars = await client.FetchChannelAvatarsAsync(channelIds, ct);
                _expiresAt = DateTimeOffset.UtcNow + Lifetime;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Could not fetch channel avatars; venues keep their text names for now");
                _expiresAt = DateTimeOffset.UtcNow + RetryAfterFailure;
            }

            return _avatars;
        }
        finally
        {
            _gate.Release();
        }
    }
}
