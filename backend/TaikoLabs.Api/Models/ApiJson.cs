using System.Text.Json;
using System.Text.Json.Serialization;

namespace TaikoLabs.Api.Models;

/// <summary>
/// How every API response is written. One place for it, because the frontend's types
/// (frontend/src/lib/types.ts) are written against what comes out - a null field is left
/// out rather than sent as null - and the contract tests serialize with the same settings.
/// </summary>
public static class ApiJson
{
    public static void Configure(JsonSerializerOptions options)
    {
        options.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.Converters.Add(new JsonStringEnumConverter());
        options.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
    }
}
