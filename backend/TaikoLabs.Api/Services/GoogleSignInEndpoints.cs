using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Google sign-in, and reading a broadcast's live chat as the viewer who signed in.
///
/// The server holds the OAuth client: the authorization code comes back to it, it trades the
/// code for tokens with the client secret (Authorization Code with PKCE), and keeps the tokens
/// in the session cookie - encrypted with ASP.NET Core data protection, HttpOnly, so the page's
/// script never sees them and no answer carries them. Reads go to YouTube with the viewer's
/// access token, renewed with the refresh token when it runs out.
///
/// Signing in here does not sign in the YouTube chat framed in the sidebar: that frame is
/// youtube.com's, with youtube.com's own cookies (lib/chatSidebar.ts).
///
/// Off - no OAuth client configured and not Mock - nothing of this is registered or mapped
/// but /api/auth/me, which says so; the page then offers no sign-in.
/// </summary>
public static partial class GoogleSignInEndpoints
{
    public const string Scheme = "TaikoSession";
    public const string SessionCookieName = "taiko_session";
    public const string CorrelationCookieName = "taiko_signin";
    public const string CallbackPath = "/api/auth/callback";

    /// <summary>How long a sign-in may take at Google before its state and PKCE verifier lapse.</summary>
    private static readonly TimeSpan CorrelationLifetime = TimeSpan.FromMinutes(10);

    /// <summary>An access token this close to running out is renewed before it is used.</summary>
    private static readonly TimeSpan ExpirySkew = TimeSpan.FromMinutes(1);

    private const string CorrelationPurpose = "TaikoLabs.GoogleSignIn.Correlation";

    /// <summary>
    /// Which sign-in to offer. Mock is the configured YouTube:Mode alone - not the effective
    /// mode, which Auto never resolves to Mock - so nothing but that one setting turns the
    /// stand-in on, whatever OAuth client is configured beside it.
    /// </summary>
    public static GoogleSignInMode ResolveMode(IConfiguration configuration)
    {
        if (string.Equals(
                configuration[$"{YouTubeOptions.SectionName}:{nameof(YouTubeOptions.Mode)}"]?.Trim(),
                nameof(LiveSourceMode.Mock),
                StringComparison.OrdinalIgnoreCase))
        {
            return GoogleSignInMode.Mock;
        }

        var google = configuration.GetSection(GoogleSignInOptions.SectionName).Get<GoogleSignInOptions>();
        return google?.IsConfigured == true ? GoogleSignInMode.Google : GoogleSignInMode.Off;
    }

    public static void AddGoogleSignIn(this IServiceCollection services, GoogleSignInMode mode, IConfiguration configuration)
    {
        services.Configure<GoogleSignInOptions>(configuration.GetSection(GoogleSignInOptions.SectionName));
        if (mode == GoogleSignInMode.Off)
        {
            return;
        }

        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton<LiveChatIdCache>();
        services.AddHttpClient<GoogleSignInClient>(client =>
        {
            client.Timeout = TimeSpan.FromSeconds(20);
            client.DefaultRequestHeaders.UserAgent.ParseAdd("TaikoMultiview/1.0");
        });

        services.AddAuthentication(Scheme).AddCookie(Scheme, cookie =>
        {
            cookie.Cookie.Name = SessionCookieName;
            cookie.Cookie.HttpOnly = true;
            // Lax, not Strict: the session must already be there on the page Google's callback
            // lands on, which a cross-site navigation brought up.
            cookie.Cookie.SameSite = SameSiteMode.Lax;
            // Secure over HTTPS. Behind the Container Apps ingress the request is HTTPS by the
            // X-Forwarded-Proto that UseForwardedHeaders takes; localhost stays plain HTTP.
            cookie.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
            // Only /api reads it; the page and its assets go without.
            cookie.Cookie.Path = "/api";
            // Kept across browser restarts, and renewed while used. Google's refresh token is
            // what really bounds a session: a revoked or lapsed one signs the viewer out at the
            // next chat read.
            cookie.ExpireTimeSpan = TimeSpan.FromDays(30);
            cookie.SlidingExpiration = true;
            // An API answers 401 and 403; it does not send the page to a login form.
            cookie.Events.OnRedirectToLogin = context =>
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return Task.CompletedTask;
            };
            cookie.Events.OnRedirectToAccessDenied = context =>
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return Task.CompletedTask;
            };
        });
    }

    public static void MapGoogleSignIn(
        this WebApplication app,
        GoogleSignInMode mode,
        string signInLimit,
        string callbackLimit,
        string chatLimit)
    {
        // Mapped whatever the mode, so the page can ask before it shows anything.
        app.MapGet("/api/auth/me", async (HttpContext context) =>
        {
            NoStore(context);
            if (mode == GoogleSignInMode.Off)
            {
                return TypedResults.Ok(new AuthStatusResponse { Enabled = false, SignedIn = false });
            }

            var user = (await context.AuthenticateAsync(Scheme)).Principal;
            return TypedResults.Ok(user?.Identity?.IsAuthenticated == true
                ? new AuthStatusResponse
                {
                    Enabled = true,
                    SignedIn = true,
                    Name = user.FindFirstValue(ClaimTypes.Name),
                    Email = user.FindFirstValue(ClaimTypes.Email),
                    Picture = user.FindFirstValue(PictureClaim),
                }
                : new AuthStatusResponse { Enabled = true, SignedIn = false });
        })
            .WithTags("로그인")
            .WithSummary("로그인 상태")
            .WithDescription("Google 로그인을 제공하는지(enabled)와 로그인한 사용자의 이름·이메일·사진. 토큰은 세션 쿠키 안에만 있고 응답에는 절대 넣지 않습니다.");

        if (mode == GoogleSignInMode.Off)
        {
            return;
        }

        app.MapGet("/api/auth/login", async (
            HttpContext context,
            GoogleSignInClient google,
            IDataProtectionProvider protection) =>
        {
            NoStore(context);
            var returnTo = ReturnTarget(context.Request);

            if (mode == GoogleSignInMode.Mock)
            {
                await context.SignInAsync(Scheme, Principal(MockProfile), new AuthenticationProperties { IsPersistent = true });
                return Results.Redirect(returnTo);
            }

            var verifier = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
            var challenge = WebEncoders.Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
            var state = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
            var redirectUri = CallbackUri(context.Request);

            var correlation = JsonSerializer.Serialize(new SignInCorrelation(state, verifier, redirectUri, returnTo));
            context.Response.Cookies.Append(
                CorrelationCookieName,
                CorrelationProtector(protection).Protect(correlation, CorrelationLifetime),
                CorrelationCookie(context.Request, CorrelationLifetime));

            return Results.Redirect(google.AuthorizationUrl(redirectUri, state, challenge));
        })
            .RequireRateLimiting(signInLimit)
            .WithTags("로그인")
            .WithSummary("Google 로그인 시작")
            .WithDescription("Google 동의 화면으로 보냅니다(Authorization Code + PKCE, 오프라인 접근). 돌아오면 로그인을 누른 페이지로 갑니다. IP당 분당 10회 제한.");

        if (mode == GoogleSignInMode.Google)
        {
            app.MapGet(CallbackPath, async (
                HttpContext context,
                GoogleSignInClient google,
                IDataProtectionProvider protection,
                CancellationToken ct) =>
            {
                NoStore(context);
                var correlation = ReadCorrelation(context.Request, protection);
                // One use: whatever happens next, this sign-in's state is spent.
                context.Response.Cookies.Delete(CorrelationCookieName, CorrelationCookie(context.Request, lifetime: null));

                // Not the sign-in this browser started - or one past its ten minutes. Nothing
                // to go back to: the page that started it is not known.
                if (correlation is null || !SameText(correlation.State, context.Request.Query["state"].ToString()))
                {
                    return Results.BadRequest();
                }

                // Google sends the viewer back with an error when they cancel at the consent page.
                var code = context.Request.Query["code"].ToString();
                if (!string.IsNullOrEmpty(context.Request.Query["error"].ToString()) || string.IsNullOrEmpty(code))
                {
                    return Results.Redirect(WithSignInFailed(correlation.ReturnTo, failed: true));
                }

                var tokens = await google.ExchangeCodeAsync(code, correlation.Verifier, correlation.RedirectUri, ct);
                var profile = google.ReadProfile(tokens?.IdToken);
                if (tokens is null || profile is null)
                {
                    return Results.Redirect(WithSignInFailed(correlation.ReturnTo, failed: true));
                }

                await context.SignInAsync(Scheme, Principal(profile), Session(tokens));
                return Results.Redirect(WithSignInFailed(correlation.ReturnTo, failed: false));
            })
                .RequireRateLimiting(callbackLimit)
                .ExcludeFromDescription();
        }

        app.MapPost("/api/auth/logout", async (HttpContext context) =>
        {
            NoStore(context);
            await context.SignOutAsync(Scheme);
            return TypedResults.NoContent();
        })
            .WithTags("로그인")
            .WithSummary("로그아웃")
            .WithDescription("세션 쿠키를 지웁니다.");

        app.MapGet("/api/chat/{videoId}/messages", async (
            string videoId,
            string? pageToken,
            HttpContext context,
            IServiceProvider services,
            CancellationToken ct) =>
        {
            NoStore(context);
            if (!VideoIdPattern().IsMatch(videoId) || pageToken is { Length: > 512 })
            {
                return Results.BadRequest();
            }

            var signedIn = await context.AuthenticateAsync(Scheme);
            if (!signedIn.Succeeded || signedIn.Principal is null || signedIn.Properties is null)
            {
                return Results.Unauthorized();
            }

            var clock = services.GetRequiredService<TimeProvider>();
            if (mode == GoogleSignInMode.Mock)
            {
                return Results.Ok(MockChatPage(pageToken, clock.GetUtcNow()));
            }

            var google = services.GetRequiredService<GoogleSignInClient>();
            var chatIds = services.GetRequiredService<LiveChatIdCache>();
            var properties = signedIn.Properties;
            var refreshed = false;

            async Task<bool> Refresh()
            {
                var refreshToken = properties.GetTokenValue("refresh_token");
                var fresh = refreshToken is null ? null : await google.RefreshAsync(refreshToken, ct);
                if (fresh is null)
                {
                    return false;
                }

                // Google seldom sends a new refresh token with a refresh; the one held stays good.
                StoreTokens(properties, fresh with { RefreshToken = fresh.RefreshToken ?? refreshToken });
                refreshed = true;
                return true;
            }

            if (ExpiresAt(properties) - ExpirySkew <= clock.GetUtcNow() && !await Refresh())
            {
                await context.SignOutAsync(Scheme);
                return Results.Unauthorized();
            }

            var read = await ReadChatAsync(google, chatIds, videoId, pageToken, properties.GetTokenValue("access_token")!, ct);

            // Turned down before its time - revoked, or the clock is off: renewed once and asked again.
            if (read.Failure == LiveChatFailure.Unauthorized && !refreshed && await Refresh())
            {
                read = await ReadChatAsync(google, chatIds, videoId, pageToken, properties.GetTokenValue("access_token")!, ct);
            }

            if (read.Failure == LiveChatFailure.Unauthorized)
            {
                await context.SignOutAsync(Scheme);
                return Results.Unauthorized();
            }

            if (refreshed)
            {
                // The cookie carries the new access token from here on.
                await context.SignInAsync(Scheme, signedIn.Principal, properties);
            }

            return read.Failure switch
            {
                LiveChatFailure.None => Results.Ok(read.Page),
                LiveChatFailure.NotLive => Results.Json(new ChatError("notLive"), statusCode: StatusCodes.Status404NotFound),
                LiveChatFailure.QuotaExceeded => Results.Json(new ChatError("quotaExceeded"), statusCode: StatusCodes.Status503ServiceUnavailable),
                _ => Results.Json(new ChatError("failed"), statusCode: StatusCodes.Status502BadGateway),
            };
        })
            .RequireRateLimiting(chatLimit)
            .WithTags("채팅")
            .WithSummary("라이브 채팅 읽기")
            .WithDescription("로그인한 사용자의 토큰으로 방송의 라이브 채팅을 읽습니다(로그인하지 않았으면 401). pageToken에 앞 응답의 nextPageToken을 주면 그 뒤의 메시지만 옵니다. 다음 요청은 pollingIntervalMillis가 지난 뒤에. 라이브가 아니면 404 notLive. 할당량은 OAuth 클라이언트의 프로젝트로 청구됩니다. IP당 분당 120회 제한.");
    }

    private static async Task<LiveChatRead> ReadChatAsync(
        GoogleSignInClient google,
        LiveChatIdCache chatIds,
        string videoId,
        string? pageToken,
        string accessToken,
        CancellationToken ct)
    {
        var chatId = chatIds.Find(videoId);
        if (chatId is null)
        {
            var (found, failure) = await google.FindLiveChatIdAsync(videoId, accessToken, ct);
            if (found is null)
            {
                return LiveChatRead.Fail(failure);
            }

            chatIds.Remember(videoId, found);
            chatId = found;
        }

        var read = await google.ListChatMessagesAsync(chatId, pageToken, accessToken, ct);
        if (read.Failure == LiveChatFailure.NotLive)
        {
            chatIds.Forget(videoId);
        }

        return read;
    }

    // --------------------------------------------------------------- the session

    private const string PictureClaim = "picture";

    private static ClaimsPrincipal Principal(GoogleProfile profile)
    {
        var claims = new List<Claim> { new(ClaimTypes.Name, profile.Name) };
        if (!string.IsNullOrEmpty(profile.Email))
        {
            claims.Add(new Claim(ClaimTypes.Email, profile.Email));
        }

        if (!string.IsNullOrEmpty(profile.Picture))
        {
            claims.Add(new Claim(PictureClaim, profile.Picture));
        }

        return new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme));
    }

    private static AuthenticationProperties Session(GoogleTokens tokens)
    {
        var properties = new AuthenticationProperties { IsPersistent = true };
        StoreTokens(properties, tokens);
        return properties;
    }

    // The ID token is read for the profile and dropped: kept, it would only grow the cookie.
    private static void StoreTokens(AuthenticationProperties properties, GoogleTokens tokens)
    {
        var stored = new List<AuthenticationToken>
        {
            new() { Name = "access_token", Value = tokens.AccessToken },
            new() { Name = "expires_at", Value = tokens.ExpiresAt.ToString("o", CultureInfo.InvariantCulture) },
        };
        if (!string.IsNullOrEmpty(tokens.RefreshToken))
        {
            stored.Add(new AuthenticationToken { Name = "refresh_token", Value = tokens.RefreshToken });
        }

        properties.StoreTokens(stored);
    }

    private static DateTimeOffset ExpiresAt(AuthenticationProperties properties) =>
        DateTimeOffset.TryParse(properties.GetTokenValue("expires_at"), CultureInfo.InvariantCulture, DateTimeStyles.None, out var at)
            ? at
            : DateTimeOffset.MinValue;

    // --------------------------------------------------------------- the round trip to Google

    /// <summary>What the sign-in carries from /api/auth/login to the callback, encrypted in a cookie.</summary>
    private sealed record SignInCorrelation(string State, string Verifier, string RedirectUri, string ReturnTo);

    private static ITimeLimitedDataProtector CorrelationProtector(IDataProtectionProvider protection) =>
        protection.CreateProtector(CorrelationPurpose).ToTimeLimitedDataProtector();

    private static SignInCorrelation? ReadCorrelation(HttpRequest request, IDataProtectionProvider protection)
    {
        if (!request.Cookies.TryGetValue(CorrelationCookieName, out var sealedValue) || string.IsNullOrEmpty(sealedValue))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<SignInCorrelation>(CorrelationProtector(protection).Unprotect(sealedValue));
        }
        catch (Exception error) when (error is CryptographicException or JsonException or FormatException)
        {
            // Tampered with, from another key, or past its lifetime.
            return null;
        }
    }

    private static CookieOptions CorrelationCookie(HttpRequest request, TimeSpan? lifetime) => new()
    {
        HttpOnly = true,
        // Lax: Google's redirect back is a top-level navigation from another site, which a
        // Strict cookie would miss.
        SameSite = SameSiteMode.Lax,
        Secure = request.IsHttps,
        Path = "/api/auth",
        MaxAge = lifetime,
        IsEssential = true,
    };

    /// <summary>
    /// Where Google sends the viewer back: this server, as the request reached it. Behind the
    /// Container Apps ingress the scheme is the X-Forwarded-Proto that UseForwardedHeaders
    /// took, and the host the one the browser asked for. Google takes only the redirect URIs
    /// registered for the client, so each address has to be listed there.
    /// </summary>
    private static string CallbackUri(HttpRequest request) =>
        $"{request.Scheme}://{request.Host}{request.PathBase}{CallbackPath}";

    /// <summary>
    /// The page the sign-in started from, to go back to: the referring page, when it is on
    /// this host. A port of its own is allowed - locally the page is Vite's (5173) and this
    /// server another port, and cookies do not tell ports apart - but never another host, so
    /// a link from elsewhere cannot use the sign-in to send someone there. Anything else is "/".
    /// </summary>
    internal static string ReturnTarget(HttpRequest request)
    {
        if (!Uri.TryCreate(request.Headers.Referer.ToString(), UriKind.Absolute, out var from)
            || from.Scheme is not ("http" or "https")
            || !string.Equals(from.Host, request.Host.Host, StringComparison.OrdinalIgnoreCase)
            // "//elsewhere" would be read as another host.
            || from.AbsolutePath.StartsWith("//", StringComparison.Ordinal)
            || from.AbsolutePath.StartsWith("/\\", StringComparison.Ordinal))
        {
            return "/";
        }

        var sameOrigin = from.Scheme == request.Scheme && from.Port == (request.Host.Port ?? (request.IsHttps ? 443 : 80));
        return sameOrigin ? from.PathAndQuery : from.GetComponents(UriComponents.SchemeAndServer | UriComponents.PathAndQuery, UriFormat.UriEscaped);
    }

    /// <summary>The page to go back to, with <c>signin=failed</c> when the sign-in did not go through.</summary>
    internal static string WithSignInFailed(string target, bool failed)
    {
        var queryAt = target.IndexOf('?');
        var path = queryAt < 0 ? target : target[..queryAt];
        var query = QueryHelpers.ParseQuery(queryAt < 0 ? "" : target[queryAt..]);
        query.Remove("signin");

        var pairs = query.SelectMany(pair => pair.Value.Select(value => new KeyValuePair<string, string?>(pair.Key, value))).ToList();
        if (failed)
        {
            pairs.Add(new("signin", "failed"));
        }

        return QueryHelpers.AddQueryString(path, pairs);
    }

    private static bool SameText(string expected, string actual) =>
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(actual));

    // Answers about who is signed in are this viewer's alone; nothing in between keeps them.
    private static void NoStore(HttpContext context) => context.Response.Headers.CacheControl = "no-store";

    // YouTube's ids, and the mock server's longer "mock-..." ones.
    [GeneratedRegex("^[A-Za-z0-9_-]{6,64}$")]
    private static partial Regex VideoIdPattern();

    private sealed record ChatError(string Error);

    // --------------------------------------------------------------- Mock mode

    internal static readonly GoogleProfile MockProfile = new("테스트 사용자", "tester@example.com", null);

    /// <summary>
    /// Made-up chat for Mock mode: three messages to begin with, then one new message on each
    /// read after, so a page left open shows its polling working. The same whatever the video.
    /// </summary>
    internal static ChatMessagesResponse MockChatPage(string? pageToken, DateTimeOffset now)
    {
        const int PollingIntervalMillis = 5000;
        var page = pageToken is not null
                   && pageToken.StartsWith("mock-", StringComparison.Ordinal)
                   && int.TryParse(pageToken.AsSpan(5), NumberStyles.None, CultureInfo.InvariantCulture, out var number)
            ? Math.Clamp(number, 1, 100_000)
            : 0;

        IReadOnlyList<ChatMessageInfo> messages = page == 0
            ?
            [
                new("mock-message-1", "동카 연습생", "안녕하세요!", now.AddSeconds(-20)),
                new("mock-message-2", "오니 마스터", "이 곡 풀콤 가나요", now.AddSeconds(-10)),
                new("mock-message-3", "TAIKO LABS", "곧 다음 곡 갑니다", now.AddSeconds(-5)),
            ]
            : [new($"mock-message-{page + 3}", "동카 연습생", $"새 메시지 {page}", now)];

        return new ChatMessagesResponse
        {
            Messages = messages,
            NextPageToken = $"mock-{page + 1}",
            PollingIntervalMillis = PollingIntervalMillis,
        };
    }
}
