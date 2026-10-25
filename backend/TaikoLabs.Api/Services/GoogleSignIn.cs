using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;
using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// The Google OAuth client the sign-in uses (README "Google 로그인"). The client id is public
/// and may sit in appsettings.Development.json; the secret never sits in a file in the
/// repository: locally it is a .NET user secret, on a server a Container Apps secret. Without
/// both, sign-in is off and the server is what it was without it.
/// </summary>
public sealed class GoogleSignInOptions
{
    public const string SectionName = "Google";

    public string? ClientId { get; set; }

    public string? ClientSecret { get; set; }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret);
}

/// <summary>Which sign-in the server offers, decided once at start-up.</summary>
public enum GoogleSignInMode
{
    /// <summary>No sign-in: /api/auth/me says so, every other sign-in or chat path is a 404.</summary>
    Off,

    /// <summary>Google's sign-in, with the configured OAuth client.</summary>
    Google,

    /// <summary>
    /// A stand-in that signs in a test user without Google and serves made-up chat, for the
    /// end-to-end tests and the local mock stack. Only ever with YouTube:Mode set to Mock -
    /// the setting no server that people use runs with - whatever else is configured.
    /// </summary>
    Mock,
}

/// <summary>Google's token endpoint answer, as far as the sign-in keeps it.</summary>
public sealed record GoogleTokens(string AccessToken, string? RefreshToken, string? IdToken, DateTimeOffset ExpiresAt);

/// <summary>Who signed in, from the ID token's claims.</summary>
public sealed record GoogleProfile(string Name, string? Email, string? Picture);

/// <summary>How a live chat read ended, when it did not end with messages.</summary>
public enum LiveChatFailure
{
    None,

    /// <summary>The access token was turned down: expired early, or the grant was revoked.</summary>
    Unauthorized,

    /// <summary>The video is not live, has no chat, or its chat has ended.</summary>
    NotLive,

    /// <summary>The OAuth client's project has spent its YouTube quota for the day.</summary>
    QuotaExceeded,

    /// <summary>
    /// Writing only: the viewer may not write to this chat - banned or timed out, a chat for
    /// members or subscribers alone, or a channel YouTube does not let write yet.
    /// </summary>
    Forbidden,

    /// <summary>Writing only: the viewer has sent too many messages in too short a time.</summary>
    TooFast,

    /// <summary>Writing only: YouTube would not take the message's text.</summary>
    Invalid,

    /// <summary>Anything else YouTube said or did not say.</summary>
    Failed,
}

public sealed record LiveChatRead(LiveChatFailure Failure, ChatMessagesResponse? Page = null)
{
    public static LiveChatRead Fail(LiveChatFailure failure) => new(failure);
}

public sealed record LiveChatWrite(LiveChatFailure Failure, ChatMessageInfo? Message = null)
{
    public static LiveChatWrite Fail(LiveChatFailure failure) => new(failure);
}

/// <summary>
/// The calls made to Google for the sign-in and the chat: the code exchange and the token
/// refresh at Google's token endpoint, and the YouTube Data API reads and writes of a
/// broadcast's chat, always with a signed-in viewer's own access token. Never with the
/// server's API key (YouTube:ApiKey): its quota is the venue polls', which the wall's live
/// state depends on, and a chat read every five seconds would spend it in under an hour.
/// The chat is charged to the OAuth client's project alone.
///
/// Nothing here logs a token, a code or the client secret; a failure is logged by its HTTP
/// status and Google's error code alone.
/// </summary>
public sealed class GoogleSignInClient(
    HttpClient http,
    IOptions<GoogleSignInOptions> options,
    TimeProvider clock,
    ILogger<GoogleSignInClient> logger)
{
    public const string AuthorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
    public const string TokenEndpoint = "https://oauth2.googleapis.com/token";
    private const string YouTubeApiBase = "https://www.googleapis.com/youtube/v3";

    /// <summary>
    /// Who the viewer is, and the YouTube scope with writing in it: reading the chat needs
    /// youtube.readonly at least, and writing to it force-ssl, so force-ssl is the one asked for.
    /// </summary>
    public const string Scopes = "openid email profile https://www.googleapis.com/auth/youtube.force-ssl";

    private GoogleSignInOptions Options => options.Value;

    /// <summary>
    /// Google's consent page for this viewer. Offline access with a consent prompt every time,
    /// since Google hands out a refresh token only on a consent: without the prompt a viewer
    /// who signed in once before - on another device, or before a sign-out - would come back
    /// with an access token alone and be signed out again within the hour.
    /// </summary>
    public string AuthorizationUrl(string redirectUri, string state, string codeChallenge) =>
        QueryHelpers.AddQueryString(AuthorizationEndpoint, new Dictionary<string, string?>
        {
            ["client_id"] = Options.ClientId,
            ["redirect_uri"] = redirectUri,
            ["response_type"] = "code",
            ["scope"] = Scopes,
            ["state"] = state,
            ["code_challenge"] = codeChallenge,
            ["code_challenge_method"] = "S256",
            ["access_type"] = "offline",
            ["include_granted_scopes"] = "true",
            ["prompt"] = "consent",
        });

    /// <summary>The authorization code for tokens; null when Google turns it down.</summary>
    public Task<GoogleTokens?> ExchangeCodeAsync(string code, string codeVerifier, string redirectUri, CancellationToken ct) =>
        RequestTokensAsync(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["code_verifier"] = codeVerifier,
            ["redirect_uri"] = redirectUri,
        }, "exchange", ct);

    /// <summary>A fresh access token for the refresh token; null when Google turns it down.</summary>
    public Task<GoogleTokens?> RefreshAsync(string refreshToken, CancellationToken ct) =>
        RequestTokensAsync(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken,
        }, "refresh", ct);

    private async Task<GoogleTokens?> RequestTokensAsync(Dictionary<string, string> form, string what, CancellationToken ct)
    {
        form["client_id"] = Options.ClientId ?? "";
        form["client_secret"] = Options.ClientSecret ?? "";

        try
        {
            using var response = await http.PostAsync(TokenEndpoint, new FormUrlEncodedContent(form), ct);
            var body = await response.Content.ReadAsStringAsync(ct);
            using var document = JsonDocument.Parse(string.IsNullOrWhiteSpace(body) ? "{}" : body);
            var root = document.RootElement;

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning(
                    "Google token {What} failed: {Status} {Error}",
                    what,
                    (int)response.StatusCode,
                    root.GetPropertyOrNull("error")?.GetString() ?? "-");
                return null;
            }

            var accessToken = root.GetPropertyOrNull("access_token")?.GetString();
            if (string.IsNullOrEmpty(accessToken))
            {
                logger.LogWarning("Google token {What} answered without an access token", what);
                return null;
            }

            var expiresIn = root.GetPropertyOrNull("expires_in") is { ValueKind: JsonValueKind.Number } seconds
                ? seconds.GetInt32()
                : 3600;

            return new GoogleTokens(
                accessToken,
                root.GetPropertyOrNull("refresh_token")?.GetString(),
                root.GetPropertyOrNull("id_token")?.GetString(),
                clock.GetUtcNow().AddSeconds(expiresIn));
        }
        catch (Exception error) when (error is HttpRequestException or JsonException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            logger.LogWarning("Google token {What} failed: {Error}", what, error.GetType().Name);
            return null;
        }
    }

    /// <summary>
    /// The name, address and picture in an ID token. The token came straight from Google's
    /// token endpoint over TLS, so its signature need not be checked (OpenID Connect Core
    /// 3.1.3.7); its issuer and audience still are, so a token meant for another client is
    /// not taken. Null when it is not one of ours.
    /// </summary>
    public GoogleProfile? ReadProfile(string? idToken)
    {
        var parts = idToken?.Split('.');
        if (parts is not { Length: 3 })
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(WebEncoders.Base64UrlDecode(parts[1]));
            var claims = document.RootElement;
            var issuer = claims.GetPropertyOrNull("iss")?.GetString();
            var audience = claims.GetPropertyOrNull("aud")?.GetString();
            if (issuer is not ("https://accounts.google.com" or "accounts.google.com") || audience != Options.ClientId)
            {
                return null;
            }

            var email = claims.GetPropertyOrNull("email")?.GetString();
            var name = claims.GetPropertyOrNull("name")?.GetString();
            return new GoogleProfile(
                string.IsNullOrWhiteSpace(name) ? email ?? "Google 사용자" : name,
                email,
                claims.GetPropertyOrNull("picture")?.GetString());
        }
        catch (Exception error) when (error is FormatException or JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// The broadcast's live chat id (videos.list, 1 unit): null with <see cref="LiveChatFailure.NotLive"/>
    /// when the video has none - not live, never was, or its chat is off.
    /// </summary>
    public async Task<(string? ChatId, LiveChatFailure Failure)> FindLiveChatIdAsync(string videoId, string accessToken, CancellationToken ct)
    {
        var url = $"{YouTubeApiBase}/videos?part=liveStreamingDetails&id={Uri.EscapeDataString(videoId)}";
        var (document, failure) = await SendAsync(new HttpRequestMessage(HttpMethod.Get, url), accessToken, "videos.list", writing: false, ct);
        using (document)
        {
            if (document is null)
            {
                return (null, failure);
            }

            var chatId = document.RootElement.GetPropertyOrNull("items") is { ValueKind: JsonValueKind.Array } items
                ? items.EnumerateArray()
                    .Select(item => item.GetPropertyOrNull("liveStreamingDetails")?.GetPropertyOrNull("activeLiveChatId")?.GetString())
                    .FirstOrDefault(id => !string.IsNullOrEmpty(id))
                : null;

            return chatId is null ? (null, LiveChatFailure.NotLive) : (chatId, LiveChatFailure.None);
        }
    }

    /// <summary>One page of the chat (liveChatMessages.list), from where the last one left off.</summary>
    public async Task<LiveChatRead> ListChatMessagesAsync(string liveChatId, string? pageToken, string accessToken, CancellationToken ct)
    {
        var url = $"{YouTubeApiBase}/liveChat/messages?part=snippet,authorDetails&maxResults=200" +
                  $"&liveChatId={Uri.EscapeDataString(liveChatId)}" +
                  (string.IsNullOrEmpty(pageToken) ? "" : $"&pageToken={Uri.EscapeDataString(pageToken)}");

        var (document, failure) = await SendAsync(new HttpRequestMessage(HttpMethod.Get, url), accessToken, "liveChatMessages.list", writing: false, ct);
        using (document)
        {
            return document is null ? LiveChatRead.Fail(failure) : new LiveChatRead(LiveChatFailure.None, ReadChatPage(document.RootElement));
        }
    }

    /// <summary>
    /// A text message in the chat as the viewer (liveChatMessages.insert, 20 units). Insert
    /// answers with the message's snippet alone, without its author, so the author is the
    /// name the viewer signed in with; the next read brings the same message under the same
    /// id with YouTube's own name for the channel, and the page keeps that one.
    /// </summary>
    public async Task<LiveChatWrite> InsertChatMessageAsync(
        string liveChatId,
        string text,
        string author,
        string accessToken,
        CancellationToken ct)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, $"{YouTubeApiBase}/liveChat/messages?part=snippet")
        {
            Content = JsonContent.Create(new
            {
                snippet = new
                {
                    liveChatId,
                    type = "textMessageEvent",
                    textMessageDetails = new { messageText = text },
                },
            }),
        };

        var (document, failure) = await SendAsync(request, accessToken, "liveChatMessages.insert", writing: true, ct);
        using (document)
        {
            if (document is null)
            {
                return LiveChatWrite.Fail(failure);
            }

            var root = document.RootElement;
            var id = root.GetPropertyOrNull("id")?.GetString();
            if (string.IsNullOrEmpty(id))
            {
                logger.LogWarning("YouTube liveChatMessages.insert answered without an id");
                return LiveChatWrite.Fail(LiveChatFailure.Failed);
            }

            var snippet = root.GetPropertyOrNull("snippet");
            return new LiveChatWrite(LiveChatFailure.None, new ChatMessageInfo(
                id,
                author,
                snippet.GetPropertyOrNull("displayMessage")?.GetString() is { Length: > 0 } shown ? shown : text,
                PublishedAt(snippet) ?? clock.GetUtcNow()));
        }
    }

    /// <summary>
    /// The least wait between two reads the page is told, whatever YouTube says. A read is a
    /// liveChatMessages.list, 5 units of the OAuth project's 10,000 a day: at YouTube's own
    /// interval, a second or two in a busy chat, one open sidebar would spend the day's quota
    /// in an hour or two. Five seconds is 720 reads an hour, 3,600 units.
    /// </summary>
    public const int MinPollingIntervalMillis = 5000;

    /// <summary>The liveChatMessages.list answer, read; apart from the call so tests can hand it one.</summary>
    internal static ChatMessagesResponse ReadChatPage(JsonElement root)
    {
        var messages = new List<ChatMessageInfo>();
        if (root.GetPropertyOrNull("items") is { ValueKind: JsonValueKind.Array } items)
        {
            foreach (var item in items.EnumerateArray())
            {
                var snippet = item.GetPropertyOrNull("snippet");
                var id = item.GetPropertyOrNull("id")?.GetString();
                // displayMessage is what YouTube shows for every kind - a Super Chat's comment
                // included; a kind with nothing to read (a membership milestone without words) has none.
                var text = snippet.GetPropertyOrNull("displayMessage")?.GetString();
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(text))
                {
                    continue;
                }

                var authorDetails = item.GetPropertyOrNull("authorDetails");
                messages.Add(new ChatMessageInfo(
                    id,
                    authorDetails.GetPropertyOrNull("displayName")?.GetString() ?? "",
                    text,
                    PublishedAt(snippet),
                    authorDetails.GetPropertyOrNull("isChatOwner")?.ValueKind == JsonValueKind.True
                        ? ChatMessageInfo.OwnerRole
                        : authorDetails.GetPropertyOrNull("isChatModerator")?.ValueKind == JsonValueKind.True
                            ? ChatMessageInfo.ModeratorRole
                            : null));
            }
        }

        return new ChatMessagesResponse
        {
            Messages = messages,
            NextPageToken = root.GetPropertyOrNull("nextPageToken")?.GetString(),
            PollingIntervalMillis = root.GetPropertyOrNull("pollingIntervalMillis") is { ValueKind: JsonValueKind.Number } interval
                ? Math.Max(interval.GetInt32(), MinPollingIntervalMillis)
                : null,
        };
    }

    private static DateTimeOffset? PublishedAt(JsonElement? snippet) =>
        snippet.GetPropertyOrNull("publishedAt")?.GetString() is { } published
        && DateTimeOffset.TryParse(published, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var at)
            ? at
            : null;

    /// <summary>
    /// What a refusal from YouTube means. Reads and writes share most of it; rateLimitExceeded
    /// is where they part - on a read it is the project's quota running short, on a write the
    /// viewer sending faster than the chat takes. A write turned down with 403 for anything
    /// else is the viewer not allowed to write there (banned, members or subscribers only).
    /// </summary>
    internal static LiveChatFailure Classify(HttpStatusCode status, string? reason, bool writing) => (status, reason, writing) switch
    {
        (HttpStatusCode.Unauthorized, _, _) => LiveChatFailure.Unauthorized,
        (_, "liveChatEnded" or "liveChatDisabled" or "liveChatNotFound" or "videoNotFound", _) => LiveChatFailure.NotLive,
        (HttpStatusCode.NotFound, _, _) => LiveChatFailure.NotLive,
        (_, "quotaExceeded" or "dailyLimitExceeded", _) => LiveChatFailure.QuotaExceeded,
        (_, "rateLimitExceeded", false) => LiveChatFailure.QuotaExceeded,
        (_, "rateLimitExceeded", true) => LiveChatFailure.TooFast,
        (_, "messageTextInvalid" or "messageTextRequired", true) => LiveChatFailure.Invalid,
        (HttpStatusCode.Forbidden, _, true) => LiveChatFailure.Forbidden,
        _ => LiveChatFailure.Failed,
    };

    private async Task<(JsonDocument? Document, LiveChatFailure Failure)> SendAsync(
        HttpRequestMessage request,
        string accessToken,
        string what,
        bool writing,
        CancellationToken ct)
    {
        using var _ = request;
        try
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            using var response = await http.SendAsync(request, ct);
            var body = await response.Content.ReadAsStringAsync(ct);

            if (response.IsSuccessStatusCode)
            {
                return (JsonDocument.Parse(body), LiveChatFailure.None);
            }

            var reason = ErrorReason(body);
            var failure = Classify(response.StatusCode, reason, writing);
            if (failure is not (LiveChatFailure.Unauthorized or LiveChatFailure.NotLive))
            {
                logger.LogWarning("YouTube {What} failed: {Status} {Reason}", what, (int)response.StatusCode, reason ?? "-");
            }

            return (null, failure);
        }
        catch (Exception error) when (error is HttpRequestException or JsonException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            logger.LogWarning("YouTube {What} failed: {Error}", what, error.GetType().Name);
            return (null, LiveChatFailure.Failed);
        }
    }

    private static string? ErrorReason(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            return document.RootElement.GetPropertyOrNull("error").GetPropertyOrNull("errors") is { ValueKind: JsonValueKind.Array } errors
                ? errors.EnumerateArray().Select(error => error.GetPropertyOrNull("reason")?.GetString()).FirstOrDefault(reason => reason is not null)
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>
/// Each broadcast's live chat id, remembered for a while: a viewer reading a chat polls every
/// few seconds, and asking videos.list for the same id each time would double the calls.
/// The id is the broadcast's, the same for every viewer. Bounded, since the video ids come
/// from requests.
/// </summary>
public sealed class LiveChatIdCache(TimeProvider clock)
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);
    private const int MaxEntries = 500;

    private readonly ConcurrentDictionary<string, (string ChatId, DateTimeOffset At)> _byVideo = new(StringComparer.Ordinal);

    public string? Find(string videoId) =>
        _byVideo.TryGetValue(videoId, out var entry) && clock.GetUtcNow() - entry.At < Lifetime ? entry.ChatId : null;

    public void Remember(string videoId, string chatId)
    {
        if (_byVideo.Count >= MaxEntries)
        {
            _byVideo.Clear();
        }

        _byVideo[videoId] = (chatId, clock.GetUtcNow());
    }

    /// <summary>Forgets a chat YouTube says has ended, so the next read asks again.</summary>
    public void Forget(string videoId) => _byVideo.TryRemove(videoId, out _);
}

