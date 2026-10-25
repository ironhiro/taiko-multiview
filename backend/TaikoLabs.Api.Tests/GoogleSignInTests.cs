using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using TaikoLabs.Api.Services;

namespace TaikoLabs.Api.Tests;

/// <summary>
/// Google sign-in hands the server a viewer's YouTube tokens, so what must hold is narrow:
/// off, the server is as it was; a callback that is not this browser's own sign-in signs no
/// one in; tokens never leave the encrypted cookie; a lapsed token is renewed, and a renewal
/// Google turns down signs the viewer out. Google itself is a fake handler here.
/// </summary>
public class GoogleSignInTests
{
    private const string ClientId = "test-client-id.apps.googleusercontent.com";
    // Made up for the tests; the real secret never appears in the repository.
    private const string ClientSecret = "test-client-secret-not-real";

    // --- off --------------------------------------------------------------------

    [Theory]
    [InlineData(null, null)]
    [InlineData(ClientId, null)]
    [InlineData(null, ClientSecret)]
    public async Task Without_both_client_settings_nothing_is_there_but_me_saying_so(string? clientId, string? clientSecret)
    {
        await using var app = new SignInApp(youTubeMode: "Auto", clientId, clientSecret);
        using var client = app.CreateSignInClient();

        var me = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        Assert.Equal("""{"enabled":false,"signedIn":false}""", await me.Content.ReadAsStringAsync());

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/auth/login")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/auth/callback?state=x&code=y")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync("/api/auth/logout", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/chat/abcdefghijk/messages")).StatusCode);
        Assert.Empty(app.Google.Requests);
    }

    [Fact]
    public async Task Off_the_security_headers_and_policy_are_as_before_and_no_cookie_is_set()
    {
        await using var app = new SignInApp(youTubeMode: "Auto", clientId: null, clientSecret: null);
        using var client = app.CreateSignInClient();

        foreach (var path in new[] { "/api/health", "/api/auth/me", "/api/auth/login" })
        {
            var response = await client.GetAsync(path);
            Assert.Equal(WebAnalyticsTests.PolicyWithoutBeacon, response.Headers.GetValues("Content-Security-Policy").Single());
            Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
            Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
            Assert.False(response.Headers.Contains("Set-Cookie"), path);
        }
    }

    // The stand-in signs anyone in without Google; nothing but YouTube:Mode=Mock may turn it on.
    [Theory]
    [InlineData("Auto")]
    [InlineData("Api")]
    [InlineData("Public")]
    public async Task Outside_mock_mode_login_goes_to_google_and_signs_no_one_in_by_itself(string youTubeMode)
    {
        await using var app = new SignInApp(youTubeMode, ClientId, ClientSecret);
        using var client = app.CreateSignInClient();

        var login = await client.GetAsync("/api/auth/login");

        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        Assert.StartsWith(GoogleSignInClient.AuthorizationEndpoint + "?", login.Headers.Location!.ToString());
        Assert.DoesNotContain(SetCookies(login), cookie => cookie.StartsWith(GoogleSignInEndpoints.SessionCookieName + "="));
        Assert.False((await Me(client)).GetProperty("signedIn").GetBoolean());
        // And the made-up chat is not served either.
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/chat/abcdefghijk/messages")).StatusCode);
    }

    [Theory]
    [InlineData("Auto")]
    [InlineData("Api")]
    public void Mock_is_the_one_setting_and_nothing_else(string youTubeMode)
    {
        var configured = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["YouTube:Mode"] = youTubeMode,
                ["YouTube:MockVideoIds:0"] = "4xDzrJKXOOY",
                ["Google:ClientId"] = ClientId,
                ["Google:ClientSecret"] = ClientSecret,
            })
            .Build();

        Assert.Equal(GoogleSignInMode.Google, GoogleSignInEndpoints.ResolveMode(configured));
        configured["YouTube:Mode"] = "Mock";
        Assert.Equal(GoogleSignInMode.Mock, GoogleSignInEndpoints.ResolveMode(configured));
        configured["YouTube:Mode"] = youTubeMode;
        configured["Google:ClientSecret"] = "";
        Assert.Equal(GoogleSignInMode.Off, GoogleSignInEndpoints.ResolveMode(configured));
    }

    // --- the way to Google -----------------------------------------------------

    [Fact]
    public async Task Login_sends_the_viewer_to_google_with_pkce_state_offline_access_and_the_four_scopes()
    {
        await using var app = new SignInApp("Auto", ClientId, ClientSecret);
        using var client = app.CreateSignInClient();

        var login = await client.GetAsync("/api/auth/login");
        var query = QueryHelpers.ParseQuery(login.Headers.Location!.Query);

        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        Assert.Equal(ClientId, query["client_id"].ToString());
        Assert.Equal("http://localhost/api/auth/callback", query["redirect_uri"].ToString());
        Assert.Equal("code", query["response_type"].ToString());
        Assert.Equal(
            ["openid", "email", "profile", "https://www.googleapis.com/auth/youtube.force-ssl"],
            query["scope"].ToString().Split(' '));
        Assert.Equal("S256", query["code_challenge_method"].ToString());
        Assert.Equal(43, query["code_challenge"].ToString().Length);
        Assert.True(query["state"].ToString().Length >= 32);
        Assert.Equal("offline", query["access_type"].ToString());
        Assert.Equal("true", query["include_granted_scopes"].ToString());
        Assert.Equal("consent", query["prompt"].ToString());
        Assert.False(query.ContainsKey("client_secret"));
        Assert.DoesNotContain(ClientSecret, login.Headers.Location!.ToString());

        // The state and verifier ride in a short-lived, encrypted, HttpOnly cookie.
        var correlation = Assert.Single(SetCookies(login), cookie => cookie.StartsWith(GoogleSignInEndpoints.CorrelationCookieName + "="));
        Assert.Contains("httponly", correlation, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", correlation, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("max-age=600", correlation, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(query["state"].ToString(), correlation);
    }

    [Fact]
    public async Task Behind_the_ingress_the_callback_is_https_and_the_cookies_are_secure()
    {
        await using var app = new SignInApp("Auto", ClientId, ClientSecret);
        using var client = app.CreateSignInClient();

        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/auth/login");
        request.Headers.Add("X-Forwarded-Proto", "https");
        request.Headers.Host = "taiko.example";
        var login = await client.SendAsync(request);

        var query = QueryHelpers.ParseQuery(login.Headers.Location!.Query);
        Assert.Equal("https://taiko.example/api/auth/callback", query["redirect_uri"].ToString());
        Assert.Contains("secure", Assert.Single(SetCookies(login)), StringComparison.OrdinalIgnoreCase);
    }

    // --- the way back ----------------------------------------------------------

    // Each sign-in is one start and one callback. Sharing one window, the starts used up the
    // callbacks' room: a few viewers on one network got to Google and came back to a 429.
    [Fact]
    public async Task Callbacks_are_not_held_up_by_sign_ins_started_from_the_same_address()
    {
        await using var app = new SignInApp("Auto", ClientId, ClientSecret);
        using var client = app.CreateSignInClient();

        string? state = null;
        for (var i = 0; i < 10; i++)
        {
            var login = await client.GetAsync("/api/auth/login");
            Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
            state = StateOf(login);
        }

        // The starts are spent...
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.GetAsync("/api/auth/login")).StatusCode);
        // ...the callbacks are not: the last sign-in still completes, and a stale callback
        // after it is still told it is stale rather than turned away.
        var callback = await client.GetAsync($"/api/auth/callback?state={state}&code={FakeGoogle.GoodCode}");
        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.True((await Me(client)).GetProperty("signedIn").GetBoolean());
        for (var i = 0; i < 10; i++)
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/auth/callback?state=stale&code=x")).StatusCode);
        }
    }

    [Fact]
    public async Task A_callback_with_another_state_signs_no_one_in()
    {
        await using var app = new SignInApp("Auto", ClientId, ClientSecret);
        using var client = app.CreateSignInClient();
        await client.GetAsync("/api/auth/login");

        var callback = await client.GetAsync("/api/auth/callback?state=not-the-one&code=" + FakeGoogle.GoodCode);

        Assert.Equal(HttpStatusCode.BadRequest, callback.StatusCode);
        Assert.DoesNotContain(SetCookies(callback), cookie => cookie.StartsWith(GoogleSignInEndpoints.SessionCookieName + "="));
        Assert.False((await Me(client)).GetProperty("signedIn").GetBoolean());
        // The code was never spent.
        Assert.DoesNotContain(app.Google.Requests, request => request.Url == GoogleSignInClient.TokenEndpoint);
    }

    [Fact]
    public async Task A_callback_without_the_sign_in_cookie_signs_no_one_in()
    {
        await using var app = new SignInApp("Auto", ClientId, ClientSecret);
        using var starter = app.CreateSignInClient();
        var state = StateOf(await starter.GetAsync("/api/auth/login"));

        // Another browser, handed the address: it has no sign-in of its own under way.
        using var other = app.CreateSignInClient();
        var callback = await other.GetAsync($"/api/auth/callback?state={state}&code={FakeGoogle.GoodCode}");

        Assert.Equal(HttpStatusCode.BadRequest, callback.StatusCode);
        Assert.False((await Me(other)).GetProperty("signedIn").GetBoolean());
    }

    [Fact]
    public async Task A_code_google_turns_down_goes_back_to_the_page_saying_so_and_signs_no_one_in()
    {
        await using var app = new SignInApp("Auto", ClientId, ClientSecret);
        using var client = app.CreateSignInClient();
        var state = StateOf(await client.GetAsync("/api/auth/login"));

        var callback = await client.GetAsync($"/api/auth/callback?state={state}&code=spent-code");

        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Equal("/?signin=failed", callback.Headers.Location!.ToString());
        Assert.DoesNotContain(SetCookies(callback), cookie => cookie.StartsWith(GoogleSignInEndpoints.SessionCookieName + "="));
        Assert.False((await Me(client)).GetProperty("signedIn").GetBoolean());
    }

    [Fact]
    public async Task A_viewer_who_cancels_at_google_goes_back_saying_so()
    {
        await using var app = new SignInApp("Auto", ClientId, ClientSecret);
        using var client = app.CreateSignInClient();
        var state = StateOf(await client.GetAsync("/api/auth/login"));

        var callback = await client.GetAsync($"/api/auth/callback?state={state}&error=access_denied");

        Assert.Equal("/?signin=failed", callback.Headers.Location!.ToString());
        Assert.Empty(app.Google.Requests);
    }

    [Fact]
    public async Task A_good_callback_signs_in_with_an_http_only_lax_cookie_and_no_token_in_any_answer()
    {
        await using var app = new SignInApp("Auto", ClientId, ClientSecret);
        using var client = app.CreateSignInClient();
        var login = await client.GetAsync("/api/auth/login");
        var challenge = QueryHelpers.ParseQuery(login.Headers.Location!.Query)["code_challenge"].ToString();

        var callback = await client.GetAsync($"/api/auth/callback?state={StateOf(login)}&code={FakeGoogle.GoodCode}");

        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Equal("/", callback.Headers.Location!.ToString());
        var session = Assert.Single(SetCookies(callback), cookie => cookie.StartsWith(GoogleSignInEndpoints.SessionCookieName + "="));
        Assert.Contains("httponly", session, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", session, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/api", session, StringComparison.OrdinalIgnoreCase);

        // The exchange proved the verifier behind the challenge, with the secret, to the same redirect URI.
        var exchange = Assert.Single(app.Google.Requests, request => request.Url == GoogleSignInClient.TokenEndpoint);
        Assert.Equal("authorization_code", exchange.Form["grant_type"]);
        Assert.Equal(challenge, WebEncoders.Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(exchange.Form["code_verifier"]))));
        Assert.Equal(ClientSecret, exchange.Form["client_secret"]);
        Assert.Equal("http://localhost/api/auth/callback", exchange.Form["redirect_uri"]);

        var meResponse = await client.GetAsync("/api/auth/me");
        var me = await meResponse.Content.ReadAsStringAsync();
        Assert.Equal(
            """{"enabled":true,"signedIn":true,"name":"홍길동","email":"hong@example.com","picture":"https://lh3.googleusercontent.com/a/fake"}""",
            me);
        Assert.Equal("no-store", meResponse.Headers.CacheControl?.ToString());

        var chat = await client.GetAsync("/api/chat/abcdefghijk/messages");
        foreach (var response in new[] { login, callback, meResponse, chat })
        {
            var everything = response.Headers.ToString() + response.Content.Headers + await response.Content.ReadAsStringAsync();
            foreach (var secret in new[] { FakeGoogle.AccessToken, FakeGoogle.RefreshToken, FakeGoogle.IdTokenMarker, ClientSecret })
            {
                Assert.DoesNotContain(secret, everything);
            }
        }
    }

    [Fact]
    public async Task Logout_ends_the_session()
    {
        await using var app = new SignInApp("Auto", ClientId, ClientSecret);
        using var client = app.CreateSignInClient();
        await SignIn(client);

        var logout = await client.PostAsync("/api/auth/logout", null);

        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        Assert.False((await Me(client)).GetProperty("signedIn").GetBoolean());
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/chat/abcdefghijk/messages")).StatusCode);
    }

    [Fact]
    public void The_page_to_go_back_to_is_on_this_host_or_it_is_the_front_page()
    {
        static string From(string? referer, string host = "localhost:5180")
        {
            var context = new DefaultHttpContext();
            context.Request.Scheme = "http";
            context.Request.Host = new HostString(host);
            if (referer is not null)
            {
                context.Request.Headers.Referer = referer;
            }

            return GoogleSignInEndpoints.ReturnTarget(context.Request);
        }

        Assert.Equal("/?venue=taikolabs", From("http://localhost:5180/?venue=taikolabs"));
        // Locally the page is Vite's, on a port of its own.
        Assert.Equal("http://localhost:5173/?venue=taikolabs", From("http://localhost:5173/?venue=taikolabs"));
        Assert.Equal("/", From("https://evil.example/?venue=taikolabs"));
        Assert.Equal("/", From("http://localhost:5180//evil.example/"));
        Assert.Equal("/", From("javascript:alert(1)"));
        Assert.Equal("/", From(null));

        Assert.Equal("/?venue=taikolabs&signin=failed", GoogleSignInEndpoints.WithSignInFailed("/?venue=taikolabs&signin=failed", failed: true));
        Assert.Equal("/?venue=taikolabs", GoogleSignInEndpoints.WithSignInFailed("/?venue=taikolabs&signin=failed", failed: false));
    }

    // --- reading the chat --------------------------------------------------------

    [Fact]
    public async Task Reading_the_chat_signed_out_is_401()
    {
        await using var app = new SignInApp("Auto", ClientId, ClientSecret);
        using var client = app.CreateSignInClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/chat/abcdefghijk/messages")).StatusCode);
        Assert.Empty(app.Google.Requests);
    }

    [Fact]
    public async Task Signed_in_the_chat_is_read_with_the_viewers_token_and_the_chat_id_is_kept()
    {
        await using var app = new SignInApp("Auto", ClientId, ClientSecret);
        using var client = app.CreateSignInClient();
        await SignIn(client);

        var first = await client.GetFromJsonAsync<JsonElement>("/api/chat/abcdefghijk/messages");
        var second = await client.GetAsync($"/api/chat/abcdefghijk/messages?pageToken={first.GetProperty("nextPageToken").GetString()}");

        Assert.Equal(
            """{"messages":[{"id":"m1","author":"동카","text":"안녕하세요","publishedAt":"2026-10-25T01:02:03+00:00"}],"nextPageToken":"page-2","pollingIntervalMillis":5000}""",
            first.GetRawText());
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.Single(app.Google.Requests, request => request.Url.Contains("/videos?"));
        var reads = app.Google.Requests.Where(request => request.Url.Contains("/liveChat/messages?")).ToList();
        Assert.Equal(2, reads.Count);
        Assert.Contains("liveChatId=chat-1", reads[0].Url);
        Assert.Contains("pageToken=page-2", reads[1].Url);
        Assert.All(app.Google.Requests.Where(request => request.Url.Contains("youtube")), request =>
            Assert.Equal("Bearer " + FakeGoogle.AccessToken, request.Authorization));
    }

    [Fact]
    public async Task A_video_that_is_not_live_is_404_not_live()
    {
        await using var app = new SignInApp("Auto", ClientId, ClientSecret);
        using var client = app.CreateSignInClient();
        await SignIn(client);

        var response = await client.GetAsync($"/api/chat/{FakeGoogle.NotLiveVideo}/messages");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("""{"error":"notLive"}""", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task An_expired_token_is_renewed_the_chat_comes_back_and_the_cookie_carries_the_new_one()
    {
        await using var app = new SignInApp("Auto", ClientId, ClientSecret);
        app.Google.ExpiresInSeconds = 30;
        using var client = app.CreateSignInClient();
        await SignIn(client);
        app.Google.ExpiresInSeconds = 3600;

        var response = await client.GetAsync("/api/chat/abcdefghijk/messages");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Single((await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("messages").EnumerateArray());
        var refresh = Assert.Single(app.Google.Requests, request => request.Form.GetValueOrDefault("grant_type") == "refresh_token");
        Assert.Equal(FakeGoogle.RefreshToken, refresh.Form["refresh_token"]);
        Assert.All(app.Google.Requests.Where(request => request.Url.Contains("youtube")), request =>
            Assert.Equal("Bearer " + FakeGoogle.RenewedAccessToken, request.Authorization));
        Assert.Contains(SetCookies(response), cookie => cookie.StartsWith(GoogleSignInEndpoints.SessionCookieName + "="));

        // The cookie now holds the renewed token: the next read renews nothing.
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/chat/abcdefghijk/messages")).StatusCode);
        Assert.Single(app.Google.Requests, request => request.Form.GetValueOrDefault("grant_type") == "refresh_token");
    }

    [Fact]
    public async Task A_renewal_google_turns_down_is_401_and_ends_the_session()
    {
        await using var app = new SignInApp("Auto", ClientId, ClientSecret);
        app.Google.ExpiresInSeconds = 30;
        app.Google.RefreshSucceeds = false;
        using var client = app.CreateSignInClient();
        await SignIn(client);

        var response = await client.GetAsync("/api/chat/abcdefghijk/messages");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var cleared = Assert.Single(SetCookies(response), cookie => cookie.StartsWith(GoogleSignInEndpoints.SessionCookieName + "="));
        Assert.Contains("expires=Thu, 01 Jan 1970", cleared, StringComparison.OrdinalIgnoreCase);
        Assert.False((await Me(client)).GetProperty("signedIn").GetBoolean());
        Assert.DoesNotContain(app.Google.Requests, request => request.Url.Contains("youtube"));
    }

    [Fact]
    public async Task A_token_youtube_turns_down_before_its_time_is_renewed_once_and_the_read_asked_again()
    {
        await using var app = new SignInApp("Auto", ClientId, ClientSecret);
        using var client = app.CreateSignInClient();
        await SignIn(client);
        app.Google.RevokeFirstAccessToken = true;

        var response = await client.GetAsync("/api/chat/abcdefghijk/messages");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Single(app.Google.Requests, request => request.Form.GetValueOrDefault("grant_type") == "refresh_token");
    }

    // --- Mock mode ---------------------------------------------------------------

    [Fact]
    public async Task In_mock_mode_login_signs_in_a_test_user_without_google_and_the_chat_is_made_up()
    {
        // An OAuth client configured beside it changes nothing: Mock never reaches Google.
        await using var app = new SignInApp("Mock", ClientId, ClientSecret);
        using var client = app.CreateSignInClient();

        Assert.Equal("""{"enabled":true,"signedIn":false}""", await (await client.GetAsync("/api/auth/me")).Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/chat/mock-taikolabs-a1/messages")).StatusCode);

        var login = await client.GetAsync("/api/auth/login");
        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        Assert.Equal("/", login.Headers.Location!.ToString());

        var me = await Me(client);
        Assert.True(me.GetProperty("signedIn").GetBoolean());
        Assert.Equal("테스트 사용자", me.GetProperty("name").GetString());

        var first = await client.GetFromJsonAsync<JsonElement>("/api/chat/mock-taikolabs-a1/messages");
        Assert.Equal(3, first.GetProperty("messages").GetArrayLength());
        Assert.Equal(5000, first.GetProperty("pollingIntervalMillis").GetInt32());
        var next = await client.GetFromJsonAsync<JsonElement>(
            $"/api/chat/mock-taikolabs-a1/messages?pageToken={first.GetProperty("nextPageToken").GetString()}");
        Assert.Equal("새 메시지 1", Assert.Single(next.GetProperty("messages").EnumerateArray()).GetProperty("text").GetString());

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/auth/callback?state=x&code=y")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/auth/logout", null)).StatusCode);
        Assert.False((await Me(client)).GetProperty("signedIn").GetBoolean());
        Assert.Empty(app.Google.Requests);
    }

    // --- helpers -----------------------------------------------------------------

    private static async Task SignIn(HttpClient client)
    {
        var state = StateOf(await client.GetAsync("/api/auth/login"));
        var callback = await client.GetAsync($"/api/auth/callback?state={state}&code={FakeGoogle.GoodCode}");
        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Equal("/", callback.Headers.Location!.ToString());
    }

    private static string StateOf(HttpResponseMessage login) =>
        Uri.EscapeDataString(QueryHelpers.ParseQuery(login.Headers.Location!.Query)["state"].ToString());

    private static async Task<JsonElement> Me(HttpClient client) =>
        await client.GetFromJsonAsync<JsonElement>("/api/auth/me");

    private static IEnumerable<string> SetCookies(HttpResponseMessage response) =>
        response.Headers.TryGetValues("Set-Cookie", out var values) ? values : [];

    /// <summary>Google's token endpoint and the two YouTube Data API reads, as far as the sign-in uses them.</summary>
    internal sealed class FakeGoogle : HttpMessageHandler
    {
        public const string GoodCode = "good-code";
        public const string AccessToken = "ya29.fake-access-token-1";
        public const string RenewedAccessToken = "ya29.fake-access-token-2";
        public const string RefreshToken = "1//fake-refresh-token";
        public const string IdTokenMarker = "fake-id-token-signature";
        public const string NotLiveVideo = "notlive0001";

        public sealed record Request(string Url, string? Authorization, IReadOnlyDictionary<string, string> Form);

        private readonly ConcurrentQueue<Request> _requests = new();

        public IReadOnlyList<Request> Requests => [.. _requests];

        public int ExpiresInSeconds { get; set; } = 3600;

        public bool RefreshSucceeds { get; set; } = true;

        public bool RevokeFirstAccessToken { get; set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var url = request.RequestUri!.ToString();
            var form = request.Content is null
                ? new Dictionary<string, string>()
                : QueryHelpers.ParseQuery(await request.Content.ReadAsStringAsync(cancellationToken))
                    .ToDictionary(pair => pair.Key, pair => pair.Value.ToString());
            var authorization = request.Headers.Authorization?.ToString();
            _requests.Enqueue(new Request(url, authorization, form));

            if (url == GoogleSignInClient.TokenEndpoint)
            {
                return Token(form);
            }

            var valid = RevokeFirstAccessToken ? "Bearer " + RenewedAccessToken : null;
            if (authorization is null
                || (valid is not null && authorization != valid)
                || authorization is not ("Bearer " + AccessToken or "Bearer " + RenewedAccessToken))
            {
                return Json(HttpStatusCode.Unauthorized, """{"error":{"code":401,"errors":[{"reason":"authError"}]}}""");
            }

            if (url.StartsWith("https://www.googleapis.com/youtube/v3/videos?", StringComparison.Ordinal))
            {
                return url.Contains($"id={NotLiveVideo}")
                    ? Json(HttpStatusCode.OK, """{"items":[{"id":"notlive0001"}]}""")
                    : Json(HttpStatusCode.OK, """{"items":[{"id":"abcdefghijk","liveStreamingDetails":{"activeLiveChatId":"chat-1"}}]}""");
            }

            if (url.StartsWith("https://www.googleapis.com/youtube/v3/liveChat/messages?", StringComparison.Ordinal))
            {
                return Json(HttpStatusCode.OK, """
                    {"nextPageToken":"page-2","pollingIntervalMillis":5000,"items":[
                      {"id":"m1","snippet":{"displayMessage":"안녕하세요","publishedAt":"2026-10-25T01:02:03Z"},"authorDetails":{"displayName":"동카"}},
                      {"id":"m2","snippet":{"type":"newSponsorEvent"},"authorDetails":{"displayName":"멤버"}}
                    ]}
                    """);
            }

            return new HttpResponseMessage(HttpStatusCode.NotFound);
        }

        private HttpResponseMessage Token(Dictionary<string, string> form)
        {
            switch (form.GetValueOrDefault("grant_type"))
            {
                case "authorization_code" when form.GetValueOrDefault("code") == GoodCode:
                    return Json(HttpStatusCode.OK, JsonSerializer.Serialize(new Dictionary<string, object>
                    {
                        ["access_token"] = AccessToken,
                        ["refresh_token"] = RefreshToken,
                        ["expires_in"] = ExpiresInSeconds,
                        ["id_token"] = IdToken(),
                        ["token_type"] = "Bearer",
                    }));
                case "refresh_token" when RefreshSucceeds && form.GetValueOrDefault("refresh_token") == RefreshToken:
                    return Json(HttpStatusCode.OK, JsonSerializer.Serialize(new Dictionary<string, object>
                    {
                        ["access_token"] = RenewedAccessToken,
                        ["expires_in"] = ExpiresInSeconds,
                        ["token_type"] = "Bearer",
                    }));
                default:
                    return Json(HttpStatusCode.BadRequest, """{"error":"invalid_grant"}""");
            }
        }

        private static string IdToken()
        {
            static string Part(object value) => WebEncoders.Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(value));
            return Part(new { alg = "RS256", typ = "JWT" }) + "." +
                   Part(new
                   {
                       iss = "https://accounts.google.com",
                       aud = ClientId,
                       sub = "1234567890",
                       name = "홍길동",
                       email = "hong@example.com",
                       picture = "https://lh3.googleusercontent.com/a/fake",
                   }) + "." +
                   WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(IdTokenMarker));
        }

        private static HttpResponseMessage Json(HttpStatusCode status, string body) =>
            new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    }

    private sealed class SignInApp(string youTubeMode, string? clientId, string? clientSecret) : WebApplicationFactory<Program>
    {
        private readonly string _scratch = Path.Combine(Path.GetTempPath(), $"taiko-signin-test-{Guid.NewGuid():N}");

        public FakeGoogle Google { get; } = new();

        public HttpClient CreateSignInClient() =>
            CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = true });

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Production");
            builder.UseSetting("YouTube:Mode", youTubeMode);
            builder.UseSetting("YouTube:ApiKey", "");
            builder.UseSetting("Google:ClientId", clientId ?? "");
            builder.UseSetting("Google:ClientSecret", clientSecret ?? "");
            builder.UseSetting("Venues:ClosureCachePath", Path.Combine(_scratch, "closures.json"));
            builder.UseSetting("Venues:LiveCachePath", Path.Combine(_scratch, "live.json"));
            builder.ConfigureTestServices(services =>
            {
                // No polling of YouTube or the closure feed while testing the sign-in.
                services.RemoveAll<IHostedService>();
                services.AddHttpClient<GoogleSignInClient>().ConfigurePrimaryHttpMessageHandler(() => Google);
            });
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            try
            {
                Directory.Delete(_scratch, recursive: true);
            }
            catch (IOException)
            {
                // A temp directory left behind is harmless.
            }
        }
    }
}
