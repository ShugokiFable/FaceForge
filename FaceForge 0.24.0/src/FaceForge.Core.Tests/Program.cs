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

// Measures a real .tri against the installed game rather than a fixture: vertex count, morph
// count, leftover bytes (must be 0), and the displacement each morph produces at weight 1. This is
// how the estimated slider response weights get replaced with measured ones.
if (args is ["--tri", var triPath])
{
    var tri = TriFile.Read(triPath);
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        tri.Path,
        tri.VertexCount,
        tri.TriangleCount,
        MorphCount = tri.Morphs.Count,
        tri.TrailingBytes,
        // Extent of the base mesh, so a morph displacement can be read as a fraction of the head
        // rather than an abstract number.
        Size = new[] { 0, 1, 2 }.Select(axis =>
        {
            var values = Enumerable
                .Range(0, tri.VertexCount)
                .Select(vertex => tri.Vertices[(vertex * 3) + axis])
                .ToArray();
            return MathF.Round(values.Max() - values.Min(), 3);
        }),
        Morphs = tri.Morphs
            .Select(morph => new
            {
                morph.Name,
                morph.Multiplier,
                MaxDisplacement = MathF.Round(morph.MaxDisplacement(), 4)
            })
            .OrderByDescending(morph => morph.MaxDisplacement)
    }, new JsonSerializerOptions { WriteIndented = true }));
    if (tri.TrailingBytes != 0) Environment.ExitCode = 2;
    return;
}

// Reports, per head mesh, which RaceMenu sliders the installation can actually move. A slider is
// live only when its race registers it AND its morph pair exists in a .tri matching that head's
// vertex count; the second half is what catches Expressive Facegen Morphs on High Poly Head.
if (args is ["--morphs", var morphsData, ..])
{
    var race = args.Length > 2 ? args[2] : "NordRace";
    var registry = MorphRegistry.Build(morphsData);
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        Race = race,
        registry.Complete,
        registry.UnreadArchives,
        Heads = registry.Heads.Select(head =>
        {
            var available = new HashSet<string>(head.MorphNames, StringComparer.OrdinalIgnoreCase);
            var sliders = registry.SliderSets
                .Where(set => set.Sex.Equals(head.TargetSex, StringComparison.OrdinalIgnoreCase)
                    && set.Races.Contains(race, StringComparer.OrdinalIgnoreCase))
                .SelectMany(set => set.Sliders)
                .DistinctBy(slider => slider.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();
            var inert = sliders
                .Where(slider => !available.Contains(slider.NegativeMorph)
                    || !available.Contains(slider.PositiveMorph))
                .ToList();
            return new
            {
                head.ChargenTriPath,
                head.TargetSex,
                head.HighPoly,
                head.VertexCount,
                MorphCount = head.MorphNames.Count,
                Registered = sliders.Count,
                Live = sliders.Count - inert.Count,
                Inert = inert.Count,
                InertPrefixes = inert.GroupBy(slider => slider.Name.Split('_')[0])
                    .ToDictionary(group => group.Key, group => group.Count()),
                RejectedExtensions = head.Extensions
                    .Where(extension => !extension.TopologyMatches)
                    .Select(extension => new { extension.ExtensionPath, extension.Rejection })
            };
        })
    }, new JsonSerializerOptions { WriteIndented = true }));
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
            .Contains("too unreliable", StringComparison.Ordinal) &&
        OpenRouterVision.BuildUserPrompt(new OpenRouterVision.VisionContext(false, true))
            .Contains("distinctive feature relationships", StringComparison.Ordinal),
        "interpretation prompt replaces unreliable landmarks without neutralizing identity");
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
        // These are the paths RaceMenu actually writes and FollowerForge actually scans. Every
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

    // A .tri holds the base vertex positions RaceMenu sculpt indexes into, and the named morph
    // targets every EFM slider drives. The parse is a fixed layout with no length prefix on the
    // blocks, so a single wrong stride does not fail -- it silently returns the wrong geometry.
    // TrailingBytes is what makes that loud: the file must be consumed exactly.
    var triFixture = Path.Combine(root, "Fixture.tri");
    WriteTriFixture(triFixture);
    var tri = TriFile.Read(triFixture);
    Assert(tri.VertexCount == 3 && tri.TriangleCount == 1, "tri header counts");
    Assert(tri.TrailingBytes == 0, "tri parse consumes the file exactly");
    Assert(tri.Vertices[0] == 1f && tri.Vertices[4] == 5f, "tri base vertex positions");

    // nameLength counts the trailing NUL. Reading it as text length leaves one byte per morph in
    // the stream, which shifts every delta that follows.
    Assert(tri.Morphs.Count == 2 && tri.Morphs[0].Name == "TestUp", "tri morph name excludes the terminator");
    Assert(tri.FindMorph("testup") is not null, "tri morph lookup is case-insensitive");

    // Displacement at weight w is delta * multiplier * w: vertex 0 carries dx 100 at multiplier
    // 0.5, so weight 2 moves it a full unit from 1.0 to 101.0.
    var morphed = tri.ApplyMorphs(new Dictionary<string, float> { ["TestUp"] = 2f });
    Assert(MathF.Abs(morphed[0] - 101f) < 1e-3f, "tri morph applies delta * multiplier * weight");
    Assert(MathF.Abs(morphed[3] - tri.Vertices[3]) < 1e-6f, "tri morph leaves unaffected vertices alone");
    Assert(
        tri.ApplyMorphs(new Dictionary<string, float> { ["NoSuchMorph"] = 3f }).SequenceEqual(tri.Vertices),
        "tri unknown morph name is ignored");
    Assert(MathF.Abs(tri.Morphs[0].MaxDisplacement() - 50f) < 1e-3f, "tri max displacement at weight 1");

    File.WriteAllBytes(Path.Combine(root, "NotATri.tri"), new byte[128]);
    AssertThrows<InvalidDataException>(
        () => TriFile.Read(Path.Combine(root, "NotATri.tri")),
        "tri rejects a file without the FRTRI003 magic");
    File.WriteAllBytes(
        Path.Combine(root, "Truncated.tri"),
        File.ReadAllBytes(triFixture)[..96]);
    AssertThrows<InvalidDataException>(
        () => TriFile.Read(Path.Combine(root, "Truncated.tri")),
        "tri rejects a truncated file instead of reading past the end");

    // A RaceMenu slider is a name in an ini pointing at two named morphs. It appears in the menu
    // whenever a races.ini registers it, and it MOVES the face only when those morphs exist in a
    // mesh with the same vertex count as the head being worn. Those conditions are independent,
    // which is how an install ends up showing sliders that do nothing -- so the registry proves
    // the second one rather than trusting the first.
    var morphRoot = Path.Combine(root, "morphdata");
    var headDir = Path.Combine(morphRoot, "meshes", "Actors", "Character", "Character Assets");
    var pluginDir = Path.Combine(
        morphRoot, "meshes", "actors", "character", "facegenmorphs", "Fake.esp");
    var extensionDir = Path.Combine(
        morphRoot, "meshes", "actors", "character", "facegenmorphs", "Morphs", "Fake");
    Directory.CreateDirectory(headDir);
    Directory.CreateDirectory(Path.Combine(pluginDir, "sliders"));
    Directory.CreateDirectory(extensionDir);

    WriteTriFixture(Path.Combine(headDir, "FemaleHeadChargen.tri"));
    WriteMorphExtension(Path.Combine(extensionDir, "Fits.tri"), 3, ["FitsUp", "FitsDown"]);
    // Second extension on the SAME line. High Poly Head puts nine there; 0.23.0 read only the
    // first and lost the rest, which is half of why it declared working sliders dead.
    WriteMorphExtension(Path.Combine(extensionDir, "AlsoFits.tri"), 3, ["SecondUp", "SecondDown"]);
    // Same morph names a real mod would ship, built for a head this character is not wearing.
    WriteMorphExtension(Path.Combine(extensionDir, "WrongTopology.tri"), 9, ["WideUp", "WideDown"]);
    File.WriteAllText(Path.Combine(pluginDir, "morphs.ini"), """
        #Female
        extension = Actors\Character\Character Assets\FemaleHeadChargen.tri, Fake\Fits.tri, Fake\AlsoFits.tri
        extension = Actors\Character\Character Assets\FemaleHeadChargen.tri, Fake\WrongTopology.tri,
        """);
    File.WriteAllText(Path.Combine(pluginDir, "races.ini"), """
        # Determines what sliders are available for the particular race
        NordRace   = sliders\human.ini
        OrcRace    = sliders\missing.ini
        """);
    File.WriteAllText(Path.Combine(pluginDir, "sliders", "human.ini"), """
        [Female]
        Fake_Fits    = 128, Slider, FitsDown, FitsUp
        Fake_Wide    = 128, Slider, WideDown, WideUp
        Fake_Lashes  = 256, HeadPart, 179
        [Male]
        Fake_MaleOnly = 128, Slider, FitsDown, FitsUp
        """);

    var morphRegistry = MorphRegistry.Build(morphRoot);
    var femaleHead = morphRegistry.Heads.Single(item =>
        item.TargetSex == "female" && !item.HighPoly);
    Assert(femaleHead.VertexCount == 3, "morph registry reads the head vertex count");
    Assert(
        femaleHead.MorphNames.Contains("FitsUp") && femaleHead.MorphNames.Contains("TestUp"),
        "morph registry unions the head's own morphs with a matching extension");
    Assert(
        !femaleHead.MorphNames.Contains("WideUp"),
        "morph registry excludes morphs from an extension built for another vertex count");
    var rejected = femaleHead.Extensions.Single(item => !item.TopologyMatches);
    Assert(
        rejected.ExtensionPath.EndsWith("WrongTopology.tri", StringComparison.OrdinalIgnoreCase)
            && rejected.VertexCount == 9
            && rejected.Rejection is not null,
        "morph registry reports why an extension was rejected");
    Assert(
        femaleHead.Parts.Count == 4 && femaleHead.Parts[0].VertexCount == 3,
        "morph registry inspects every chargen mesh a character wears, not just the head");
    Assert(
        femaleHead.MorphNames.Contains("SecondUp"),
        "morph registry reads every extension on one line, not just the first");
    Assert(
        morphRegistry.Complete && morphRegistry.UnreadArchives.Count == 0,
        "morph registry is complete when no archive declares facegenmorphs content");

    var femaleSet = morphRegistry.SliderSets.Single(item =>
        item.Sex == "female" && item.Plugin == "Fake.esp");
    Assert(
        femaleSet.Races.SequenceEqual(["NordRace"]),
        "morph registry maps a slider ini to the races whose races.ini names it");
    Assert(
        femaleSet.Sliders.Any(item =>
            item.Name == "Fake_Fits" && item.NegativeMorph == "FitsDown" && item.PositiveMorph == "FitsUp"),
        "morph registry reads the negative and positive morph of a Slider row");
    Assert(
        femaleSet.Sliders.All(item => item.Name != "Fake_Lashes"),
        "morph registry ignores HeadPart rows, which carry no morph geometry");
    Assert(
        femaleSet.Sliders.All(item => item.Name != "Fake_MaleOnly"),
        "morph registry keeps [Female] and [Male] sections apart");
    Assert(
        morphRegistry.SliderSets.All(item => !item.IniPath.Contains("missing")),
        "morph registry skips a races.ini entry pointing at a slider ini that is not installed");

    Console.WriteLine("FaceForge.Core validation: PASS");
    Console.WriteLine($"Assertions: 96 | Presets: {catalog.Summary.PresetCount} | Plugins: {catalog.Summary.PluginCount}");
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

// A minimal but structurally real FRTRI003: 3 vertices, 1 triangle, UVs present so the reader has
// to skip both UV blocks, and two morphs so a name-length mistake shows up as a wrong second name.
static void WriteTriFixture(string path)
{
    using var file = File.Create(path);
    file.Write("FRTRI003"u8);
    foreach (var value in new uint[] { 3, 1, 0, 0, 0, 3, 1, 2, 0, 0, 0, 0, 0, 0 })
    {
        file.Write(BitConverter.GetBytes(value));
    }
    foreach (var value in new[] { 1f, 2f, 3f, 4f, 5f, 6f, 7f, 8f, 9f })   // vertices
    {
        file.Write(BitConverter.GetBytes(value));
    }
    foreach (var value in new uint[] { 0, 1, 2 })                          // triangle
    {
        file.Write(BitConverter.GetBytes(value));
    }
    foreach (var value in new[] { 0f, 0f, 0.5f, 0.5f, 1f, 1f })            // uvs
    {
        file.Write(BitConverter.GetBytes(value));
    }
    foreach (var value in new uint[] { 0, 1, 2 })                          // triangle uvs
    {
        file.Write(BitConverter.GetBytes(value));
    }

    WriteTriMorph(file, "TestUp", 0.5f, [100, 0, 0, 0, 0, 0, 0, 0, 0]);
    WriteTriMorph(file, "TestDown", 0.25f, [-40, 0, 0, 0, 0, 0, 0, 0, 0]);
}

// An extension .tri: no UVs, whatever vertex count the caller wants, and one morph per name. The
// vertex count is the point -- it is what decides whether the morphs can reach a given head.
static void WriteMorphExtension(string path, int vertexCount, string[] morphNames)
{
    using var file = File.Create(path);
    file.Write("FRTRI003"u8);
    foreach (var value in new uint[]
             { (uint)vertexCount, 0, 0, 0, 0, 0, 0, (uint)morphNames.Length, 0, 0, 0, 0, 0, 0 })
    {
        file.Write(BitConverter.GetBytes(value));
    }
    for (var index = 0; index < vertexCount * 3; index++) file.Write(BitConverter.GetBytes((float)index));
    foreach (var name in morphNames)
    {
        WriteTriMorph(file, name, 1f, new short[vertexCount * 3]);
    }
}

static void WriteTriMorph(Stream file, string name, float multiplier, short[] deltas)
{
    var text = System.Text.Encoding.ASCII.GetBytes(name + "\0");
    file.Write(BitConverter.GetBytes((uint)text.Length));
    file.Write(text);
    file.Write(BitConverter.GetBytes(multiplier));
    foreach (var delta in deltas) file.Write(BitConverter.GetBytes(delta));
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
