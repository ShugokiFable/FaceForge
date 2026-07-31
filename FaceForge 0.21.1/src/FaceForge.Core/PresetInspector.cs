using System.Text.Json;

namespace FaceForge.Core;

/// <summary>
/// Reads a finished RaceMenu preset back and works out what it actually needs.
///
/// This exists because a preset changes after FaceForge writes it. Picking different eyes, hair,
/// brows or a head mesh in RaceMenu rewrites the head-part list, and the dependency report
/// FaceForge generated at export time no longer describes the file. Sharing that stale report
/// gives the recipient a preset that silently falls back to defaults for every part they lack.
/// </summary>
public static class PresetInspector
{
    public static PresetReport Inspect(
        string jslotPath,
        EnvironmentCatalog? catalog)
    {
        using var stream = File.OpenRead(jslotPath);
        using var document = JsonDocument.Parse(stream);
        var root = document.RootElement;

        var modsByIndex = new Dictionary<int, string>();
        if (root.TryGetProperty("mods", out var mods) && mods.ValueKind == JsonValueKind.Array)
        {
            foreach (var mod in mods.EnumerateArray())
            {
                if (mod.TryGetProperty("name", out var name) &&
                    mod.TryGetProperty("index", out var index) &&
                    index.TryGetInt32(out var value) &&
                    name.GetString() is { Length: > 0 } text)
                {
                    modsByIndex[value] = text;
                }
            }
        }

        var choicesByIdentifier = catalog?.Summary.AppearanceChoices
            .GroupBy(item => item.FormIdentifier, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase)
            ?? new Dictionary<string, AppearanceChoice>(StringComparer.OrdinalIgnoreCase);

        var scannedPlugins = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var headParts = new List<PresetHeadPartReport>();
        var requiredPlugins = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (root.TryGetProperty("headParts", out var parts) && parts.ValueKind == JsonValueKind.Array)
        {
            foreach (var part in parts.EnumerateArray())
            {
                if (!part.TryGetProperty("formIdentifier", out var identifierElement)) continue;
                var identifier = identifierElement.GetString();
                if (string.IsNullOrWhiteSpace(identifier)) continue;
                var separator = identifier.IndexOf('|');
                var plugin = separator > 0 ? identifier[..separator] : identifier;
                requiredPlugins.Add(plugin);

                // A light (ESL-flagged) plugin loads at index 0xFE and its records live in the
                // low twelve bits, but RaceMenu writes the formIdentifier with the light index
                // bits still embedded -- "Foo.esp|4BED40" for what the plugin itself calls
                // 000D40. Matching the string as written misses every ESL head part.
                if (part.TryGetProperty("formId", out var rawElement) &&
                    rawElement.TryGetUInt32(out var rawFormId) &&
                    (rawFormId >> 24) == 0xFE &&
                    separator > 0 &&
                    uint.TryParse(
                        identifier[(separator + 1)..],
                        System.Globalization.NumberStyles.HexNumber,
                        System.Globalization.CultureInfo.InvariantCulture,
                        out var embedded))
                {
                    identifier = $"{plugin}|{embedded & 0xFFF:X6}";
                }

                // The main index only covers plugins whose source mod deployed loose face assets,
                // so a mod that ships its meshes in a BSA contributes nothing. Rather than report
                // the part as unknown, parse its plugin directly the first time it comes up.
                if (!choicesByIdentifier.ContainsKey(identifier) &&
                    catalog is not null &&
                    scannedPlugins.Add(plugin))
                {
                    foreach (var extra in catalog.ReadHeadPartsFrom(plugin))
                        choicesByIdentifier.TryAdd(extra.FormIdentifier, extra);
                }
                choicesByIdentifier.TryGetValue(identifier, out var match);
                headParts.Add(new PresetHeadPartReport(
                    identifier,
                    match?.DisplayName,
                    match?.EditorId,
                    match?.Category ?? "unknown",
                    match?.Sex ?? "unknown",
                    match?.ValidRaces ?? [],
                    plugin,
                    match?.SourceMod,
                    match is not null));
            }
        }

        foreach (var name in ReadStringArray(root, "modNames")) requiredPlugins.Add(name);
        foreach (var name in modsByIndex.Values) requiredPlugins.Add(name);

        var morphFamilies = new SortedDictionary<string, int>(StringComparer.Ordinal);
        var customCount = 0;
        var sculptHosts = new List<string>();
        var hasVanillaBase = false;
        if (root.TryGetProperty("morphs", out var morphs) && morphs.ValueKind == JsonValueKind.Object)
        {
            if (morphs.TryGetProperty("custom", out var custom) &&
                custom.ValueKind == JsonValueKind.Array)
            {
                foreach (var entry in custom.EnumerateArray())
                {
                    if (!entry.TryGetProperty("name", out var nameElement)) continue;
                    var name = nameElement.GetString();
                    if (string.IsNullOrWhiteSpace(name)) continue;
                    customCount++;
                    var family = name.Split('_')[0];
                    morphFamilies[family] = morphFamilies.GetValueOrDefault(family) + 1;
                }
            }
            if (morphs.TryGetProperty("sculpt", out var sculpt))
            {
                foreach (var entry in sculpt.ValueKind switch
                         {
                             JsonValueKind.Array => sculpt.EnumerateArray().ToArray(),
                             JsonValueKind.Object => [sculpt],
                             _ => Array.Empty<JsonElement>()
                         })
                {
                    if (entry.TryGetProperty("host", out var host) &&
                        host.GetString() is { Length: > 0 } hostPath)
                    {
                        sculptHosts.Add(hostPath);
                    }
                }
            }
            // The vanilla CharGen base: 19 morph floats plus four preset indices. FaceForge never
            // writes it, so its presence means the preset was saved from a real character.
            hasVanillaBase = morphs.TryGetProperty("default", out var defaults) &&
                             defaults.ValueKind == JsonValueKind.Object &&
                             defaults.TryGetProperty("presets", out _);
        }

        var actor = root.TryGetProperty("actor", out var actorElement) &&
                    actorElement.ValueKind == JsonValueKind.Object
            ? actorElement
            : default;
        var weight = actor.ValueKind == JsonValueKind.Object &&
                     actor.TryGetProperty("weight", out var weightElement) &&
                     weightElement.TryGetSingle(out var parsedWeight)
            ? parsedWeight
            : 50f;
        uint? hairColor = actor.ValueKind == JsonValueKind.Object &&
                          actor.TryGetProperty("hairColor", out var hairElement) &&
                          hairElement.TryGetUInt32(out var parsedHair)
            ? parsedHair
            : null;
        var headTexture = actor.ValueKind == JsonValueKind.Object &&
                          actor.TryGetProperty("headTexture", out var headTextureElement)
            ? headTextureElement.GetString()
            : null;
        if (!string.IsNullOrWhiteSpace(headTexture))
        {
            var separator = headTexture.IndexOf('|');
            if (separator > 0) requiredPlugins.Add(headTexture[..separator]);
        }

        var tintCount = root.TryGetProperty("tintInfo", out var tints) &&
                        tints.ValueKind == JsonValueKind.Array
            ? tints.EnumerateArray().Count(item =>
                item.TryGetProperty("color", out var color) &&
                color.TryGetUInt32(out var value) &&
                // 0xFFFFFF is the untouched white default; only coloured layers were authored.
                (value & 0x00FFFFFF) != 0x00FFFFFF)
            : 0;

        var dependencies = catalog?.ResolveDependencies(requiredPlugins) ??
                           requiredPlugins
                               .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                               .Select(name => new PluginProvider(name, null, false, false, 0, 0))
                               .ToList();

        var blockers = new List<string>();
        var notes = new List<string>();
        foreach (var missing in dependencies.Where(item => !item.Present))
            blockers.Add($"Required plugin not installed here: {missing.PluginName}");
        foreach (var unresolved in headParts.Where(item => !item.Resolved))
            notes.Add($"Head part {unresolved.FormIdentifier} was not found even after parsing {unresolved.PluginName} directly; the record may have been removed or the plugin is unreadable.");
        if (sculptHosts.Count == 0)
            notes.Add("No sculpt data. The preset is slider-only, which travels well but carries less likeness than a sculpted head.");
        if (!hasVanillaBase)
            notes.Add("No vanilla CharGen base block. RaceMenu will keep whatever base morphs the loading character already had.");
        if (customCount == 0)
            blockers.Add("The preset contains no slider values at all.");

        return new PresetReport(
            Path.GetFileName(jslotPath),
            Path.GetFullPath(jslotPath),
            customCount,
            morphFamilies.Select(pair => new MorphFamilyCount(pair.Key, pair.Value)).ToArray(),
            sculptHosts,
            headParts,
            dependencies,
            tintCount,
            hairColor,
            weight,
            headTexture,
            hasVanillaBase,
            blockers.Count == 0,
            blockers,
            notes);
    }

    private static IReadOnlyList<string> ReadStringArray(JsonElement root, string property)
    {
        if (!root.TryGetProperty(property, out var values) ||
            values.ValueKind != JsonValueKind.Array) return [];
        return values.EnumerateArray()
            .Select(item => item.GetString())
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Select(item => item!)
            .ToList();
    }
}
