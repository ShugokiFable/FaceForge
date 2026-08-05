namespace FaceForge.Core;

public sealed class EnvironmentCatalog
{
    private static readonly HashSet<string> RelevantExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".nif", ".dds", ".tri", ".bsa", ".jslot", ".esp", ".esm", ".esl"
    };

    private readonly Dictionary<string, string?> _plugins;
    private readonly Dictionary<string, int> _sourceBsaCounts;
    private readonly Dictionary<string, int> _sourceAssetCounts;

    private EnvironmentCatalog(
        EnvironmentSummary summary,
        Dictionary<string, string?> plugins,
        Dictionary<string, int> sourceBsaCounts,
        Dictionary<string, int> sourceAssetCounts,
        SkyrimRecordIndex records)
    {
        Summary = summary;
        Records = records;
        _plugins = plugins;
        _sourceBsaCounts = sourceBsaCounts;
        _sourceAssetCounts = sourceAssetCounts;
        PresetsById = summary.Presets.ToDictionary(item => item.Id, StringComparer.OrdinalIgnoreCase);
    }

    public EnvironmentSummary Summary { get; }

    /// <summary>Kept so a later on-demand plugin parse can resolve races without rebuilding it.</summary>
    public SkyrimRecordIndex Records { get; }
    public IReadOnlyDictionary<string, IndexedPreset> PresetsById { get; }

    public static EnvironmentCatalog Build(
        string gameDataPath,
        string detectionMethod = "manual selection",
        bool autoDetected = false,
        CancellationToken cancellationToken = default)
    {
        var data = Path.GetFullPath(gameDataPath);
        if (!Directory.Exists(data))
            throw new DirectoryNotFoundException($"Skyrim Data folder not found: {data}");

        var plugins = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        var bsaCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var assetCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var sourceMods = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var sourcePlugins = new Dictionary<string, HashSet<string>>(
            StringComparer.OrdinalIgnoreCase);
        var appearance = new Dictionary<string, AppearanceAccumulator>(
            StringComparer.OrdinalIgnoreCase);
        var relevantAssets = 0;
        var bsaCount = 0;
        var manifestPath = Path.Combine(data, DeploymentManifestReader.FileName);
        DeploymentHeader? header = null;

        if (File.Exists(manifestPath))
        {
            header = DeploymentManifestReader.ReadHeader(manifestPath);
            foreach (var entry in DeploymentManifestReader.ReadFiles(manifestPath, cancellationToken))
            {
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
                    plugins[Path.GetFileName(entry.RelPath)] = entry.SourceMod;
                    if (!sourcePlugins.TryGetValue(entry.SourceMod, out var supplied))
                    {
                        supplied = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                        sourcePlugins[entry.SourceMod] = supplied;
                    }
                    supplied.Add(Path.GetFileName(entry.RelPath));
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
        }

        foreach (var pluginPath in Directory.EnumerateFiles(data, "*.*", SearchOption.TopDirectoryOnly)
                     .Where(path => IsPlugin(Path.GetExtension(path))))
        {
            plugins.TryAdd(Path.GetFileName(pluginPath), null);
        }

        var presets = CharGenCatalog.Discover(data);
        var records = SkyrimRecordIndex.Build(data);
        var recommendations = BuildAppearanceRecommendations(
            data,
            appearance.Values,
            sourcePlugins,
            bsaCounts,
            plugins);
        var choices = BuildAppearanceChoices(
            data,
            appearance.Values,
            sourcePlugins,
            plugins,
            records);
        var summary = new EnvironmentSummary(
            data,
            detectionMethod,
            autoDetected,
            File.Exists(manifestPath) ? manifestPath : null,
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
            MorphRegistry.Build(data));
        return new EnvironmentCatalog(summary, plugins, bsaCounts, assetCounts, records);
    }

    /// <summary>
    /// Parses one plugin's head parts on demand. The main index only scans plugins whose source
    /// mod deployed loose face assets, so a mod shipping its meshes inside a BSA contributes no
    /// records -- which shows up as an unresolved head part when a preset names one.
    /// </summary>
    public IReadOnlyList<AppearanceChoice> ReadHeadPartsFrom(string pluginName)
    {
        var path = Path.Combine(Summary.GameDataPath, pluginName);
        if (!File.Exists(path)) return [];
        var masters = PluginHeaderReader.ReadMasters(path);
        var missing = masters
            .Where(master => !_plugins.ContainsKey(master) &&
                             !File.Exists(Path.Combine(Summary.GameDataPath, master)))
            .ToArray();
        return HeadPartCatalog.Read(
            path,
            _plugins.GetValueOrDefault(pluginName),
            masters,
            missing,
            Records);
    }

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
        string data,
        IEnumerable<AppearanceAccumulator> accumulators,
        IReadOnlyDictionary<string, HashSet<string>> sourcePlugins,
        IReadOnlyDictionary<string, string?> deployedPlugins,
        SkyrimRecordIndex records)
    {
        // Which plugins to parse: the installed base game, so vanilla hair/eyes/brows are
        // selectable at all, plus every mod that deployed a face asset. What each record *is* is
        // then decided by its own HDPT Type subrecord, so a mod's asset folder layout no longer
        // filters its records out.
        var pluginSources = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (var name in SkyrimRecordIndex.PresentBaseGamePlugins(data))
            pluginSources[name] = "Skyrim base game";
        foreach (var sourceMod in accumulators
                     .Select(item => item.SourceMod)
                     .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!sourcePlugins.TryGetValue(sourceMod, out var supplied)) continue;
            foreach (var pluginName in supplied) pluginSources[pluginName] = sourceMod;
        }

        var choices = new List<AppearanceChoice>();
        foreach (var (pluginName, sourceMod) in pluginSources)
        {
            var path = Path.Combine(data, pluginName);
            if (!File.Exists(path)) continue;
            var masters = PluginHeaderReader.ReadMasters(path);
            var missing = masters
                .Where(master => !deployedPlugins.ContainsKey(master) &&
                                 !File.Exists(Path.Combine(data, master)))
                .ToArray();
            choices.AddRange(
                HeadPartCatalog.Read(path, sourceMod, masters, missing, records));
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
        string data,
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
                    var path = Path.Combine(data, name);
                    var masters = File.Exists(path)
                        ? PluginHeaderReader.ReadMasters(path)
                        : [];
                    var missing = masters
                        .Where(master => !deployedPlugins.ContainsKey(master) &&
                                         !File.Exists(Path.Combine(data, master)))
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
