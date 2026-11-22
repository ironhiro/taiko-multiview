using Microsoft.Extensions.Primitives;
using TaikoLabs.Api.Models;

namespace TaikoLabs.Api.Services;

/// <summary>
/// Where the venue list comes from, and word of when it changes. <see cref="VenueRegistry"/>
/// validates and builds whatever this hands it; the source only has to say what is written.
///
/// <see cref="Load"/> is synchronous on purpose: the registry builds its first list while the
/// app starts, before the first poll, and a source that has to fetch over the network (a blob,
/// a database) should do that in the background, keep the last list it read, and announce each
/// new one through <see cref="OnChange"/> - rather than make startup wait on it.
/// </summary>
public interface IVenueSource
{
    /// <summary>The venue definitions as the source holds them now, unvalidated.</summary>
    IReadOnlyList<VenueDefinition> Load();

    /// <summary>
    /// Calls <paramref name="listener"/> whenever <see cref="Load"/> may return something new.
    /// A source may call it for a change that turns out to be nothing; the registry rebuilds
    /// anyway. Disposing the result stops the calls.
    /// </summary>
    IDisposable OnChange(Action listener);
}

/// <summary>
/// The venue list from a JSON file of its own (venues.json, or whatever <c>Venues:File</c>
/// names), apart from the app's settings: it is data that changes as venues come and go,
/// edited with the venue editor and reviewed in git, while appsettings.json holds how the
/// app runs.
///
/// The file is read through the app's configuration rather than on its own, so it keeps its
/// <c>{"Venues":{"Items":[...]}}</c> shape and the list keeps its <c>Venues:Items</c> key -
/// which also means anything else that sets <c>Venues:Items</c> still does, as it always has.
/// </summary>
public sealed class FileVenueSource(IConfiguration configuration) : IVenueSource
{
    /// <summary>Names a different venue file, such as the generated mock venues for local load tests.</summary>
    public const string FileKey = "Venues:File";

    public const string DefaultFile = "venues.json";

    public const string ItemsKey = "Venues:Items";

    /// <summary>
    /// Adds the venue file to <paramref name="configuration"/>, watched so a save is picked up
    /// while running. Called where the file has always been added, after the app's own settings
    /// and the environment, so a key the file sets still wins over them as it did.
    /// </summary>
    public static void AddFile(ConfigurationManager configuration) =>
        configuration.AddJsonFile(configuration[FileKey] ?? DefaultFile, optional: false, reloadOnChange: true);

    public IReadOnlyList<VenueDefinition> Load() =>
        configuration.GetSection(ItemsKey).Get<List<VenueDefinition>>() ?? [];

    // Any configuration reload counts, not only the venue file's: that is what the registry
    // answered to when it watched the whole "Venues" section, and a reload whose list is
    // unchanged only rebuilds the same venues.
    public IDisposable OnChange(Action listener) =>
        ChangeToken.OnChange(configuration.GetReloadToken, listener);
}
