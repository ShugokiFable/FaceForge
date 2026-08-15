using System.Text.RegularExpressions;

namespace FaceForge.Core;

/// <summary>
/// Reads a Mod Organizer 2 instance the way the game sees it, so FaceForge can index an MO2 setup
/// even though MO2 never deploys anything into the game Data folder.
///
/// MO2 keeps every mod in its own folder under <c>&lt;base&gt;\mods\&lt;ModName&gt;</c> and, at launch,
/// overlays those folders on top of the real game Data folder through a virtual file system, in the
/// priority order recorded by the active profile. Nothing on disk represents the merged result, so
/// this class reconstructs it: it reads the profile's mod list and plugin list, then walks the
/// enabled mod folders (lowest priority first, so higher priority wins) and the overwrite folder to
/// build the winner map that <see cref="ResolvedDataView"/> serves to the catalog readers.
/// </summary>
public static partial class Mo2Environment
{
    private const string BaseGameSource = "Skyrim base game";
    private const string OverwriteSource = "Overwrite";

    /// <summary>Base masters are always active whether or not the profile lists them.</summary>
    private static readonly string[] ImplicitActivePlugins =
    [
        "Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm",
        "SkyrimVR.esm"
    ];

    public sealed record Mo2Layout(
        string BaseDir,
        string ModsPath,
        string ProfilesDir,
        string OverwriteDir,
        string? GameDataPath,
        IReadOnlyList<string> Profiles);

    public sealed record Mo2Overlay(
        ResolvedDataView View,
        IReadOnlySet<string> ActivePlugins,
        int EnabledModCount,
        string GameDataPath,
        string Profile,
        string ModsPath,
        string DetectionMethod);

    /// <summary>
    /// Works out the folders around an MO2 mods directory and lists the profiles the user can pick.
    /// Accepts either the mods folder itself or the instance base folder that contains it.
    /// </summary>
    public static Mo2Layout Inspect(string modsPathOrBase)
    {
        if (string.IsNullOrWhiteSpace(modsPathOrBase))
            throw new ArgumentException("Provide the MO2 mods folder.", nameof(modsPathOrBase));

        var input = Path.GetFullPath(modsPathOrBase.Trim().Trim('"'));
        string modsPath;
        string baseDir;
        if (Path.GetFileName(input).Equals("mods", StringComparison.OrdinalIgnoreCase) &&
            Directory.Exists(input))
        {
            modsPath = input;
            baseDir = Path.GetDirectoryName(input)!;
        }
        else if (Directory.Exists(Path.Combine(input, "mods")))
        {
            baseDir = input;
            modsPath = Path.Combine(input, "mods");
        }
        else
        {
            // Fall back to treating the input as the mods folder even if unconventionally named.
            modsPath = input;
            baseDir = Path.GetDirectoryName(input) ?? input;
        }

        var profilesDir = Path.Combine(baseDir, "profiles");
        var overwriteDir = Path.Combine(baseDir, "overwrite");
        var gameDataPath = ResolveGameDataPath(baseDir);

        var profiles = new List<string>();
        if (Directory.Exists(profilesDir))
        {
            foreach (var dir in Directory.EnumerateDirectories(profilesDir))
            {
                var name = Path.GetFileName(dir);
                // MO2 hides its own helper folders (_autosaves, _backups); a real profile also always
                // carries a modlist.txt.
                if (name.StartsWith('_')) continue;
                if (File.Exists(Path.Combine(dir, "modlist.txt")))
                    profiles.Add(name);
            }
            profiles.Sort(StringComparer.OrdinalIgnoreCase);
        }

        return new Mo2Layout(baseDir, modsPath, profilesDir, overwriteDir, gameDataPath, profiles);
    }

    /// <summary>
    /// Reads <c>ModOrganizer.ini</c> for the managed game path -- the reliable source, since a single
    /// MO2 instance manages exactly one game install (here, Skyrim VR). Falls back to FaceForge's own
    /// Skyrim discovery, then returns null so the caller can surface a clear error.
    /// </summary>
    private static string? ResolveGameDataPath(string baseDir)
    {
        var ini = Path.Combine(baseDir, "ModOrganizer.ini");
        if (File.Exists(ini))
        {
            foreach (var raw in File.ReadLines(ini))
            {
                var line = raw.Trim();
                if (!line.StartsWith("gamePath", StringComparison.OrdinalIgnoreCase)) continue;
                var equals = line.IndexOf('=');
                if (equals < 0) continue;
                var value = line[(equals + 1)..].Trim();
                var match = ByteArrayRegex().Match(value);
                if (match.Success) value = match.Groups["path"].Value;
                value = value.Trim().Trim('"').Replace(@"\\", @"\");
                if (string.IsNullOrWhiteSpace(value)) continue;
                var data = Path.Combine(value, "Data");
                if (File.Exists(Path.Combine(data, "Skyrim.esm"))) return Path.GetFullPath(data);
                if (File.Exists(Path.Combine(value, "Skyrim.esm"))) return Path.GetFullPath(value);
            }
        }

        var discovered = EnvironmentDiscovery.TryDiscover();
        return discovered?.GameDataPath;
    }

    /// <summary>
    /// Builds the merged overlay for one profile: which mods are enabled and in what order, which
    /// plugins are active, and the winner map that resolves every relevant relative path to the file
    /// the highest priority mod actually provides.
    /// </summary>
    public static Mo2Overlay BuildOverlay(
        string modsPathOrBase,
        string profile,
        CancellationToken cancellationToken = default)
    {
        var layout = Inspect(modsPathOrBase);
        if (string.IsNullOrWhiteSpace(profile))
            throw new ArgumentException("Choose an MO2 profile.", nameof(profile));
        var profileDir = Path.Combine(layout.ProfilesDir, profile);
        if (!Directory.Exists(profileDir))
            throw new DirectoryNotFoundException($"MO2 profile not found: {profileDir}");
        if (layout.GameDataPath is null || !File.Exists(Path.Combine(layout.GameDataPath, "Skyrim.esm")))
            throw new DirectoryNotFoundException(
                "Could not locate the base game Data folder for this MO2 instance. "
                + "Check that ModOrganizer.ini has a valid gamePath.");

        var enabledTopFirst = ReadEnabledMods(Path.Combine(profileDir, "modlist.txt"));
        var activePlugins = ReadActivePlugins(profileDir);

        // Layer lowest priority first so higher priority assignments overwrite. Base game is the floor,
        // the profile's mods stack on top from the bottom of the list upward (MO2 lists highest
        // priority first), and the overwrite folder is the ceiling.
        var map = new Dictionary<string, ResolvedDataView.Entry>(StringComparer.OrdinalIgnoreCase);
        ScanLayer(map, layout.GameDataPath, BaseGameSource, cancellationToken);

        var enabledModCount = 0;
        foreach (var mod in Enumerable.Reverse(enabledTopFirst.ToList()))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var modDir = Path.Combine(layout.ModsPath, mod);
            if (!Directory.Exists(modDir)) continue;
            enabledModCount++;
            ScanLayer(map, modDir, mod, cancellationToken);
        }

        if (Directory.Exists(layout.OverwriteDir))
            ScanLayer(map, layout.OverwriteDir, OverwriteSource, cancellationToken);

        var writeRoot = Directory.Exists(layout.OverwriteDir)
            ? layout.OverwriteDir
            : layout.GameDataPath;
        var view = ResolvedDataView.Virtual(
            map.Values,
            displayRoot: $"{layout.ModsPath}  (MO2 profile: {profile})",
            baseGameDataPath: layout.GameDataPath,
            writeRoot: writeRoot);

        return new Mo2Overlay(
            view,
            activePlugins,
            enabledModCount,
            layout.GameDataPath,
            profile,
            layout.ModsPath,
            $"Mod Organizer 2 · profile \"{profile}\"");
    }

    private static void ScanLayer(
        Dictionary<string, ResolvedDataView.Entry> map,
        string root,
        string source,
        CancellationToken cancellationToken)
    {
        if (!Directory.Exists(root)) return;
        var options = new EnumerationOptions
        {
            RecurseSubdirectories = true,
            IgnoreInaccessible = true,
            AttributesToSkip = FileAttributes.ReparsePoint
        };

        var seen = 0;
        IEnumerable<string> files;
        try { files = Directory.EnumerateFiles(root, "*", options); }
        catch { return; }

        foreach (var abs in files)
        {
            if (++seen % 4096 == 0) cancellationToken.ThrowIfCancellationRequested();
            string rel;
            try { rel = Path.GetRelativePath(root, abs); }
            catch { continue; }
            if (!IsRelevant(rel)) continue;
            map[rel.ToLowerInvariant()] = new ResolvedDataView.Entry(rel, abs, source);
        }
    }

    /// <summary>
    /// The overlay only needs the files FaceForge actually reads: plugins, archives, RaceMenu presets,
    /// facegenmorphs registration data, and appearance meshes/textures/morphs. Everything else (script
    /// sources, unrelated textures, SKSE logs) is skipped so a large modlist stays cheap to index.
    /// </summary>
    private static bool IsRelevant(string relPath)
    {
        var lower = relPath.Replace('/', '\\').ToLowerInvariant();
        var extension = Path.GetExtension(lower);
        if (extension is ".esp" or ".esm" or ".esl" or ".bsa" or ".jslot") return true;

        var probe = "\\" + lower;
        if (probe.Contains(@"\skse\plugins\chargen\", StringComparison.Ordinal)) return true;
        if (probe.Contains(@"\actors\character\facegenmorphs\", StringComparison.Ordinal)) return true;

        if (extension is ".nif" or ".dds" or ".tri")
        {
            return probe.Contains(@"\actors\character\", StringComparison.Ordinal) ||
                   probe.Contains(@"\character assets\", StringComparison.Ordinal) ||
                   probe.Contains(@"\kl\high poly head", StringComparison.Ordinal);
        }
        return false;
    }

    /// <summary>
    /// Enabled mod folder names from modlist.txt, highest priority first (the file's own order).
    /// Disabled ("-") entries, separators, and non-mod markers are dropped.
    /// </summary>
    private static IReadOnlyList<string> ReadEnabledMods(string modlistPath)
    {
        var mods = new List<string>();
        if (!File.Exists(modlistPath)) return mods;
        foreach (var raw in File.ReadLines(modlistPath))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line[0] == '#') continue;
            if (line[0] != '+') continue; // '-' disabled, '*' unmanaged/DLC marker: neither is a mod folder
            var name = line[1..].Trim();
            if (name.Length == 0) continue;
            if (name.EndsWith("_separator", StringComparison.OrdinalIgnoreCase)) continue;
            mods.Add(name);
        }
        return mods;
    }

    /// <summary>
    /// The active plugin set the game would load. plugins.txt is authoritative (entries are prefixed
    /// with '*' when active); loadorder.txt is the fallback when plugins.txt is absent. Base masters
    /// are always treated as active.
    /// </summary>
    private static IReadOnlySet<string> ReadActivePlugins(string profileDir)
    {
        var active = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var pluginsTxt = Path.Combine(profileDir, "plugins.txt");
        var foundStarred = false;
        if (File.Exists(pluginsTxt))
        {
            foreach (var raw in File.ReadLines(pluginsTxt))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line[0] == '#') continue;
                if (line[0] != '*') continue;
                var name = line[1..].Trim();
                if (name.Length == 0) continue;
                active.Add(name);
                foundStarred = true;
            }
        }

        if (!foundStarred)
        {
            var loadOrder = Path.Combine(profileDir, "loadorder.txt");
            if (File.Exists(loadOrder))
            {
                foreach (var raw in File.ReadLines(loadOrder))
                {
                    var line = raw.Trim();
                    if (line.Length == 0 || line[0] == '#') continue;
                    active.Add(line);
                }
            }
        }

        foreach (var master in ImplicitActivePlugins) active.Add(master);
        return active;
    }

    [GeneratedRegex(@"@ByteArray\((?<path>.*)\)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ByteArrayRegex();
}
