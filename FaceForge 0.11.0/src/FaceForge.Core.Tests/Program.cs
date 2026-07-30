using System.IO.Compression;
using System.Text.Json;
using FaceForge.Core;

if (args is ["--discover"])
{
    var location = EnvironmentDiscovery.TryDiscover();
    Console.WriteLine(JsonSerializer.Serialize(location, new JsonSerializerOptions
    {
        WriteIndented = true
    }));
    if (location is null) Environment.ExitCode = 2;
    return;
}

if (args is ["--index", var gameData])
{
    var catalog = EnvironmentCatalog.Build(gameData);
    var summary = catalog.Summary;
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        summary.GameDataPath,
        summary.ManifestPath,
        summary.StagingPath,
        summary.DeploymentTimeUtcMs,
        summary.SourceModCount,
        summary.PluginCount,
        summary.RelevantAssetCount,
        summary.BsaCount,
        summary.PresetCount,
        summary.DetectionMethod,
        summary.AutoDetected,
        appearanceRecommendations = summary.AppearanceRecommendations.Select(item => new
        {
            item.Category,
            item.SourceMod,
            item.ConfidenceScore,
            item.AssetCount,
            plugins = item.PluginRequirements.Select(plugin => new
            {
                plugin.PluginName,
                plugin.Masters,
                plugin.MissingMasters
            }),
            item.CompatibilityNotes
        }),
        playableRaces = summary.PlayableRaces.Select(item => new
        {
            item.EditorId,
            item.Name,
            item.FormIdentifier,
            item.FaceGenHead
        }),
        appearanceChoiceCount = summary.AppearanceChoices.Count,
        appearanceChoiceCounts = summary.AppearanceChoices
            .GroupBy(item => item.Category)
            .ToDictionary(group => group.Key, group => group.Count()),
        appearanceChoiceSexCounts = summary.AppearanceChoices
            .GroupBy(item => item.Sex)
            .ToDictionary(group => group.Key, group => group.Count()),
        appearanceChoicesWithResolvedRaces =
            summary.AppearanceChoices.Count(item => item.ValidRaces.Count > 0),
        appearanceChoicesTypedFromRecord =
            summary.AppearanceChoices.Count(item => item.TypeFromRecord),
        // Mirrors the gate the output panel applies, so the effect of a race/sex choice on the
        // real installed library is visible without opening the app.
        eligiblePerActor = new[] { "NordRace", "HighElfRace", "ArgonianRace" }
            .SelectMany(race => new[] { "male", "female" }.Select(sex => new { race, sex }))
            .ToDictionary(
                actor => $"{actor.race}/{actor.sex}",
                actor => summary.AppearanceChoices
                    .Where(item =>
                        item.Playable &&
                        (item.Sex is "any" or "unflagged" || item.Sex == actor.sex) &&
                        (item.ValidRaces.Count == 0 || item.ValidRaces.Contains(actor.race)))
                    .GroupBy(item => item.Category)
                    .OrderBy(group => group.Key, StringComparer.Ordinal)
                    .ToDictionary(group => group.Key, group => group.Count())),
        appearanceChoiceSamples = summary.AppearanceChoices
            .Where(item =>
                item.PluginName.Contains("TRE_Brows", StringComparison.OrdinalIgnoreCase) ||
                item.PluginName.Contains("Koralina", StringComparison.OrdinalIgnoreCase) ||
                item.PluginName.Contains("Kyoe", StringComparison.OrdinalIgnoreCase))
            .Take(20)
            .Select(item => new
            {
                item.Category,
                item.DisplayName,
                item.EditorId,
                item.FormIdentifier,
                item.PluginName,
                item.SourceMod,
                item.Sex,
                item.Playable,
                item.ValidRacesEditorId,
                item.ValidRaces,
                item.MatchEvidence
            }),
        completePresetTrios = summary.Presets.Count(item => item.HasNif && item.HasDds),
        missingDependencies = summary.Presets
            .SelectMany(item => catalog.ResolveDependencies(item.RequiredPlugins))
            .Where(item => !item.Present)
            .Select(item => item.PluginName)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(item => item)
            .ToArray()
    }, new JsonSerializerOptions { WriteIndented = true }));
    return;
}

if (args is ["--inspect", var presetPath, var inspectData])
{
    var inspectCatalog = EnvironmentCatalog.Build(inspectData);
    Console.WriteLine(JsonSerializer.Serialize(
        PresetInspector.Inspect(presetPath, inspectCatalog),
        new JsonSerializerOptions { WriteIndented = true }));
    return;
}

var root = Path.Combine(Path.GetTempPath(), "FaceForge-CoreTests-" + Guid.NewGuid().ToString("N"));
try
{
    var data = Path.Combine(root, "Data");
    var charGen = Path.Combine(data, "SKSE", "Plugins", "CharGen");
    var presets = Path.Combine(charGen, "Presets");
    Directory.CreateDirectory(presets);
    File.WriteAllText(Path.Combine(data, "Skyrim.esm"), "");
    WriteTes4Plugin(Path.Combine(data, "High Poly Head.esm"), "Skyrim.esm");
    WriteTes4Plugin(
        Path.Combine(data, "Exact Brows.esp"),
        "Skyrim.esm",
        "High Poly Head.esm");
    File.WriteAllBytes(Path.Combine(charGen, "TestFace.nif"), [0x4E, 0x49, 0x46]);
    File.WriteAllBytes(Path.Combine(charGen, "TestFace.dds"), [0x44, 0x44, 0x53, 0x20]);
    var jslot = """
                {
                  "modNames": ["Skyrim.esm", "High Poly Head.esm", "Missing Eyes.esp"],
                  "headParts": [{"formIdentifier":"Exact Brows.esp|000801"}],
                  "morphs": {
                    "custom": [],
                    "sculpt": [
                      {"host":"KL\\High Poly Head\\FemaleHeadCharGen.tri","vertices":3832,"data":[]},
                      {"host":"Actors\\Character\\Character Assets\\EyesFemaleChargen.tri","vertices":176,"data":[]}
                    ]
                  },
                  "version":{"formatVersion":3}
                }
                """;
    File.WriteAllText(Path.Combine(presets, "TestFace.jslot"), jslot);
    File.WriteAllText(
        Path.Combine(data, DeploymentManifestReader.FileName),
        """
        {
          "deploymentMethod":"hardlink_activator",
          "gameId":"skyrimse",
          "deploymentTime":12345,
          "stagingPath":"C:\\Vortex\\mods",
          "targetPath":"C:\\Skyrim\\Data",
          "files":[
            {"relPath":"High Poly Head.esm","source":"High Poly Head Exact","time":1},
            {"relPath":"High Poly Head Patch.esm","source":"Similarly Named Patch","time":1},
            {"relPath":"Exact Brows.esp","source":"Exact Brows Package","time":1},
            {"relPath":"meshes\\actors\\character\\character assets\\brows\\exact_brow_01.nif","source":"Exact Brows Package","time":1},
            {"relPath":"textures\\actors\\character\\eyes\\exact_eye_01.dds","source":"Exact Eye Textures","time":1},
            {"relPath":"meshes\\actors\\character\\character assets\\hair\\exact_hair_01.nif","source":"Exact Hair Pack","time":1},
            {"relPath":"textures\\actors\\character\\female\\femalehead_d.dds","source":"Exact Skin Pack","time":1},
            {"relPath":"textures\\actors\\character\\overlays\\femalehead_freckles.dds","source":"Community Overlays","time":1},
            {"relPath":"High Poly Head.bsa","source":"High Poly Head Exact","time":1},
            {"relPath":"meshes\\KL\\High Poly Head\\femalehead.nif","source":"High Poly Head Exact","time":1}
          ]
        }
        """);

    var catalog = EnvironmentCatalog.Build(data, "test fixture", autoDetected: true);
    Assert(catalog.Summary.PluginCount == 4, "plugin count");
    Assert(catalog.Summary.PresetCount == 1, "preset count");
    var preset = catalog.Summary.Presets.Single();
    Assert(preset.SculptHostCount == 2, "multi-sculpt host count");
    Assert(preset.HasNif && preset.HasDds, "CharGen trio");
    Assert(preset.RequiredPlugins.Contains("Exact Brows.esp"), "head-part dependency");

    var resolved = catalog.ResolveDependencies(preset.RequiredPlugins);
    var hph = resolved.Single(item => item.PluginName == "High Poly Head.esm");
    Assert(hph.Present && hph.SourceMod == "High Poly Head Exact", "exact source provenance");
    Assert(hph.SourceBsaCount == 1, "BSA provenance");
    Assert(!resolved.Single(item => item.PluginName == "Missing Eyes.esp").Present, "missing plugin");
    Assert(catalog.Summary.AutoDetected, "automatic detection marker");
    Assert(catalog.Summary.DetectionMethod == "test fixture", "detection method");
    Assert(
        EnvironmentDiscovery.TryNormalizeDataPath(root, out var normalizedData) &&
        normalizedData.Equals(data, StringComparison.OrdinalIgnoreCase),
        "normalize game root");
    Assert(
        EnvironmentDiscovery.TryNormalizeDataPath(charGen, out var normalizedCharGen) &&
        normalizedCharGen.Equals(data, StringComparison.OrdinalIgnoreCase),
        "normalize CharGen path");
    var browRecommendation = catalog.Summary.AppearanceRecommendations.Single(item =>
        item.Category == "brows" && item.SourceMod == "Exact Brows Package");
    Assert(browRecommendation.AssetCount == 1, "brow asset evidence");
    var browPlugin = browRecommendation.PluginRequirements.Single(item =>
        item.PluginName == "Exact Brows.esp");
    Assert(browPlugin.Masters.Contains("High Poly Head.esm"), "brow plugin master");
    Assert(browPlugin.MissingMasters.Count == 0, "brow requirements present");
    Assert(
        new[] { "brows", "eyes", "hair" }.All(category =>
            catalog.Summary.AppearanceRecommendations.Any(item => item.Category == category)),
        "appearance categories");
    Assert(
        catalog.Summary.AppearanceRecommendations.All(item =>
            item.SourceMod != "Exact Skin Pack" && item.SourceMod != "Community Overlays"),
        "skin and overlays are not head-part recommendations");
    Assert(HeadPartCatalog.HasShapeWords("TRE Brows Wide"), "explicit shape word");
    Assert(!HeadPartCatalog.HasShapeWords("Character Brows 01"), "shape words require boundaries");

    // Category must follow the HDPT Type subrecord, not the record name. "Blackbriar" contains
    // no category word at all and 0.6.0 would have dropped it entirely.
    Assert(
        HeadPartCatalog.CategoryFor(Mutagen.Bethesda.Skyrim.HeadPart.TypeEnum.Eyebrows) == "brows",
        "Eyebrows type maps to brows");
    Assert(
        HeadPartCatalog.CategoryFor(Mutagen.Bethesda.Skyrim.HeadPart.TypeEnum.FacialHair) == "facialhair",
        "FacialHair type is its own category");
    Assert(HeadPartCatalog.CategoryFor(null) is null, "missing type falls back to the name");
    Assert(
        HeadPartCatalog.SexFor(
            Mutagen.Bethesda.Skyrim.HeadPart.Flag.Male |
            Mutagen.Bethesda.Skyrim.HeadPart.Flag.Female) == "any",
        "both gender flags means any");
    Assert(
        HeadPartCatalog.SexFor(Mutagen.Bethesda.Skyrim.HeadPart.Flag.Female) == "female",
        "female-only flag");
    Assert(
        HeadPartCatalog.SexFor(Mutagen.Bethesda.Skyrim.HeadPart.Flag.Playable) == "unflagged",
        "no gender flag is unrestricted, not hidden");
    Assert(
        SkyrimRecordIndex.PresentBaseGamePlugins(data).SequenceEqual(["Skyrim.esm"]),
        "base game plugin detection");
    Assert(
        SkyrimRecordIndex.Build(data).ResolveValidRaces(null).Races.Count == 0,
        "unlinked ValidRaces resolves to unknown, not empty-valid");

    var requestJson = OpenRouterVision.BuildRequestJson(
        "vendor/image-model",
        "data:image/png;base64,QUJD");
    using (var request = JsonDocument.Parse(requestJson))
    {
        var provider = request.RootElement.GetProperty("provider");
        Assert(provider.GetProperty("zdr").GetBoolean(), "ZDR request");
        Assert(provider.GetProperty("data_collection").GetString() == "deny", "data collection denial");
        Assert(provider.GetProperty("require_parameters").GetBoolean(), "structured parameter requirement");
    }

    // Refinement rides on top of a local estimate that is itself bounded at the EFM range, so a
    // full-range delta could invert it outright. Interpreting from neutral has nothing to refine.
    Assert(OpenRouterVision.VisionContext.Refinement.Limit == 1, "refinement delta is a third of range");
    Assert(new OpenRouterVision.VisionContext(false, true).Limit == 3, "interpretation gets full range");
    Assert(
        OpenRouterVision.BuildSystemPrompt(new OpenRouterVision.VisionContext(true, false))
            .Contains("corrective deltas", StringComparison.Ordinal),
        "refinement prompt asks for corrections");
    Assert(
        OpenRouterVision.BuildSystemPrompt(new OpenRouterVision.VisionContext(false, true))
            .Contains("entire result", StringComparison.Ordinal),
        "interpretation prompt asks for the whole face");
    Assert(
        OpenRouterVision.BuildSystemPrompt(new OpenRouterVision.VisionContext(true, true))
            .Contains("stylized illustration", StringComparison.Ordinal) &&
        !OpenRouterVision.BuildSystemPrompt(new OpenRouterVision.VisionContext(true, false))
            .Contains("stylized illustration", StringComparison.Ordinal),
        "style instruction follows the detected source kind");
    Assert(
        CliVisionProvider.BuildInvocation(
                CliVisionProviderKind.Codex,
                "p.jpg",
                "s.json",
                "r.json",
                new OpenRouterVision.VisionContext(false, false))
            .StandardInput!.Contains("-3 to 3", StringComparison.Ordinal),
        "CLI prompt carries the context-specific bound");
    using (var refinementSchema = JsonDocument.Parse(
               OpenRouterVision.BuildResultSchemaJson(OpenRouterVision.VisionContext.Refinement)))
    {
        var bound = refinementSchema.RootElement.GetProperty("properties")
            .GetProperty("slider_deltas")
            .GetProperty("properties")
            .GetProperty("EFM_Nose_Width")
            .GetProperty("maximum")
            .GetDouble();
        Assert(bound == 1, "refinement schema bound");
    }
    AssertThrows<InvalidDataException>(
        () => OpenRouterVision.ParseStructuredResult(
            "test",
            "{\"confidence\":0.5,\"observations\":[],\"slider_deltas\":{" +
            string.Join(
                ",",
                OpenRouterVision.AllowedSliderKeys.Select(
                    (key, index) => $"\"{key}\":{(index == 0 ? "2.5" : "0")}")) +
            "}}",
            OpenRouterVision.VisionContext.Refinement),
        "refinement rejects an out-of-range delta");

    var deltas = string.Join(",", OpenRouterVision.AllowedSliderKeys.Select(key => $"\"{key}\":0"));
    var visionContent =
        "{\"confidence\":0.8,\"observations\":[\"balanced\"],\"slider_deltas\":{" +
        deltas +
        "}}";
    var response = JsonSerializer.Serialize(new
    {
        choices = new[] { new { message = new { content = visionContent } } }
    });
    var vision = OpenRouterVision.ParseResponse("vendor/image-model", response);
    Assert(vision.SliderDeltas.Count == 35, "vision slider schema");
    using (var schema = JsonDocument.Parse(OpenRouterVision.BuildResultSchemaJson()))
    {
        var required = schema.RootElement.GetProperty("properties")
            .GetProperty("slider_deltas")
            .GetProperty("required");
        Assert(required.GetArrayLength() == 35, "shared CLI result schema");
    }
    var codexInvocation = CliVisionProvider.BuildInvocation(
        CliVisionProviderKind.Codex,
        Path.Combine(root, "portrait.jpg"),
        Path.Combine(root, "schema.json"),
        Path.Combine(root, "result.json"));
    Assert(codexInvocation.Arguments.Contains("--image") &&
           codexInvocation.StandardInput is not null, "Codex image invocation");
    var claudeResponse = JsonSerializer.Serialize(new { result = visionContent });
    var claudeContent = CliVisionProvider.UnwrapProviderResponse(
        CliVisionProviderKind.Claude,
        claudeResponse);
    Assert(
        OpenRouterVision.ParseStructuredResult("Claude", claudeContent).SliderDeltas.Count == 35,
        "Claude response wrapper");
    var geminiResponse = JsonSerializer.Serialize(
        new { response = "```json\n" + visionContent + "\n```" });
    var geminiContent = CliVisionProvider.UnwrapProviderResponse(
        CliVisionProviderKind.Gemini,
        geminiResponse);
    Assert(
        OpenRouterVision.ParseStructuredResult(
            "Gemini",
            CliVisionProvider.ExtractJson(geminiContent)).SliderDeltas.Count == 35,
        "Gemini response wrapper");

    var dependencyList = resolved;
    var presetZip = Path.Combine(root, "preset.zip");
    var presetResult = ExportPackager.Build(new ExportRequest(
        "preset-pack",
        presetZip,
        "TestFace",
        jslot,
        preset.NifPath,
        preset.DdsPath,
        true,
        false,
        dependencyList));
    Assert(presetResult.Entries.Contains("SKSE/Plugins/CharGen/Presets/TestFace.jslot"), "preset JSlot path");
    Assert(presetResult.Entries.Contains("SKSE/Plugins/CharGen/TestFace.nif"), "preset NIF path");

    var workflowZip = Path.Combine(root, "workflow.zip");
    var workflowResult = ExportPackager.Build(new ExportRequest(
        "racemenu-export-stage",
        workflowZip,
        "PhotoFace",
        jslot,
        null,
        null,
        false,
        false,
        dependencyList,
        [
            new AppearanceChoice(
                "brows",
                "TRE_Brows_008_Alternative",
                "_TRE_Brows_008Alt_FP",
                "TRE_Brows.esp|000D92",
                "TRE_Brows.esp",
                "TRE Brows",
                ["Skyrim.esm"],
                [],
                "HDPT Type subrecord; visual confirmation still required",
                "female",
                true,
                "HeadPartsAllRacesMinusBeast",
                ["BretonRace", "NordRace"],
                true)
        ],
        "NordRace",
        "female"));
    Assert(
        workflowResult.Entries.Contains("SKSE/Plugins/CharGen/Presets/PhotoFace.jslot"),
        "RaceMenu export stage JSlot path");
    using (var zip = ZipFile.OpenRead(workflowZip))
    {
        var job = zip.GetEntry("FaceForge/racemenu-export-job.json");
        Assert(job is not null, "RaceMenu export manifest");
        Assert(
            zip.GetEntry("FaceForge/appearance-selections.json") is not null,
            "exact appearance selection manifest");
        using var reader = new StreamReader(job!.Open());
        var jobText = reader.ReadToEnd();
        // These are the paths RaceMenu actually writes and Follower Forge actually scans. Every
        // installed preset mod on this machine ships <name>.nif/.dds beside Presets\<name>.jslot.
        Assert(
            jobText.Contains("Data/SKSE/Plugins/CharGen/PhotoFace.nif", StringComparison.Ordinal),
            "RaceMenu export expected NIF");
        Assert(
            jobText.Contains("Data/SKSE/Plugins/CharGen/PhotoFace.dds", StringComparison.Ordinal),
            "RaceMenu export expected DDS");
        Assert(
            !jobText.Contains("Meshes/CharGen/Exported", StringComparison.Ordinal),
            "no invented Exported mesh path");
        Assert(
            jobText.Contains("\"targetRaceEditorId\": \"NordRace\"", StringComparison.Ordinal),
            "target race recorded");
    }
    // Re-reading a finished preset must recompute its needs from the file's own head-part
    // records, because the export-time dependency report goes stale the moment the user picks
    // different eyes or hair in RaceMenu.
    var report = PresetInspector.Inspect(Path.Combine(presets, "TestFace.jslot"), catalog);
    Assert(report.FileName == "TestFace.jslot", "report names the file");
    Assert(report.HeadParts.Count == 1, "report lists the preset's head parts");
    Assert(
        report.HeadParts[0].FormIdentifier == "Exact Brows.esp|000801" &&
        report.HeadParts[0].PluginName == "Exact Brows.esp",
        "head part plugin resolved from the form identifier");
    Assert(
        report.Dependencies.Any(item => item.PluginName == "Exact Brows.esp"),
        "the head part's own plugin is a requirement even when modNames omits it");
    Assert(
        report.Dependencies.Any(item => item.PluginName == "Missing Eyes.esp" && !item.Present),
        "a declared but uninstalled plugin is reported absent");
    Assert(!report.ShareReady, "a preset with a missing plugin is not share-ready");
    Assert(
        report.Blockers.Any(item => item.Contains("Missing Eyes.esp", StringComparison.Ordinal)),
        "the missing plugin is named as a blocker");
    Assert(report.SculptHosts.Count == 2, "sculpt hosts are reported");
    // RaceMenu writes a light plugin's head part with the 0xFE load index still embedded in the
    // identifier -- "Foo.esp|4BED40" for the record the plugin calls 000D40. Matching the string
    // as written misses every ESL head part, which is most modern eye and brow mods.
    File.WriteAllText(
        Path.Combine(presets, "LightPart.jslot"),
        """
        {
          "headParts": [
            {"formId": 4266388800, "formIdentifier": "Exact Brows.esp|4BED40", "type": 8}
          ],
          "morphs": { "custom": [{"name":"EFM_Nose_Width","value":1}] },
          "version": {"formatVersion": 3}
        }
        """);
    var lightReport = PresetInspector.Inspect(Path.Combine(presets, "LightPart.jslot"), catalog);
    Assert(
        lightReport.HeadParts.Single().FormIdentifier == "Exact Brows.esp|000D40",
        "light plugin head part is masked to its real local FormID");
    Assert(!report.HasVanillaBase, "the fixture has no vanilla CharGen base block");
    Assert(
        PresetInspector.Inspect(Path.Combine(presets, "TestFace.jslot"), null)
            .Dependencies.All(item => !item.Present),
        "without an index nothing is claimed to be present");

    Assert(
        CharGenCatalog.FindBakedHead(data, "TestFace") is { HasNif: true, HasDds: true },
        "baked head round-trip discovery");
    Assert(
        CharGenCatalog.FindBakedHead(data, "NeverSculpted") is null,
        "missing baked head is not guessed");

    var kitZip = Path.Combine(root, "kit.zip");
    var kitResult = ExportPackager.Build(new ExportRequest(
        "follower-head-kit",
        kitZip,
        "TestFace",
        jslot,
        preset.NifPath,
        preset.DdsPath,
        true,
        false,
        dependencyList));
    using (var zip = ZipFile.OpenRead(kitZip))
    {
        Assert(zip.GetEntry("FaceForge/follower-head-manifest.json") is not null, "head kit manifest");
        Assert(zip.GetEntry("dependencies.json") is not null, "head kit dependencies");
    }
    AssertThrows<InvalidOperationException>(
        () => ExportPackager.Build(new ExportRequest(
            "follower-head-kit",
            Path.Combine(root, "invalid-kit.zip"),
            "TestFace",
            jslot,
            preset.NifPath,
            preset.DdsPath,
            false,
            false,
            dependencyList)),
        "head kit rejects a cleared sculpt");

    Console.WriteLine("FaceForge.Core validation: PASS");
    Console.WriteLine($"Assertions: 71 | Presets: {catalog.Summary.PresetCount} | Plugins: {catalog.Summary.PluginCount}");
}
finally
{
    if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
}

static void Assert(bool condition, string name)
{
    if (!condition) throw new InvalidOperationException("Assertion failed: " + name);
}

static void AssertThrows<TException>(Action action, string name)
    where TException : Exception
{
    try
    {
        action();
    }
    catch (TException)
    {
        return;
    }
    throw new InvalidOperationException("Assertion failed: " + name);
}

static void WriteTes4Plugin(string path, params string[] masters)
{
    using var body = new MemoryStream();
    foreach (var master in masters)
    {
        var value = System.Text.Encoding.UTF8.GetBytes(master + "\0");
        body.Write("MAST"u8);
        body.Write(BitConverter.GetBytes((ushort)value.Length));
        body.Write(value);
        body.Write("DATA"u8);
        body.Write(BitConverter.GetBytes((ushort)8));
        body.Write(new byte[8]);
    }
    var payload = body.ToArray();
    using var file = File.Create(path);
    file.Write("TES4"u8);
    file.Write(BitConverter.GetBytes((uint)payload.Length));
    file.Write(new byte[16]);
    file.Write(payload);
}
