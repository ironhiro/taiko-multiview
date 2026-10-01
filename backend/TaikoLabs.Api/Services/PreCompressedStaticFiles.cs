using System.Diagnostics.CodeAnalysis;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Microsoft.Net.Http.Headers;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Serves the .br/.gz twins that the frontend build writes beside each asset
/// (frontend/scripts/precompress.mjs), in place of the plain file, to any client that
/// says it takes them.
///
/// The compressing happens in the build rather than here on purpose. Every asset is named
/// after its content and served as immutable, and the container this runs in has a quarter
/// of a vCPU: a runtime compressor would spend that CPU producing the same bytes again for
/// every visitor who arrives without a warm cache, on the request path, in front of the
/// first paint it exists to speed up. Choosing between files already on disk costs a file
/// lookup instead. It also keeps the scope honest - only what the build wrote can be served
/// this way, so an API response is never compressed by accident.
/// </summary>
public static class PreCompressedStaticFiles
{
    /// <summary>
    /// Brotli first: it is the smaller of the two, and a client that offers it offers gzip
    /// as well, so the order is a preference rather than a requirement.
    /// </summary>
    private static readonly (string Suffix, string Encoding)[] Twins =
    [
        (".br", "br"),
        (".gz", "gzip"),
    ];

    /// <summary>
    /// Reports a twin as the type of the file inside it: a browser that asked for
    /// index-abc123.css must be told text/css even though the bytes came from
    /// index-abc123.css.br. Without this the static file middleware would not recognise
    /// ".br" at all and would refuse to serve it.
    /// </summary>
    public static IContentTypeProvider ContentTypeProvider { get; } = new TwinContentTypeProvider();

    /// <summary>
    /// Rewrites a request to its compressed twin where one exists and the client takes it.
    /// Must run after UseDefaultFiles, so that "/" has already become "/index.html", and
    /// before UseStaticFiles, which is what actually sends the file.
    /// </summary>
    public static IApplicationBuilder UsePreCompressedAssets(this IApplicationBuilder app)
    {
        var files = app.ApplicationServices.GetRequiredService<IWebHostEnvironment>().WebRootFileProvider;

        return app.Use((context, next) =>
        {
            Negotiate(context, files);
            return next(context);
        });
    }

    private static void Negotiate(HttpContext context, IFileProvider files)
    {
        var request = context.Request;

        // Only a read of a named file can have a twin; anything else falls through
        // untouched, which is also what keeps /api requests out of here.
        if (!HttpMethods.IsGet(request.Method) && !HttpMethods.IsHead(request.Method))
        {
            return;
        }

        if (request.Path.Value is not { Length: > 1 } path || path.EndsWith('/'))
        {
            return;
        }

        // A list header: joining the values back with ", " is how the grammar reads them.
        var acceptEncoding = request.Headers.AcceptEncoding.ToString();

        var negotiable = false;
        foreach (var (suffix, encoding) in Twins)
        {
            if (!files.GetFileInfo(path + suffix).Exists)
            {
                continue;
            }

            // Even when this client ends up with the plain file, the response for this URL
            // now depends on what the request said it accepts.
            negotiable = true;

            if (!Accepts(acceptEncoding, encoding))
            {
                continue;
            }

            context.Response.Headers.ContentEncoding = encoding;
            request.Path = path + suffix;
            break;
        }

        if (negotiable)
        {
            context.Response.Headers.Vary = HeaderNames.AcceptEncoding;
        }
    }

    /// <summary>
    /// Whether the client takes <paramref name="encoding"/>. A named encoding settles the
    /// question either way - "br;q=0" is a refusal, not an offer - and "*" answers for the
    /// encodings the client did not name. A client that sends no Accept-Encoding at all
    /// takes nothing, which is what keeps the plain file the safe default.
    /// </summary>
    internal static bool Accepts(string? acceptEncoding, string encoding)
    {
        if (string.IsNullOrWhiteSpace(acceptEncoding)
            || !StringWithQualityHeaderValue.TryParseList([acceptEncoding], out var accepted))
        {
            return false;
        }

        var wildcard = false;
        foreach (var candidate in accepted)
        {
            // An absent quality means fully acceptable; the header grammar has no default.
            var wanted = (candidate.Quality ?? 1.0) > 0;

            if (candidate.Value.Equals(encoding, StringComparison.OrdinalIgnoreCase))
            {
                return wanted;
            }

            if (candidate.Value.Equals("*", StringComparison.Ordinal))
            {
                wildcard = wanted;
            }
        }

        return wildcard;
    }

    private sealed class TwinContentTypeProvider : IContentTypeProvider
    {
        private readonly FileExtensionContentTypeProvider _inner = new();

        public bool TryGetContentType(string subpath, [MaybeNullWhen(false)] out string contentType)
        {
            foreach (var (suffix, _) in Twins)
            {
                if (subpath.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
                {
                    return _inner.TryGetContentType(subpath[..^suffix.Length], out contentType);
                }
            }

            return _inner.TryGetContentType(subpath, out contentType);
        }
    }
}
