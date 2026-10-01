using TaikoLabs.Api.Services;

namespace TaikoLabs.Api.Tests;

/// <summary>
/// The two decisions that stand between a visitor and the right bytes: whether the client
/// takes a compressed twin, and what type the twin's contents are.
/// </summary>
public class PreCompressedStaticFilesTests
{
    [Theory]
    // What every current browser sends.
    [InlineData("gzip, deflate, br, zstd", "br", true)]
    [InlineData("gzip, deflate, br, zstd", "gzip", true)]
    // An old client that never learnt brotli must still be offered gzip.
    [InlineData("gzip, deflate", "br", false)]
    [InlineData("gzip, deflate", "gzip", true)]
    // No header at all is not an invitation: the plain file is the answer.
    [InlineData("", "gzip", false)]
    [InlineData(null, "gzip", false)]
    // q=0 is a refusal, and it outranks a wildcard that would otherwise have said yes.
    [InlineData("br;q=0, gzip", "br", false)]
    [InlineData("br;q=0, *", "br", false)]
    [InlineData("*", "br", true)]
    [InlineData("*;q=0", "br", false)]
    // An explicit quality above zero is an offer, however faint.
    [InlineData("br;q=0.1", "br", true)]
    [InlineData("identity", "gzip", false)]
    public void An_encoding_is_served_only_when_the_client_said_it_takes_it(string? header, string encoding, bool expected) =>
        Assert.Equal(expected, PreCompressedStaticFiles.Accepts(header, encoding));

    [Theory]
    [InlineData("assets/index-BgsAQ2OV.css.br", "text/css")]
    [InlineData("assets/index-BgsAQ2OV.css.gz", "text/css")]
    [InlineData("assets/index-Cdie-g9c.js.br", "text/javascript")]
    [InlineData("index.html.br", "text/html")]
    // A file that is not a twin keeps its own type.
    [InlineData("assets/index-BgsAQ2OV.css", "text/css")]
    public void A_twin_is_reported_as_the_type_of_the_file_inside_it(string path, string expected)
    {
        Assert.True(PreCompressedStaticFiles.ContentTypeProvider.TryGetContentType(path, out var contentType));
        Assert.Equal(expected, contentType);
    }
}
