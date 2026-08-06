using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace FaceForge.Core;

public static class ExportPackager
{
    private static readonly DateTimeOffset StableTimestamp =
        new(2026, 7, 29, 0, 0, 0, TimeSpan.Zero);

    public static ExportResult Build(ExportRequest request)
    {
        var mode = request.Mode switch
        {
            "preset-pack" => "preset-pack",
            "racemenu-export-stage" => "racemenu-export-stage",
            "follower-head-kit" => "follower-head-kit",
            _ => throw new ArgumentException("Unsupported export mode.")
        };
        var name = SanitizeName(request.PresetName);
        var output = Path.GetFullPath(request.OutputPath);
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);

        var entries = new List<string>();
        using (var stream = new FileStream(output, FileMode.Create, FileAccess.Write, FileShare.None))
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create))
        {
            if (mode == "preset-pack")
            {
                AddText(
                    archive,
                    $"SKSE/Plugins/CharGen/Presets/{name}.jslot",
                    request.JslotContents,
                    entries);
                if (request.PreserveSculpt &&
                    File.Exists(request.SourceNifPath) &&
                    File.Exists(request.SourceDdsPath))
                {
                    AddFile(
                        archive,
                        request.SourceNifPath!,
                        $"SKSE/Plugins/CharGen/{name}.nif",
                        entries);
                    AddFile(
                        archive,
                        request.SourceDdsPath!,
                        $"SKSE/Plugins/CharGen/{name}.dds",
                        entries);
                }
                AddText(
                    archive,
                    "README.txt",
                    BuildPresetReadme(name, request),
                    entries);
            }
            else if (mode == "racemenu-export-stage")
            {
                AddText(
                    archive,
                    $"SKSE/Plugins/CharGen/Presets/{name}.jslot",
                    request.JslotContents,
                    entries);
                AddText(
                    archive,
                    "FaceForge/racemenu-export-job.json",
                    JsonSerializer.Serialize(
                        new
                        {
                            schemaVersion = 2,
                            product = "FaceForge RaceMenu Head Export Stage",
                            name,
                            preset = $"SKSE/Plugins/CharGen/Presets/{name}.jslot",
                            targetRaceEditorId = request.TargetRaceEditorId,
                            targetSex = request.TargetSex,
                            materializeWith = "RaceMenu Sculpt tab -> Save preset, in game",
                            expectedOutput = new
                            {
                                jslot = $"Data/SKSE/Plugins/CharGen/Presets/{name}.jslot",
                                nif = $"Data/SKSE/Plugins/CharGen/{name}.nif",
                                dds = $"Data/SKSE/Plugins/CharGen/{name}.dds"
                            },
                            followerForgeScansDirectory = "Data/SKSE/Plugins/CharGen",
                            requiresNpcPluginAfterExport = true,
                            requiredPlugins = request.Dependencies.Select(item => item.PluginName).ToArray()
                        },
                        JsonOptions),
                    entries);
                AddText(
                    archive,
                    "README.txt",
                    BuildRaceMenuExportReadme(name, request),
                    entries);
            }
            else
            {
                if (!request.PreserveSculpt)
                    throw new InvalidOperationException(
                        "FollowerForge Head Kit requires Preserve Sculpt so the JSlot matches the source NIF/DDS.");
                if (!File.Exists(request.SourceNifPath) || !File.Exists(request.SourceDdsPath))
                    throw new InvalidOperationException(
                        "FollowerForge Head Kit requires a matched CharGen NIF and DDS.");
                AddText(
                    archive,
                    $"FaceForge/Source/{name}.jslot",
                    request.JslotContents,
                    entries);
                AddFile(
                    archive,
                    request.SourceNifPath!,
                    $"FaceForge/Source/{name}.nif",
                    entries);
                AddFile(
                    archive,
                    request.SourceDdsPath!,
                    $"FaceForge/Source/{name}.dds",
                    entries);
                AddText(
                    archive,
                    "FaceForge/follower-head-manifest.json",
                    JsonSerializer.Serialize(
                        new
                        {
                            schemaVersion = 2,
                            product = "FaceForge FollowerForge Head Kit",
                            name,
                            targetRaceEditorId = request.TargetRaceEditorId,
                            targetSex = request.TargetSex,
                            source = new
                            {
                                jslot = $"FaceForge/Source/{name}.jslot",
                                nif = $"FaceForge/Source/{name}.nif",
                                dds = $"FaceForge/Source/{name}.dds"
                            },
                            installTo = new
                            {
                                jslot = $"Data/SKSE/Plugins/CharGen/Presets/{name}.jslot",
                                nif = $"Data/SKSE/Plugins/CharGen/{name}.nif",
                                dds = $"Data/SKSE/Plugins/CharGen/{name}.dds"
                            },
                            requiresNpcPlugin = true,
                            requiresPluginBoundFaceGenPaths = true,
                            redistributionPermission = request.RedistributionPermissionConfirmed
                                ? "user-confirmed"
                                : "unknown",
                            requiredPlugins = request.Dependencies.Select(item => item.PluginName).ToArray()
                        },
                        JsonOptions),
                    entries);
                AddText(
                    archive,
                    "README.txt",
                    BuildHeadKitReadme(name, request),
                    entries);
            }

            AddText(
                archive,
                "dependencies.json",
                JsonSerializer.Serialize(
                    new
                    {
                        schemaVersion = 1,
                        generatedBy = "FaceForge 0.23.1",
                        dependencies = request.Dependencies
                    },
                    JsonOptions),
                entries);
            if (request.AppearanceChoices is { Count: > 0 })
            {
                AddText(
                    archive,
                    "FaceForge/appearance-selections.json",
                    JsonSerializer.Serialize(
                        new
                        {
                            schemaVersion = 1,
                            selections = request.AppearanceChoices
                        },
                        JsonOptions),
                    entries);
            }
        }

        return new ExportResult(
            output,
            mode,
            entries.Count,
            Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(output))),
            entries);
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private static void AddText(
        ZipArchive archive,
        string path,
        string contents,
        List<string> entries)
    {
        var entry = archive.CreateEntry(path, CompressionLevel.Optimal);
        entry.LastWriteTime = StableTimestamp;
        using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
        writer.Write(contents);
        entries.Add(path);
    }

    private static void AddFile(
        ZipArchive archive,
        string source,
        string path,
        List<string> entries)
    {
        var entry = archive.CreateEntry(path, CompressionLevel.Optimal);
        entry.LastWriteTime = StableTimestamp;
        using var input = File.OpenRead(source);
        using var output = entry.Open();
        input.CopyTo(output);
        entries.Add(path);
    }

    private static string BuildPresetReadme(string name, ExportRequest request)
    {
        var companion = request.PreserveSculpt &&
                        File.Exists(request.SourceNifPath) &&
                        File.Exists(request.SourceDdsPath)
            ? "The compatible template CharGen NIF/DDS are included because Preserve Sculpt was enabled."
            : "This pack contains only the generated JSlot. Load it in RaceMenu and export a new sculpt/tint if needed.";
        return $"""
                FaceForge RaceMenu Preset Pack: {name}

                Install with a mod manager or copy the Data-relative files to Skyrim Data.
                {companion}

                Required plugins and exact installed-source provenance are listed in dependencies.json.
                Dependency discovery does not grant permission to redistribute third-party assets.
                """;
    }

    private static string BuildHeadKitReadme(string name, ExportRequest request) => $"""
        FaceForge FollowerForge Head Kit: {name}

        Target race: {request.TargetRaceEditorId ?? "not chosen"}
        Target sex:  {request.TargetSex}

        This is source material for follower authoring, not an install-ready follower.
        A follower still needs an NPC plugin plus plugin/FormID-bound FaceGeom and FaceTint paths.

        The trio in FaceForge/Source is the head Skyrim already baked. To hand it to
        FollowerForge, place the three files where FollowerForge scans:
           Data\SKSE\Plugins\CharGen\Presets\{name}.jslot
           Data\SKSE\Plugins\CharGen\{name}.nif
           Data\SKSE\Plugins\CharGen\{name}.dds
        FollowerForge enumerates the NIF files in Data\SKSE\Plugins\CharGen and matches each to
        a preset of the same name. If you rename one file, rename all three.

        Redistribution permission: {(request.RedistributionPermissionConfirmed ? "user-confirmed" : "unknown")}
        Do not share third-party assets until permission has been verified.
        Exact plugin dependencies and installed-source provenance are in dependencies.json.
        """;

    private static string BuildRaceMenuExportReadme(string name, ExportRequest request) => $"""
        FaceForge RaceMenu Head Export Stage: {name}

        Target race: {request.TargetRaceEditorId ?? "not chosen"}
        Target sex:  {request.TargetSex}

        This is not an install-ready follower yet. It contains a RaceMenu JSlot, not an NPC
        plugin, FaceGen NIF, or FaceTint DDS. Exact selected head-part records are already
        written into the JSlot and documented in FaceForge/appearance-selections.json.

        This is a round trip. Skyrim itself has to bake the head, then FollowerForge picks it
        up off disk. FaceForge cannot invent the NIF/DDS outside the game because only the
        running game knows the active race, sex, head parts, TRI topology, tint layers, and
        installed assets.

        1. Install this ZIP with Vortex.
        2. In Skyrim, open RaceMenu and set the race and sex above BEFORE loading the preset.
           RaceMenu silently ignores head parts that are not valid for the active race/sex.
        3. Load {name}.jslot from the Presets tab.
        4. Still in RaceMenu, open the Sculpt tab and save the preset back out under the SAME
           name: {name}. Saving with sculpt data present is what makes RaceMenu write the
           companion head mesh and tint texture next to the preset.
        5. Confirm all three files now exist:
           Data\SKSE\Plugins\CharGen\Presets\{name}.jslot
           Data\SKSE\Plugins\CharGen\{name}.nif
           Data\SKSE\Plugins\CharGen\{name}.dds
           If the NIF and DDS are missing, the character had no sculpt data. Nudge any sculpt
           control once in RaceMenu and save again.
        6. Open FollowerForge. It scans Data\SKSE\Plugins\CharGen for exactly that NIF/DDS pair
           and matches it to the preset by name, then builds the NPC plugin with race, voice,
           class, placement, equipment, spells, perks, and behavior.

        Step 5 is the whole point of this stage. A JSlot on its own is not a head;
        FollowerForge lists nothing until the matching NIF exists in that folder.
        """;

    private static string SanitizeName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars().ToHashSet();
        var safe = new string(value.Trim()
            .Where(character => !invalid.Contains(character) && !char.IsControl(character))
            .ToArray())
            .Trim()
            .TrimEnd('.', ' ');
        return string.IsNullOrWhiteSpace(safe) ? "FaceForge_Preset" : safe[..Math.Min(96, safe.Length)];
    }
}
