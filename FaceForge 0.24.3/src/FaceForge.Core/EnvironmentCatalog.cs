namespace FaceForge.Core;

public sealed class EnvironmentCatalog
{
    private static readonly HashSet<string> RelevantExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".nif", ".dds", ".tri", ".bsa", ".jslot", ".esp", ".esm", ".esl"
    };

    private readonly ResolvedDataView _view;
    private readonly Dictionary<string, string?> _plugins;
    private readonly Dictionary<string, int> _sourceBsaCounts;
    private readonly Dictionary<string, int> _sourceAssetCounts;

    private EnvironmentCatalog(
        ResolvedDataView view,
        EnvironmentSummary summary,
        Dictionary<string, string?> plugins,
        Dictionary<string, int> sourceBsaCounts,
        Dictionary<string, int> sourceAssetCounts,
        SkyrimRecordIndex records)
    {
        _view = view;
        Summary = summary;
        Records = records;
        _plugins = plugins;
        _sourceBsaCounts = sourceBsaCounts;
        _sourceAssetCounts = sourceAssetCounts;
        PresetsById = summary.Presets.ToDictionary(item => item.Id, StringComparer.OrdinalIgnoreCase);
    }

    public EnvironmentSummary Summary { get; }

    /// <summary>The resolved Data view this catalog was built from (physical folder or MO2 overlay).</summary>
    public ResolvedDataView View => _view;

    private BsaMorphIndex? _bsaMorphs;

    /// <summary>
    /// Morphs packed inside .bsa archives (e.g. High Poly Head's EFM set). Built on first use because
    /// it opens archives, and reused across the many renders an "Analyze &amp; improve" pass performs.
    /// </summary>
    public BsaMorphIndex BsaMorphs => _bsaMorphs ??= BsaMorphIndex.Build(_view);

    /// <summary>Kept so a later on-demand plugin parse can resolve races without rebuilding it.</summary>
    public SkyrimRecordIndex Records { get; }
    public IReadOnlyDictionary<string, IndexedPreset> PresetsById { get; }

    /// <summary>Builds the catalog from a real Skyrim Data folder (a direct install or Vortex deployment).</summary>
    public static EnvironmentCatalog Build(
        string gameDataPath,
        string detectionMethod = "manual selection",
        bool autoDetected = false,
        CancellationToken cancellationToken = default)
    {
        var data = Path.GetFullPath(gameDataPath);
        if (!Directory.Exists(data))
            throw new DirectoryNotFoundException($"Skyrim Data folder not found: {data}");

        var view = ResolvedDataView.Physical(data);
        var manifestPath = Path.Combine(data, DeploymentManifestReader.FileName);
        var hasManifest = File.Exists(manifestPath);
        var header = hasManifest ? DeploymentManifestReader.ReadHeader(manifestPath) : null;
        var entries = hasManifest
            ? DeploymentManifestReader.ReadFiles(manifestPath, cancellationToken)
            : Enumerable.Empty<DeploymentEntry>();

        return BuildCore(
            view,
            entries,
            header,
            hasManifest ? manifestPath : null,
            detectionMethod,
            autoDetected,
            isPluginActive: null,
            cancellationToken);
    }

    /// <summary>
    /// Builds the catalog from a Mod Organizer 2 profile. MO2 deploys nothing to the game Data folder,
    /// so the overlay's winner map stands in for a deployment manifest: each winning file becomes a
    /// synthetic entry, and only plugins the profile has active are treated as installed.
    /// </summary>
    public static EnvironmentCatalog BuildFromMo2(
        Mo2Environment.Mo2Overlay overlay,
        CancellationToken cancellationToken = default)
    {
        var entries = overlay.View.Entries
            .Select(entry => new DeploymentEntry(entry.RelPath, entry.SourceMod, 0));
        var header = new DeploymentHeader(
            "Mod Organizer 2", "skyrimse", overlay.ModsPath, overlay.GameDataPath, 0);

        return BuildCore(
            overlay.View,
            entries,
            header,
            manifestPath: null,
            overlay.DetectionMethod,
            autoDetected: false,
            isPluginActive: overlay.ActivePlugins.Contains,
            cancellationToken);
    }

    private static EnvironmentCatalog BuildCore(
        ResolvedDataView view,
        IEnumerable<DeploymentEntry> entries,
        DeploymentHeader? header,
        string? manifestPath,
        string detectionMethod,
        bool autoDetected,
        Func<string, bool>? isPluginActive,
        CancellationToken cancellationToken)
    {
        bool IsActive(string pluginName) => isPluginActive is null || isPluginActive(pluginName);

        var plugins = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        var bsaCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var assetCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var sourceMods = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var sourcePlugins = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        var appearance = new Dictionary<string, AppearanceAccumulator>(StringComparer.OrdinalIgnoreCase);
        var relevantAssets = 0;
        var bsaCount = 0;

        foreach (var entry in entries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            sourceMods.Add(entry.SourceMod);
            var extension = Path.GetExtension(entry.RelPath);
            if (RelevantExtensions.Contains(extension))
            {
                relevantAssets++;
                Increment(assetCounts, entry.SourceMod);
            }
            if (extension.Equals(".bsa", StringComparison.OrdinalIgnoreCase))
            {
                bsaCount++;
                Increment(bsaCounts, entry.SourceMod);
            }
            if (!entry.RelPath.Contains('\\') && IsPlugin(extension))
            {
                var pluginName = Path.GetFileName(entry.RelPath);
                if (IsActive(pluginName))
                {
                    plugins[pluginName] = entry.SourceMod;
                    if (!sourcePlugins.TryGetValue(entry.SourceMod, out var supplied))
                    {
                        supplied = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                        sourcePlugins[entry.SourceMod] = supplied;
                    }
                    supplied.Add(pluginName);
                }
            }
            if (TryGetAppearanceCategory(entry.RelPath, out var category))
            {
                var key = category + "\0" + entry.SourceMod;
                if (!appearance.TryGetValue(key, out var accumulator))
                {
                    accumulator = new AppearanceAccumulator(category, entry.SourceMod);
                    appearance[key] = accumulator;
                }
                accumulator.Add(entry.RelPath);
            }
        }

        foreach (var (relPath, _) in view.Files("", "*", recursive: false))
        {
            if (!IsPlugin(Path.GetExtension(relPath))) continue;
            var pluginName = Path.GetFileName(relPath);
            if (IsActive(pluginName)) plugins.TryAdd(pluginName, null);
        }

        var presets = CharGenCatalog.Discover(view);
        var records = SkyrimRecordIndex.Build(view.BaseGameDataPath);
        var recommendations = BuildAppearanceRecommendations(
            view, appearance.Values, sourcePlugins, bsaCounts, plugins);
        var choices = BuildAppearanceChoices(view, plugins, records, cancellationToken);
        var summary = new EnvironmentSummary(
            view.DisplayRoot,
            detectionMethod,
            autoDetected,
            manifestPath,
            header?.StagingPath,
            header?.DeploymentTimeUtcMs ?? 0,
            sourceMods.Count,
            plugins.Count,
            relevantAssets,
            bsaCount,
            presets.Count,
            presets,
            recommendations,
            choices,
            records.PlayableRaces,
            MorphRegistry.Build(view));
        return new EnvironmentCatalog(view, summary, plugins, bsaCounts, assetCounts, records);
    }

    /// <summary>
    /// Parses one plugin's head parts on demand. The main index only scans plugins whose source
    /// mod deployed loose face assets, so a mod shipping its meshes inside a BSA contributes no
    /// records -- which shows up as an unresolved head part when a preset names one.
    /// </summary>
    public IReadOnlyList<AppearanceChoice> ReadHeadPartsFrom(string pluginName)
    {
        if (!_view.TryResolve(pluginName, out var path)) return [];
        var masters = PluginHeaderReader.ReadMasters(path);
        var missing = masters
            .Where(master => !_plugins.ContainsKey(master) && !_view.Exists(master))
            .ToArray();
        return HeadPartCatalog.Read(
            path,
            _plugins.GetValueOrDefault(pluginName),
            masters,
            missing,
            Records);
    }

    /// <summary>Finds a preset whose CharGen NIF/DDS Skyrim has already baked, resolved through this view.</summary>
    public IndexedPreset? FindBakedHead(string name) => CharGenCatalog.FindBakedHead(_view, name);

    public IReadOnlyList<PluginProvider> ResolveDependencies(IEnumerable<string> requiredPlugins)
    {
        return requiredPlugins
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .Select(name =>
            {
                var baseGame = IsBaseGame(name);
                var present = _plugins.TryGetValue(name, out var sourceMod);
                if (baseGame && present && sourceMod is null) sourceMod = "Skyrim base game";
                var sourceKey = sourceMod ?? "";
                return new PluginProvider(
                    name,
                    sourceMod,
                    present,
                    baseGame,
                    _sourceBsaCounts.GetValueOrDefault(sourceKey),
                    _sourceAssetCounts.GetValueOrDefault(sourceKey));
            })
            .ToList();
    }

    private static void Increment(Dictionary<string, int> values, string key) =>
        values[key] = values.GetValueOrDefault(key) + 1;

    private static bool IsPlugin(string extension) =>
        extension.Equals(".esp", StringComparison.OrdinalIgnoreCase) ||
        extension.Equals(".esm", StringComparison.OrdinalIgnoreCase) ||
        extension.Equals(".esl", StringComparison.OrdinalIgnoreCase);

    private static bool IsBaseGame(string name) =>
        name.Equals("Skyrim.esm", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("Update.esm", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("Dawnguard.esm", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("HearthFires.esm", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("Dragonborn.esm", StringComparison.OrdinalIgnoreCase);

    private static bool TryGetAppearanceCategory(string relativePath, out string category)
    {
        category = "";
        var extension = Path.GetExtension(relativePath);
        if (!extension.Equals(".nif", StringComparison.OrdinalIgnoreCase) &&
            !extension.Equals(".dds", StringComparison.OrdinalIgnoreCase) &&
            !extension.Equals(".tri", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var normalized = "\\" + relativePath.Replace('/', '\\').ToLowerInvariant();
        var file = Path.GetFileNameWithoutExtension(relativePath).ToLowerInvariant();
        if (!normalized.Contains(@"\actors\character\") &&
            !normalized.Contains(@"\character assets\"))
        {
            return false;
        }

        if (normalized.Contains(@"\brows\") ||
            (file.Contains("brow", StringComparison.Ordinal) &&
             !file.Contains("brown", StringComparison.Ordinal)))
            category = "brows";
        else if (normalized.Contains(@"\eyes\") ||
                 file.StartsWith("eye", StringComparison.Ordinal) ||
                 file.Contains("eyes", StringComparison.Ordinal))
            category = "eyes";
        else if (normalized.Contains(@"\hair\") || normalized.Contains(@"\hairs\"))
            category = "hair";
        return category.Length > 0;
    }

    private static IReadOnlyList<AppearanceChoice> BuildAppearanceChoices(
        ResolvedDataView view,
        IReadOnlyDictionary<string, string?> deployedPlugins,
        SkyrimRecordIndex records,
        CancellationToken cancellationToken)
    {
        // Which plugins to parse: every present/active plugin that actually defines HDPT records,
        // detected by a cheap top-group scan (PluginHeaderReader.ContainsHeadParts). This replaces
        // the old heuristic of only parsing plugins whose source mod deployed a loose face asset
        // under actors\character -- that missed hair packs like KS Hairdos, whose meshes live in a
        // custom meshes\ folder or inside a BSA, even though the plugin's HDPT records are right
        // there. What each record *is* is still decided by its own HDPT Type subrecord.
        // The HDPT presence check is read-only file IO, so it parallelises across a large load order.
        // The actual parse stays serial: HeadPartCatalog.Read mutates the shared record index.
        var candidates = deployedPlugins
            .AsParallel()
            .WithCancellation(cancellationToken)
            .Where(pair => view.TryResolve(pair.Key, out var path) &&
                           PluginHeaderReader.ContainsHeadParts(path))
            .Select(pair => pair.Key)
            .ToArray();

        var choices = new List<AppearanceChoice>();
        foreach (var pluginName in candidates)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!view.TryResolve(pluginName, out var path)) continue;
            var sourceMod = deployedPlugins[pluginName];
            var effectiveSource = sourceMod ?? (IsBaseGame(pluginName) ? "Skyrim base game" : null);
            var masters = PluginHeaderReader.ReadMasters(path);
            var missing = masters
                .Where(master => !deployedPlugins.ContainsKey(master) && !view.Exists(master))
                .ToArray();
            choices.AddRange(
                HeadPartCatalog.Read(path, effectiveSource, masters, missing, records));
        }

        return choices
            .GroupBy(
                item => item.Category + "\0" + item.FormIdentifier,
                StringComparer.OrdinalIgnoreCase)
            .Select(group => group
                .OrderBy(item => item.MissingMasters.Count)
                .ThenBy(item => item.PluginName, StringComparer.OrdinalIgnoreCase)
                .First())
            .OrderBy(item => item.Category, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.FormIdentifier, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static IReadOnlyList<AppearanceRecommendation> BuildAppearanceRecommendations(
        ResolvedDataView view,
        IEnumerable<AppearanceAccumulator> accumulators,
        IReadOnlyDictionary<string, HashSet<string>> sourcePlugins,
        IReadOnlyDictionary<string, int> bsaCounts,
        IReadOnlyDictionary<string, string?> deployedPlugins)
    {
        var results = new List<AppearanceRecommendation>();
        foreach (var accumulator in accumulators)
        {
            var supplied = sourcePlugins.GetValueOrDefault(accumulator.SourceMod) ??
                           new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var requirements = supplied
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .Take(12)
                .Select(name =>
                {
                    var masters = view.TryResolve(name, out var path)
                        ? PluginHeaderReader.ReadMasters(path)
                        : [];
                    var missing = masters
                        .Where(master => !deployedPlugins.ContainsKey(master) && !view.Exists(master))
                        .ToArray();
                    return new AppearancePluginRequirement(name, masters, missing);
                })
                .ToArray();
            var notes = new List<string>();
            if (accumulator.EvidencePaths.Any(path =>
                    path.Contains(
                        @"KL\High Poly Head",
                        StringComparison.OrdinalIgnoreCase)))
            {
                notes.Add("High Poly Head asset path detected");
            }
            if (requirements.Length == 0)
                notes.Add("Texture/mesh replacer; no supplying plugin detected");

            var score = Math.Min(
                99,
                45 +
                (int)Math.Round(Math.Log2(accumulator.AssetCount + 1) * 8) +
                (requirements.Length > 0 ? 8 : 0) +
                (bsaCounts.GetValueOrDefault(accumulator.SourceMod) > 0 ? 3 : 0) +
                (IsCategoryNamed(accumulator.SourceMod, accumulator.Category) ? 12 : 0));
            results.Add(new AppearanceRecommendation(
                accumulator.Category,
                accumulator.SourceMod,
                score,
                accumulator.AssetCount,
                bsaCounts.GetValueOrDefault(accumulator.SourceMod),
                accumulator.EvidencePaths
                    .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
                    .Take(4)
                    .ToArray(),
                requirements,
                notes));
        }

        return results
            .GroupBy(item => item.Category, StringComparer.OrdinalIgnoreCase)
            .SelectMany(group => group
                .OrderByDescending(item => IsCategoryNamed(item.SourceMod, item.Category))
                .ThenByDescending(item => item.ConfidenceScore)
                .ThenByDescending(item => item.AssetCount)
                .ThenBy(item => item.SourceMod, StringComparer.OrdinalIgnoreCase)
                .Take(5))
            .OrderBy(item => item.Category, StringComparer.OrdinalIgnoreCase)
            .ThenByDescending(item => item.ConfidenceScore)
            .ToArray();
    }

    private static bool IsCategoryNamed(string sourceMod, string category)
    {
        return category switch
        {
            "brows" => sourceMod.Contains("brow", StringComparison.OrdinalIgnoreCase),
            "eyes" => sourceMod.Contains("eye", StringComparison.OrdinalIgnoreCase),
            "hair" => sourceMod.Contains("hair", StringComparison.OrdinalIgnoreCase),
            _ => false
        };
    }

    private sealed class AppearanceAccumulator(string category, string sourceMod)
    {
        private readonly HashSet<string> _paths = new(StringComparer.OrdinalIgnoreCase);

        public string Category { get; } = category;
        public string SourceMod { get; } = sourceMod;
        public int AssetCount { get; private set; }
        public IReadOnlyCollection<string> EvidencePaths => _paths;

        public void Add(string path)
        {
            AssetCount++;
            if (_paths.Count < 16) _paths.Add(path);
        }
    }
}
