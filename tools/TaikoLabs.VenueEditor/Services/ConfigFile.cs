using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using TaikoLabs.VenueEditor.Models;

namespace TaikoLabs.VenueEditor.Services;

/// <summary>
/// Reads and writes <c>Venues:Items</c> inside appsettings.json.
///
/// The whole document is kept as a <see cref="JsonNode"/> so that everything this editor
/// does not understand — logging, CORS, the YouTube key, a venue's floor plan — survives
/// a round trip untouched.
/// </summary>
public static class ConfigFile
{
    private static readonly JsonSerializerOptions WriteOptions = new()
    {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public sealed record Loaded(JsonObject Root, List<VenueDraft> Venues);

    /// <summary>Looks for appsettings.json by walking up from the executable.</summary>
    public static string? FindDefaultPath()
    {
        var relative = Path.Combine("backend", "TaikoLabs.Api", "appsettings.json");
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, relative);
            if (File.Exists(candidate))
            {
                return candidate;
            }

            directory = directory.Parent;
        }

        return null;
    }

    public static Loaded Load(string path)
    {
        // ReadAllText strips a UTF-8 BOM, which JsonNode.Parse would otherwise reject.
        var root = JsonNode.Parse(File.ReadAllText(path)) as JsonObject
            ?? throw new InvalidDataException("최상위가 JSON 객체가 아닙니다.");

        var items = root["Venues"]?["Items"] as JsonArray;
        var venues = new List<VenueDraft>();

        foreach (var item in items?.OfType<JsonObject>() ?? [])
        {
            venues.Add(FromJson(item));
        }

        return new Loaded(root, venues);
    }

    public static void Save(string path, JsonObject root, IEnumerable<VenueDraft> venues)
    {
        if (root["Venues"] is not JsonObject section)
        {
            section = new JsonObject
            {
                ["TimeZone"] = "Asia/Seoul",
                ["ClosureRefreshHour"] = 5,
                ["ClosureCachePath"] = "closures.cache.json",
            };
            root["Venues"] = section;
        }

        section["Items"] = new JsonArray(venues.Select(ToJson).Cast<JsonNode>().ToArray());

        var json = root.ToJsonString(WriteOptions);

        // Write without a BOM: the API reads this file, and so do other tools.
        File.WriteAllText(path, json + Environment.NewLine, new UTF8Encoding(false));
    }

    private static VenueDraft FromJson(JsonObject item)
    {
        var draft = new VenueDraft
        {
            Id = Text(item, "id"),
            Name = Text(item, "name"),
            Accent = Text(item, "accent", "#E8B24A"),
            ChannelId = Text(item, "channelId"),
            ChannelUrl = Text(item, "channelUrl"),
            TitlePattern = Text(item, "titlePattern"),
            NaverPlaceId = Text(item, "naverPlaceId"),
            Layout = item["layout"] is JsonObject layout ? layout.DeepClone() : null,
        };

        foreach (var zone in item["zones"]?.AsArray().OfType<JsonObject>() ?? [])
        {
            draft.Zones.Add(new ZoneDraft
            {
                Id = Text(zone, "id"),
                Code = Text(zone, "code"),
                Label = Text(zone, "label"),
            });
        }

        foreach (var station in item["stations"]?.AsArray().OfType<JsonObject>() ?? [])
        {
            var aliases = station["aliases"]?.AsArray().Select(node => node?.GetValue<string>() ?? string.Empty) ?? [];

            draft.Stations.Add(new StationDraft
            {
                Id = Text(station, "id"),
                Label = Text(station, "label"),
                ZoneId = Text(station, "zoneId"),
                Aliases = string.Join(", ", aliases.Where(alias => alias.Length > 0)),
            });
        }

        var hours = item["hours"] as JsonObject;
        foreach (var day in HourDraft.WeekOrder)
        {
            var value = hours?[day]?.GetValue<string>() ?? string.Empty;
            var parts = value.Split('-', 2, StringSplitOptions.TrimEntries);

            draft.Hours.Add(parts.Length == 2
                ? new HourDraft(day) { Open = parts[0], Close = parts[1] }
                : new HourDraft(day) { IsClosed = true });
        }

        var closed = item["closedDates"]?.AsArray().Select(node => node?.GetValue<string>() ?? string.Empty) ?? [];
        draft.ClosedDates = string.Join(Environment.NewLine, closed.Where(date => date.Length > 0));

        return draft;
    }

    private static JsonObject ToJson(VenueDraft draft)
    {
        var item = new JsonObject
        {
            ["id"] = draft.Id.Trim(),
            ["name"] = draft.Name.Trim(),
        };

        AddIfPresent(item, "accent", draft.Accent);
        item["channelId"] = draft.ChannelId.Trim();
        AddIfPresent(item, "channelUrl", draft.ChannelUrl);
        item["titlePattern"] = draft.TitlePattern;
        AddIfPresent(item, "naverPlaceId", draft.NaverPlaceId);

        if (draft.Zones.Count > 0)
        {
            item["zones"] = new JsonArray(draft.Zones
                .Where(zone => zone.Id.Trim().Length > 0)
                .Select(zone => (JsonNode)new JsonObject
                {
                    ["id"] = zone.Id.Trim(),
                    ["code"] = zone.Code.Trim(),
                    ["label"] = zone.Label.Trim(),
                })
                .ToArray());
        }

        item["stations"] = new JsonArray(draft.Stations
            .Where(station => station.Id.Trim().Length > 0)
            .Select(station =>
            {
                var node = new JsonObject
                {
                    ["id"] = station.Id.Trim(),
                    ["label"] = station.Label.Trim(),
                };

                if (station.ZoneId.Trim().Length > 0)
                {
                    node["zoneId"] = station.ZoneId.Trim();
                }

                var aliases = SplitAliases(station.Aliases);
                if (aliases.Length > 0)
                {
                    node["aliases"] = new JsonArray(aliases.Select(alias => (JsonNode)alias!).ToArray());
                }

                return (JsonNode)node;
            })
            .ToArray());

        // Null rather than omitted, so it reads as a deliberate "no floor plan".
        item["layout"] = draft.Layout?.DeepClone();

        var hours = new JsonObject();
        foreach (var hour in draft.Hours)
        {
            hours[hour.Day] = hour.Value;
        }

        item["hours"] = hours;

        item["closedDates"] = new JsonArray(draft.ClosedDates
            .Split(['\n', '\r', ','], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(date => (JsonNode)date)
            .ToArray());

        return item;
    }

    public static string[] SplitAliases(string value) =>
        value.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static void AddIfPresent(JsonObject item, string key, string value)
    {
        if (!string.IsNullOrWhiteSpace(value))
        {
            item[key] = value.Trim();
        }
    }

    private static string Text(JsonObject item, string key, string fallback = "") =>
        item[key]?.GetValue<string>() ?? fallback;
}
