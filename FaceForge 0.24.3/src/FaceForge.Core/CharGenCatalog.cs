using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace FaceForge.Core;

public static class CharGenCatalog
{
    private static readonly string[] IgnorableSuffixes =
        ["head", "replacer", "sculpt", "preset", "chargen", "export", "final", "face"];

    /// <summary>Convenience overload for a real Data folder (a direct install or Vortex deployment).</summary>
    public static IReadOnlyList<IndexedPreset> Discover(string gameDataPath) =>
        Discover(ResolvedDataView.Physical(gameDataPath));

    public static IReadOnlyList<IndexedPreset> Discover(ResolvedDataView view)
    {
        const string charGen = @"SKSE\Plugins\CharGen";
        var presetDirs = new[]
        {
            (RelDir: charGen + @"\Presets", CompanionRelDir: charGen, Layout: "preset"),
            (RelDir: charGen + @"\Exported", CompanionRelDir: charGen + @"\Exported", Layout: "exported"),
            (RelDir: charGen, CompanionRelDir: charGen, Layout: "preset")
        };

        var results = new List<IndexedPreset>();
        foreach (var (relDir, companionRelDir, layout) in presetDirs)
        {
            foreach (var (_, jslotAbs) in view.Files(relDir, "*.jslot", recursive: false))
                results.Add(InspectTemplateFromView(view, jslotAbs, companionRelDir, layout));
        }

        return results
            .GroupBy(item => item.JslotPath, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .OrderBy(item => item.FileName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static IndexedPreset InspectTemplate(string jslotPath)
    {
        var parent = Path.GetDirectoryName(jslotPath)
                     ?? throw new InvalidDataException("Template has no parent directory.");
        if (string.Equals(Path.GetFileName(parent), "Presets", StringComparison.OrdinalIgnoreCase))
            return InspectTemplate(jslotPath, Directory.GetParent(parent)?.FullName ?? parent, "preset");
        if (string.Equals(Path.GetFileName(parent), "Exported", StringComparison.OrdinalIgnoreCase))
            return InspectTemplate(jslotPath, parent, "exported");
        return InspectTemplate(jslotPath, parent, "standalone");
    }

    public static TemplatePayload Load(IndexedPreset preset) =>
        new(
            preset.FileName,
            File.ReadAllText(preset.JslotPath),
            preset.Id,
            preset.NifPath,
            preset.DdsPath,
            preset.Layout);

    private static IndexedPreset InspectTemplate(string jslotPath, string companionDir, string layout)
    {
        var metadata = ReadMetadata(jslotPath);
        var stem = Path.GetFileNameWithoutExtension(jslotPath);
        var pair = FindCompanions(stem, companionDir);
        return new IndexedPreset(
            StableId(Path.GetFullPath(jslotPath)),
            Path.GetFileName(jslotPath),
            Path.GetFullPath(jslotPath),
            pair.Nif,
            pair.Dds,
            layout,
            metadata.Dependencies,
            metadata.SculptHostCount);
    }

    private static IndexedPreset InspectTemplateFromView(
        ResolvedDataView view,
        string jslotPath,
        string companionRelDir,
        string layout)
    {
        var metadata = ReadMetadata(jslotPath);
        var stem = Path.GetFileNameWithoutExtension(jslotPath);
        var pair = FindCompanionsFromView(view, stem, companionRelDir);
        return new IndexedPreset(
            StableId(Path.GetFullPath(jslotPath)),
            Path.GetFileName(jslotPath),
            Path.GetFullPath(jslotPath),
            pair.Nif,
            pair.Dds,
            layout,
            metadata.Dependencies,
            metadata.SculptHostCount);
    }

    /// <summary>
    /// The view-backed companion search: the CharGen NIF/DDS may live in any mod that provides that
    /// path in the MO2 overlay, so it is resolved through the view rather than a single folder.
    /// </summary>
    private static (string? Nif, string? Dds) FindCompanionsFromView(
        ResolvedDataView view,
        string stem,
        string companionRelDir)
    {
        var nifs = view.Files(companionRelDir, "*.nif", recursive: false).ToList();
        var selected = nifs.FirstOrDefault(item =>
            string.Equals(
                Path.GetFileNameWithoutExtension(item.RelPath), stem, StringComparison.OrdinalIgnoreCase));

        if (selected.AbsolutePath is null)
        {
            var key = NormalizeKey(stem);
            var candidates = nifs.Where(item =>
                    string.Equals(
                        NormalizeKey(Path.GetFileNameWithoutExtension(item.RelPath)),
                        key,
                        StringComparison.Ordinal))
                .ToList();
            if (candidates.Count == 1) selected = candidates[0];
        }

        if (selected.AbsolutePath is null) return (null, null);
        var ddsRel = Path.ChangeExtension(selected.RelPath, ".dds");
        return (
            Path.GetFullPath(selected.AbsolutePath),
            view.TryResolve(ddsRel, out var ddsAbs) ? Path.GetFullPath(ddsAbs) : null);
    }

    public static (IReadOnlyList<string> Dependencies, int SculptHostCount) ReadMetadata(
        string jslotPath)
    {
        using var stream = File.OpenRead(jslotPath);
        using var document = JsonDocument.Parse(stream);
        var root = document.RootElement;
        var dependencies = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (root.TryGetProperty("modNames", out var modNames) &&
            modNames.ValueKind == JsonValueKind.Array)
        {
            foreach (var value in modNames.EnumerateArray())
                AddPlugin(dependencies, value.GetString());
        }

        if (root.TryGetProperty("mods", out var mods) && mods.ValueKind == JsonValueKind.Array)
        {
            foreach (var mod in mods.EnumerateArray())
            {
                if (mod.TryGetProperty("name", out var name)) AddPlugin(dependencies, name.GetString());
            }
        }

        if (root.TryGetProperty("headParts", out var headParts) &&
            headParts.ValueKind == JsonValueKind.Array)
        {
            foreach (var part in headParts.EnumerateArray())
            {
                if (!part.TryGetProperty("formIdentifier", out var identifier)) continue;
                var text = identifier.GetString();
                var separator = text?.IndexOf('|') ?? -1;
                if (separator > 0) AddPlugin(dependencies, text![..separator]);
            }
        }

        var sculptCount = 0;
        if (root.TryGetProperty("morphs", out var morphs) &&
            morphs.ValueKind == JsonValueKind.Object &&
            morphs.TryGetProperty("sculpt", out var sculpt))
        {
            sculptCount = sculpt.ValueKind switch
            {
                JsonValueKind.Object => 1,
                JsonValueKind.Array => sculpt.EnumerateArray()
                    .Count(item => item.ValueKind == JsonValueKind.Object),
                _ => 0
            };
        }

        return (
            dependencies.OrderBy(value => value, StringComparer.OrdinalIgnoreCase).ToList(),
            sculptCount);
    }

    private static void AddPlugin(HashSet<string> dependencies, string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        var trimmed = value.Trim();
        if (trimmed.EndsWith(".esp", StringComparison.OrdinalIgnoreCase) ||
            trimmed.EndsWith(".esm", StringComparison.OrdinalIgnoreCase) ||
            trimmed.EndsWith(".esl", StringComparison.OrdinalIgnoreCase))
        {
            dependencies.Add(trimmed);
        }
    }

    private static (string? Nif, string? Dds) FindCompanions(string stem, string directory)
    {
        if (!Directory.Exists(directory)) return (null, null);
        var nifs = Directory.EnumerateFiles(directory, "*.nif", SearchOption.TopDirectoryOnly).ToList();
        var exact = nifs.FirstOrDefault(path =>
            string.Equals(Path.GetFileNameWithoutExtension(path), stem, StringComparison.OrdinalIgnoreCase));
        var selected = exact;

        if (selected is null)
        {
            var key = NormalizeKey(stem);
            var candidates = nifs.Where(path =>
                    string.Equals(
                        NormalizeKey(Path.GetFileNameWithoutExtension(path)),
                        key,
                        StringComparison.Ordinal))
                .ToList();
            if (candidates.Count == 1) selected = candidates[0];
        }

        if (selected is null) return (null, null);
        var dds = Path.ChangeExtension(selected, ".dds");
        return (Path.GetFullPath(selected), File.Exists(dds) ? Path.GetFullPath(dds) : null);
    }

    /// <summary>
    /// Finds the preset whose CharGen NIF/DDS Skyrim has already baked, which is the only form
    /// FollowerForge can consume. Returns null while the round trip is incomplete.
    /// </summary>
    /// <summary>Convenience overload for a real Data folder (a direct install or Vortex deployment).</summary>
    public static IndexedPreset? FindBakedHead(string gameDataPath, string name) =>
        FindBakedHead(ResolvedDataView.Physical(gameDataPath), name);

    public static IndexedPreset? FindBakedHead(ResolvedDataView view, string name)
    {
        var complete = Discover(view)
            .Where(item => item.HasNif && item.HasDds)
            .ToList();
        var stem = Path.GetFileNameWithoutExtension(name);
        var exact = complete.FirstOrDefault(item =>
            string.Equals(
                Path.GetFileNameWithoutExtension(item.FileName),
                stem,
                StringComparison.OrdinalIgnoreCase));
        if (exact is not null) return exact;

        var key = NormalizeKey(stem);
        if (key.Length == 0) return null;
        var candidates = complete
            .Where(item => NormalizeKey(Path.GetFileNameWithoutExtension(item.FileName)) == key)
            .ToList();
        // Two equally good matches would be a coin flip that silently builds the wrong follower.
        return candidates.Count == 1 ? candidates[0] : null;
    }

    private static string NormalizeKey(string value)
    {
        var normalized = new string(value.Trim()
            .Where(char.IsLetterOrDigit)
            .Select(char.ToLowerInvariant)
            .ToArray());
        bool changed;
        do
        {
            changed = false;
            foreach (var suffix in IgnorableSuffixes)
            {
                if (normalized.Length <= suffix.Length ||
                    !normalized.EndsWith(suffix, StringComparison.Ordinal)) continue;
                normalized = normalized[..^suffix.Length];
                changed = true;
            }
        } while (changed);
        return normalized;
    }

    private static string StableId(string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value.ToUpperInvariant()));
        return Convert.ToHexString(hash)[..16];
    }
}
