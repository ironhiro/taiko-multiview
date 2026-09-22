using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TaikoLabs.Desktop;

public enum FrontendMode
{
    /// <summary>Use the Vite dev server when it is running, otherwise the built output.</summary>
    Auto,

    /// <summary>Always load the Vite dev server.</summary>
    DevServer,

    /// <summary>Always load frontend/dist through a virtual host mapping.</summary>
    Built,
}

public sealed class DesktopSettings
{
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public FrontendMode FrontendMode { get; set; } = FrontendMode.Auto;

    public string DevServerUrl { get; set; } = "http://localhost:5173";

    /// <summary>Looked up by walking up from the executable until the folder is found.</summary>
    public string BuiltFrontendPath { get; set; } = "frontend/dist";

    public string ApiBaseUrl { get; set; } = "http://localhost:5180";

    /// <summary>
    /// Hostname the built output is served under. Served over http (not https) on purpose:
    /// an https page may not call the http backend, and Chromium blocks that as mixed content.
    /// </summary>
    public string VirtualHost { get; set; } = "taiko.multiview";

    /// <summary>
    /// Lets every tile start playing without a click. Browsers forbid this, which is
    /// precisely why the desktop shell is the more convenient way to watch a full wall.
    /// </summary>
    public bool AllowAutoplayWithSound { get; set; } = true;

    public static DesktopSettings Load()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "appsettings.json");

        if (!File.Exists(path))
        {
            return new DesktopSettings();
        }

        try
        {
            // Read as text rather than handing JsonDocument the raw stream: Notepad and
            // PowerShell both write this file with a UTF-8 BOM, which the stream overload
            // rejects outright. File.ReadAllText detects and strips it.
            using var document = JsonDocument.Parse(File.ReadAllText(path));

            if (!document.RootElement.TryGetProperty("Desktop", out var section))
            {
                return new DesktopSettings();
            }

            return section.Deserialize<DesktopSettings>(new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            }) ?? new DesktopSettings();
        }
        catch (JsonException)
        {
            return new DesktopSettings();
        }
    }

    /// <summary>
    /// Resolves <see cref="BuiltFrontendPath"/> by walking up from the executable, so the
    /// shell works both from bin/Debug during development and from a published folder.
    /// </summary>
    public string? ResolveBuiltFrontendDirectory()
    {
        var relative = BuiltFrontendPath.Replace('/', Path.DirectorySeparatorChar);

        if (Path.IsPathRooted(relative))
        {
            return Directory.Exists(relative) ? relative : null;
        }

        var trimmed = relative.TrimStart('.', Path.DirectorySeparatorChar);
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, trimmed);
            if (Directory.Exists(candidate) && File.Exists(Path.Combine(candidate, "index.html")))
            {
                return candidate;
            }

            directory = directory.Parent;
        }

        return null;
    }
}
