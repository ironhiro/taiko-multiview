using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace TaikoLabs.Api.Tests;

/// <summary>
/// The Cloudflare Web Analytics beacon is switched on per environment, by setting, on an
/// image that is otherwise the same everywhere. Off, nothing about the page may change;
/// on, every way of asking for the page must carry it exactly once, compressed twins
/// included, and the CSP must let it run.
/// </summary>
public class WebAnalyticsTests
{
    private const string Token = "0123456789abcdef0123456789abcdef";
    private const string BeaconScript = "static.cloudflareinsights.com/beacon.min.js";

    // The policy as it stood before the beacon existed: with no token it must not move.
    internal const string PolicyWithoutBeacon =
        "script-src 'self' https://www.youtube.com https://s.ytimg.com; " +
        "frame-src https://www.youtube.com https://www.youtube-nocookie.com; " +
        "img-src 'self' data: https:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "font-src 'self' data:; " +
        "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

    // A page shaped like the build's, padded past the precompress threshold so it has twins
    // the way a larger index.html would.
    private static readonly string Page =
        "<!doctype html>\n<html lang=\"ko\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <title>태고 멀티뷰</title>\n" +
        $"    <!-- {new string('x', 2048)} -->\n" +
        "    <script type=\"module\" crossorigin src=\"/assets/index-Test.js\"></script>\n  </head>\n" +
        "  <body>\n    <div id=\"root\"></div>\n  </body>\n</html>\n";

    public static TheoryData<string, string?> PageRequests => new()
    {
        { "/", null },
        { "/", "gzip, deflate, br, zstd" },
        { "/", "gzip" },
        { "/index.html", null },
        { "/index.html", "gzip, deflate, br, zstd" },
        { "/index.html", "gzip" },
        { "/somewhere", null },
        { "/somewhere", "gzip, deflate, br, zstd" },
        { "/venue/taikolabs", "gzip" },
    };

    [Theory]
    [MemberData(nameof(PageRequests))]
    public async Task Without_a_token_the_page_and_its_policy_are_as_built(string path, string? acceptEncoding)
    {
        await using var app = new FrontendApp(token: null);
        using var client = app.CreateClient();

        var response = await Get(client, path, acceptEncoding);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(PolicyWithoutBeacon, response.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Equal("no-cache", response.Headers.CacheControl?.ToString());

        var body = await ReadBody(response);
        Assert.Equal(Page, body);
        Assert.DoesNotContain("cloudflareinsights", body);
    }

    [Theory]
    [MemberData(nameof(PageRequests))]
    public async Task With_a_token_every_way_to_the_page_carries_the_beacon_once(string path, string? acceptEncoding)
    {
        await using var app = new FrontendApp(Token);
        using var client = app.CreateClient();

        var response = await Get(client, path, acceptEncoding);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/html; charset=utf-8", response.Content.Headers.ContentType?.ToString());
        Assert.Equal("no-cache", response.Headers.CacheControl?.ToString());
        // The twin on disk is the page without the beacon; it must not be what was sent.
        Assert.Empty(response.Content.Headers.ContentEncoding);

        var body = await ReadBody(response);
        Assert.Single(Regex.Matches(body, Regex.Escape(BeaconScript)));
        Assert.Contains(
            $$"""<script defer src="https://{{BeaconScript}}" data-cf-beacon='{"token":"{{Token}}"}'></script></body>""",
            body);
        // Everything else in the page is left as it was.
        Assert.Equal(Page, Regex.Replace(body, "<script defer src=\"https://static[^>]+></script>", ""));
    }

    // Asserted on the response itself rather than only its body: the static file middleware
    // always adds Last-Modified, the in-memory copy never does, and every route to the page
    // must come back with the one copy's ETag whatever encoding was offered.
    [Fact]
    public async Task With_a_token_every_way_to_the_page_is_the_one_beaconed_copy_never_the_file()
    {
        await using var app = new FrontendApp(Token);
        using var client = app.CreateClient();

        var etags = new HashSet<string>();
        foreach (var (path, acceptEncoding) in PageRequests.Select(row => ((string)row[0], (string?)row[1])))
        {
            var response = await Get(client, path, acceptEncoding);
            Assert.Null(response.Content.Headers.LastModified);
            Assert.False(response.Headers.AcceptRanges.Any(), $"{path} [{acceptEncoding}] came from the static file middleware");
            etags.Add(Assert.IsType<System.Net.Http.Headers.EntityTagHeaderValue>(response.Headers.ETag).Tag);
        }

        Assert.Single(etags);
    }

    // The beacon must not change what a page path says to anything but a read.
    [Theory]
    [InlineData("POST", "/")]
    [InlineData("POST", "/index.html")]
    [InlineData("POST", "/somewhere")]
    [InlineData("PUT", "/")]
    [InlineData("PUT", "/somewhere")]
    [InlineData("DELETE", "/somewhere")]
    public async Task With_a_token_a_page_path_answers_other_methods_as_it_did_without(string method, string path)
    {
        await using var without = new FrontendApp(token: null);
        await using var with = new FrontendApp(Token);
        using var withoutClient = without.CreateClient();
        using var withClient = with.CreateClient();

        var expected = (await withoutClient.SendAsync(new HttpRequestMessage(new HttpMethod(method), path))).StatusCode;
        var actual = (await withClient.SendAsync(new HttpRequestMessage(new HttpMethod(method), path))).StatusCode;

        // As MapFallbackToFile answers them: the path exists, but only for GET and HEAD.
        Assert.Equal(HttpStatusCode.MethodNotAllowed, expected);
        Assert.Equal(expected, actual);
    }

    [Fact]
    public async Task With_a_token_a_post_to_a_client_side_route_is_still_not_allowed()
    {
        await using var app = new FrontendApp(Token);
        using var client = app.CreateClient();

        var response = await client.PostAsync("/somewhere", content: null);

        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
        Assert.DoesNotContain("cloudflareinsights", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task With_a_token_script_src_takes_the_beacon_and_nothing_else_moves()
    {
        await using var app = new FrontendApp(Token);
        using var client = app.CreateClient();

        var expected = PolicyWithoutBeacon.Replace(
            "script-src 'self' ",
            "script-src 'self' https://static.cloudflareinsights.com ");

        foreach (var path in new[] { "/", "/assets/index-Test.js", "/api/health" })
        {
            var response = await Get(client, path, acceptEncoding: null);
            Assert.Equal(expected, response.Headers.GetValues("Content-Security-Policy").Single());
        }
    }

    [Fact]
    public async Task With_a_token_assets_are_still_served_compressed_and_unknown_files_are_still_missing()
    {
        await using var app = new FrontendApp(Token);
        using var client = app.CreateClient();

        var asset = await Get(client, "/assets/index-Test.js", "br");
        Assert.Equal(HttpStatusCode.OK, asset.StatusCode);
        Assert.Equal("br", asset.Content.Headers.ContentEncoding.Single());

        // A path naming a file is not a client-side route, as with MapFallbackToFile.
        Assert.Equal(HttpStatusCode.NotFound, (await Get(client, "/missing.js", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Get(client, "/api/nothing-here", null)).StatusCode);
    }

    [Fact]
    public async Task With_a_token_a_revisit_is_answered_not_modified()
    {
        await using var app = new FrontendApp(Token);
        using var client = app.CreateClient();

        var first = await Get(client, "/", null);
        var etag = first.Headers.ETag;
        Assert.NotNull(etag);

        using var revisit = new HttpRequestMessage(HttpMethod.Get, "/somewhere");
        revisit.Headers.IfNoneMatch.Add(etag);
        Assert.Equal(HttpStatusCode.NotModified, (await client.SendAsync(revisit)).StatusCode);
    }

    [Theory]
    [InlineData("abc\"}'><script>alert(1)</script>")]
    [InlineData("not a token")]
    [InlineData("short")]
    public async Task A_token_that_is_not_one_leaves_the_beacon_off_and_says_so(string token)
    {
        await using var app = new FrontendApp(token);
        using var client = app.CreateClient();

        var response = await Get(client, "/", "gzip");

        Assert.Equal(PolicyWithoutBeacon, response.Headers.GetValues("Content-Security-Policy").Single());
        var body = await ReadBody(response);
        Assert.Equal(Page, body);
        Assert.Contains(app.Logs.All, entry =>
            entry.Level == LogLevel.Warning && entry.Text.Contains("CloudflareBeaconToken") && !entry.Text.Contains(token));
    }

    private static async Task<HttpResponseMessage> Get(HttpClient client, string path, string? acceptEncoding)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (acceptEncoding is not null)
        {
            request.Headers.TryAddWithoutValidation("Accept-Encoding", acceptEncoding);
        }

        return await client.SendAsync(request);
    }

    // The test client does not decompress, so a twin would arrive as its raw bytes.
    private static async Task<string> ReadBody(HttpResponseMessage response)
    {
        var bytes = await response.Content.ReadAsByteArrayAsync();
        Stream stream = new MemoryStream(bytes);
        switch (response.Content.Headers.ContentEncoding.SingleOrDefault())
        {
            case "br":
                stream = new BrotliStream(stream, CompressionMode.Decompress);
                break;
            case "gzip":
                stream = new GZipStream(stream, CompressionMode.Decompress);
                break;
        }

        using var reader = new StreamReader(stream, Encoding.UTF8);
        return await reader.ReadToEndAsync();
    }

    /// <summary>The API with a frontend build in its web root, as in the container image.</summary>
    private sealed class FrontendApp(string? token) : WebApplicationFactory<Program>
    {
        private readonly string _scratch = Path.Combine(Path.GetTempPath(), $"taiko-analytics-test-{Guid.NewGuid():N}");

        public ClientDiagnosticsTests.CapturedLogs Logs { get; } = new();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            var webRoot = Path.Combine(_scratch, "wwwroot");
            WriteBuild(webRoot);

            builder.UseEnvironment("Production");
            builder.UseWebRoot(webRoot);
            builder.UseSetting("YouTube:Mode", "Mock");
            builder.UseSetting("YouTube:ApiKey", "");
            builder.UseSetting("Venues:ClosureCachePath", Path.Combine(_scratch, "closures.json"));
            builder.UseSetting("Venues:LiveCachePath", Path.Combine(_scratch, "live.json"));
            builder.UseSetting("Analytics:CloudflareBeaconToken", token ?? "");
            builder.ConfigureLogging(logging => logging.AddProvider(Logs));
            // No polling of YouTube or the closure feed while testing how the page is served.
            builder.ConfigureTestServices(services => services.RemoveAll<IHostedService>());
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

        // What frontend/scripts/precompress.mjs leaves: each file with a .br and .gz twin.
        private static void WriteBuild(string webRoot)
        {
            Directory.CreateDirectory(Path.Combine(webRoot, "assets"));
            WriteWithTwins(Path.Combine(webRoot, "index.html"), Page);
            WriteWithTwins(Path.Combine(webRoot, "assets", "index-Test.js"), $"console.log('{new string('y', 2048)}')");
        }

        private static void WriteWithTwins(string path, string text)
        {
            var bytes = Encoding.UTF8.GetBytes(text);
            File.WriteAllBytes(path, bytes);

            using (var br = new BrotliStream(File.Create(path + ".br"), CompressionLevel.Optimal))
            {
                br.Write(bytes);
            }

            using (var gz = new GZipStream(File.Create(path + ".gz"), CompressionLevel.Optimal))
            {
                gz.Write(bytes);
            }
        }
    }
}
