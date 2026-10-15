using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.FileProviders;
using Microsoft.Net.Http.Headers;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Settings for the Cloudflare Web Analytics beacon. The production domain is not proxied
/// through Cloudflare (README: DNS only), so Cloudflare sees none of its traffic, and the
/// Azure request metrics carry no country; the beacon is what tells where visitors come from.
///
/// The token is read at run time rather than baked into the frontend build because one
/// image goes to the development server first and then, unchanged, to production: each
/// environment has its own Web Analytics site and so its own token. Off unless
/// <see cref="CloudflareBeaconToken"/> is set; unset, the page and its CSP are exactly what
/// they were without this.
/// </summary>
public sealed class WebAnalyticsOptions
{
    public const string SectionName = "Analytics";

    /// <summary>The site token from the Cloudflare dashboard (Web Analytics → the site → Manage site → JS snippet).</summary>
    public string? CloudflareBeaconToken { get; set; }
}

/// <summary>
/// Puts the beacon script into the index.html the server hands out. The page is read once
/// at start-up, given the script, and kept in memory: it is a few hundred bytes, the image
/// never changes under a running server, and every way of asking for it - "/", "/index.html"
/// and any client-side route - is answered from the same copy, so none can slip past with
/// the file as it is on disk (its .br/.gz twin included).
/// </summary>
public sealed partial class WebAnalyticsBeacon
{
    /// <summary>Where the beacon script lives; the CSP has to allow it in script-src.</summary>
    public const string ScriptOrigin = "https://static.cloudflareinsights.com";

    private const string ScriptUrl = ScriptOrigin + "/beacon.min.js";

    private readonly byte[] _page;
    private readonly EntityTagHeaderValue _etag;

    private WebAnalyticsBeacon(byte[] page)
    {
        _page = page;
        // A strong validator over the bytes actually sent, so a revisit still gets a 304
        // as it did when the static file middleware served the page.
        _etag = new EntityTagHeaderValue($"\"{Convert.ToHexStringLower(SHA256.HashData(page))[..16]}\"");
    }

    /// <summary>
    /// The beacon for this configuration, or null when there is none to serve: no token
    /// set (the usual case, said nothing about), a token that is not one (said with a
    /// warning, and the page goes out as built), or no built page to put it in.
    /// </summary>
    public static WebAnalyticsBeacon? Create(string? token, IFileProvider webRoot, ILogger logger)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return null;
        }

        token = token.Trim();

        // The token ends up inside a single-quoted HTML attribute holding JSON. Cloudflare's
        // are 32 hex digits; anything outside this shape is a paste gone wrong, and is
        // refused rather than escaped, since an escaped wrong token would still count nothing.
        // The value itself is not logged: it may be whatever was pasted by mistake.
        if (!TokenShape().IsMatch(token))
        {
            logger.LogWarning(
                "Analytics:CloudflareBeaconToken is set but is not a beacon token ({Length} characters, expected letters, digits, '-' and '_'); the beacon is off",
                token.Length);
            return null;
        }

        var index = webRoot.GetFileInfo("index.html");
        if (!index.Exists)
        {
            // Run from source, the Vite dev server serves the page and this server has none.
            return null;
        }

        string html;
        using (var stream = index.CreateReadStream())
        using (var reader = new StreamReader(stream, Encoding.UTF8))
        {
            html = reader.ReadToEnd();
        }

        var tag = $$"""<script defer src="{{ScriptUrl}}" data-cf-beacon='{"token":"{{token}}"}'></script>""";
        var bodyEnd = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        if (bodyEnd < 0)
        {
            logger.LogWarning("index.html has no </body>; the beacon script is added at the end of the page");
            html += tag;
        }
        else
        {
            html = string.Concat(html.AsSpan(0, bodyEnd), tag, html.AsSpan(bodyEnd));
        }

        return new WebAnalyticsBeacon(Encoding.UTF8.GetBytes(html));
    }

    /// <summary>
    /// Answers a request for the page with the copy that carries the beacon. Uncompressed:
    /// the page is under a kilobyte, so there is nothing for a twin to win, and a response
    /// that never varies by Accept-Encoding cannot be confused with one that does.
    /// </summary>
    public async Task WriteAsync(HttpContext context)
    {
        var response = context.Response;
        response.ContentType = "text/html; charset=utf-8";
        response.Headers.CacheControl = "no-cache";
        response.Headers.ETag = _etag.ToString();

        // If-None-Match compares weakly (RFC 9110 13.1.2), and "*" matches any current page.
        var ifNoneMatch = context.Request.GetTypedHeaders().IfNoneMatch;
        if (ifNoneMatch.Any(tag => tag.Equals(EntityTagHeaderValue.Any) || tag.Compare(_etag, useStrongComparison: false)))
        {
            response.StatusCode = StatusCodes.Status304NotModified;
            return;
        }

        response.ContentLength = _page.Length;
        if (!HttpMethods.IsHead(context.Request.Method))
        {
            await response.Body.WriteAsync(_page, context.RequestAborted);
        }
    }

    /// <summary>
    /// Serves "/index.html" from the beaconed copy. Runs ahead of the twin negotiation and
    /// the static files, which would otherwise hand out the file as built. "/" needs no such
    /// help: like any client-side route it has already been routed to the fallback endpoint,
    /// which is <see cref="WriteAsync"/>.
    /// </summary>
    public Task ServeIndexFileOr(HttpContext context, Func<Task> next)
    {
        var request = context.Request;
        var isRead = HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method);

        return isRead && string.Equals(request.Path.Value, "/index.html", StringComparison.OrdinalIgnoreCase)
            ? WriteAsync(context)
            : next();
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{16,128}$")]
    private static partial Regex TokenShape();
}
