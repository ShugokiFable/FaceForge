namespace FaceForge.Core;

/// <summary>
/// The effective "Data folder" FaceForge indexes, abstracted so the same readers work over two very
/// different layouts:
///
///   * <b>Physical</b> -- a real Skyrim Data folder (a direct install or a Vortex deployment). Every
///     operation delegates straight to the filesystem rooted at that folder, so behaviour is byte
///     for byte what it was before this abstraction existed.
///
///   * <b>Virtual</b> -- a Mod Organizer 2 profile. MO2 never deploys files into the game Data
///     folder; it overlays each enabled mod folder at runtime through a virtual file system. There
///     is no single folder on disk that represents what the game sees, so this view synthesises one
///     from a pre-computed winner map: relative path -> the absolute path of the highest priority
///     mod that provides it. See <see cref="Mo2Environment"/> for how that map is built.
///
/// Only the handful of filesystem shapes the catalog readers actually need are exposed, expressed in
/// terms of paths relative to the (real or virtual) Data root.
/// </summary>
public sealed class ResolvedDataView
{
    /// <summary>One winning file in a virtual overlay.</summary>
    public sealed record Entry(string RelPath, string AbsolutePath, string SourceMod);

    private readonly string? _physicalRoot;
    private readonly Dictionary<string, Entry> _map;

    private ResolvedDataView(
        string? physicalRoot,
        Dictionary<string, Entry> map,
        string displayRoot,
        string baseGameDataPath,
        string writeRoot)
    {
        _physicalRoot = physicalRoot;
        _map = map;
        DisplayRoot = displayRoot;
        BaseGameDataPath = baseGameDataPath;
        WriteRoot = writeRoot;
    }

    /// <summary>The path shown to the user as the indexed location.</summary>
    public string DisplayRoot { get; }

    /// <summary>True for an MO2 overlay, false for a real Data folder.</summary>
    public bool IsVirtual => _physicalRoot is null;

    /// <summary>
    /// Folder holding the base game master plugins (Skyrim.esm and friends). For a physical view
    /// this is the Data root itself; for MO2 it is the managed game's real Data folder, because MO2
    /// never virtualises the base masters.
    /// </summary>
    public string BaseGameDataPath { get; }

    /// <summary>
    /// Where the game writes runtime output (baked CharGen heads land here). For a physical view this
    /// is the Data root; for MO2 it is the profile's overwrite folder, which is exactly where the
    /// virtual file system flushes anything a tool creates under Data.
    /// </summary>
    public string WriteRoot { get; }

    public static ResolvedDataView Physical(string dataRoot)
    {
        var full = Path.GetFullPath(dataRoot);
        return new ResolvedDataView(full, new Dictionary<string, Entry>(), full, full, full);
    }

    public static ResolvedDataView Virtual(
        IEnumerable<Entry> entries,
        string displayRoot,
        string baseGameDataPath,
        string writeRoot)
    {
        var map = new Dictionary<string, Entry>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in entries)
            map[Normalize(entry.RelPath)] = entry;
        return new ResolvedDataView(null, map, displayRoot, baseGameDataPath, writeRoot);
    }

    /// <summary>Every winning file in the view. Empty for a physical view (which is enumerated lazily).</summary>
    public IReadOnlyCollection<Entry> Entries => _map.Values;

    public bool Exists(string relPath)
    {
        if (_physicalRoot is not null)
            return File.Exists(Path.Combine(_physicalRoot, Clean(relPath)));
        return _map.ContainsKey(Normalize(relPath));
    }

    public bool TryResolve(string relPath, out string absolutePath)
    {
        if (_physicalRoot is not null)
        {
            absolutePath = Path.Combine(_physicalRoot, Clean(relPath));
            return File.Exists(absolutePath);
        }
        if (_map.TryGetValue(Normalize(relPath), out var entry))
        {
            absolutePath = entry.AbsolutePath;
            return true;
        }
        absolutePath = "";
        return false;
    }

    /// <summary>
    /// Files directly in (or, when <paramref name="recursive"/>, anywhere under) a relative directory
    /// that match a simple pattern ("*", "*.bsa", or an exact file name such as "morphs.ini").
    /// Yields the file's path relative to the Data root together with its absolute path.
    /// </summary>
    public IEnumerable<(string RelPath, string AbsolutePath)> Files(
        string relDir,
        string pattern,
        bool recursive)
    {
        if (_physicalRoot is not null)
        {
            var dir = string.IsNullOrEmpty(relDir)
                ? _physicalRoot
                : Path.Combine(_physicalRoot, Clean(relDir));
            if (!Directory.Exists(dir)) yield break;
            var option = recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
            foreach (var abs in Directory.EnumerateFiles(dir, "*", option))
            {
                if (!MatchesPattern(Path.GetFileName(abs), pattern)) continue;
                yield return (Path.GetRelativePath(_physicalRoot, abs), abs);
            }
            yield break;
        }

        var prefix = string.IsNullOrEmpty(relDir) ? "" : Normalize(relDir) + "\\";
        foreach (var entry in _map.Values)
        {
            var key = Normalize(entry.RelPath);
            if (prefix.Length > 0 && !key.StartsWith(prefix, StringComparison.Ordinal)) continue;
            var remainder = prefix.Length > 0 ? key[prefix.Length..] : key;
            if (!recursive && remainder.Contains('\\')) continue;
            if (!MatchesPattern(Path.GetFileName(entry.RelPath), pattern)) continue;
            yield return (entry.RelPath, entry.AbsolutePath);
        }
    }

    /// <summary>Immediate child directories of a relative directory, as paths relative to the Data root.</summary>
    public IEnumerable<string> ChildDirectories(string relDir)
    {
        if (_physicalRoot is not null)
        {
            var dir = string.IsNullOrEmpty(relDir)
                ? _physicalRoot
                : Path.Combine(_physicalRoot, Clean(relDir));
            if (!Directory.Exists(dir)) yield break;
            foreach (var child in Directory.EnumerateDirectories(dir))
                yield return Path.GetRelativePath(_physicalRoot, child);
            yield break;
        }

        var prefix = string.IsNullOrEmpty(relDir) ? "" : Normalize(relDir) + "\\";
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in _map.Values)
        {
            var key = Normalize(entry.RelPath);
            if (prefix.Length > 0 && !key.StartsWith(prefix, StringComparison.Ordinal)) continue;
            var remainder = prefix.Length > 0 ? entry.RelPath[prefix.Length..] : entry.RelPath;
            var slash = remainder.IndexOf('\\');
            if (slash <= 0) continue; // a file directly in this dir, not a child directory
            var childRel = (prefix.Length > 0 ? entry.RelPath[..prefix.Length] : "") + remainder[..slash];
            if (seen.Add(childRel)) yield return childRel;
        }
    }

    private static bool MatchesPattern(string fileName, string pattern)
    {
        if (pattern is "*" or "*.*") return true;
        if (pattern.StartsWith("*.", StringComparison.Ordinal))
            return fileName.EndsWith(pattern[1..], StringComparison.OrdinalIgnoreCase);
        return string.Equals(fileName, pattern, StringComparison.OrdinalIgnoreCase);
    }

    private static string Clean(string relPath) =>
        relPath.Replace('/', '\\').Trim().TrimStart('\\');

    private static string Normalize(string relPath) => Clean(relPath).ToLowerInvariant();
}
