using System.Text.Json;
using TaikoLabs.Api.Services;

namespace TaikoLabs.Api.Tests;

/// <summary>
/// Cabinet names compare the same on the server and on the page: Venue.Normalize against
/// the vectors the frontend's lib/cabinetName.ts is tested with too
/// (frontend/src/test/contract/cabinet-names.json). A name the two keyed differently
/// played on one tile on the wall and showed as "not connected" in the venue editor.
/// </summary>
public class NormalizeTests
{
    public static TheoryData<string, string> Cases()
    {
        using var vectors = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "contract", "cabinet-names.json")));
        var cases = new TheoryData<string, string>();
        foreach (var item in vectors.RootElement.GetProperty("cases").EnumerateArray())
        {
            cases.Add(item.GetProperty("name").GetString()!, item.GetProperty("key").GetString()!);
        }
        return cases;
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void A_name_is_keyed_as_the_shared_vectors_say(string name, string key)
    {
        Assert.Equal(key, Venue.Normalize(name));
    }
}
