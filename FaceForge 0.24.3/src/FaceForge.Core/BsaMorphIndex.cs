using System.Collections.Concurrent;
using System.Text;

namespace FaceForge.Core;

/// <summary>
/// Supplies the facegenmorphs extension morphs that live inside .bsa archives instead of as loose
/// files. High Poly Head ships its entire EFM/CME/ECE morph set this way, so without reading the
/// archive the renderer cannot move chin, jaw, cheek or brow on an HPH head. This mirrors the loose
/// morphs.ini handling in <see cref="MorphRegistry"/>, but reads the ini and the extension .tri
/// files out of the archive, decompressing (zlib or LZ4) as needed.
///
/// Extraction is expensive (a head morph .tri decompresses to several MB), so parsed morphs are
/// cached: the optimiser renders hundreds of candidates and must not re-extract each time.
/// </summary>
public sealed class BsaMorphIndex
{
    private const string MorphsRoot = @"meshes\actors\character\facegenmorphs";

    private sealed record Registration(string BasePath, IReadOnlyList<string> ExtensionPaths);

    private readonly List<(BsaArchive Archive, List<Registration> Registrations)> _sources;
    private readonly ConcurrentDictionary<string, IReadOnlyList<TriMorph>> _cache = new(StringComparer.OrdinalIgnoreCase);

    private BsaMorphIndex(List<(BsaArchive, List<Registration>)> sources) => _sources = sources;

    public bool IsEmpty => _sources.Count == 0;

    public static BsaMorphIndex Build(ResolvedDataView view)
    {
        var sources = new List<(BsaArchive, List<Registration>)>();
        foreach (var (_, abs) in view.Files("", "*.bsa", recursive: false))
        {
            List<string> folders;
            try { folders = BsaIndex.ReadFolderNames(abs).ToList(); }
            catch { continue; }
            if (!folders.Any(f => f.StartsWith(MorphsRoot, StringComparison.OrdinalIgnoreCase))) continue;

            var archive = BsaArchive.Open(abs);
            if (archive is null) continue;

            var registrations = new List<Registration>();
            foreach (var file in archive.Files.Where(f => f.EndsWith("morphs.ini", StringComparison.OrdinalIgnoreCase)))
            {
                var bytes = archive.Extract(file);
                if (bytes is null) continue;
                registrations.AddRange(ParseRegistrations(Encoding.UTF8.GetString(bytes)));
            }
            if (registrations.Count > 0) sources.Add((archive, registrations));
        }
        return new BsaMorphIndex(sources);
    }

    /// <summary>
    /// The extension morphs an archive attaches to the chargen mesh at <paramref name="baseRelPath"/>
    /// (relative to <c>meshes\</c>), keeping only those whose topology matches <paramref name="vertexCount"/>.
    /// </summary>
    public IReadOnlyList<TriMorph> ExtensionMorphs(string baseRelPath, int vertexCount)
    {
        var key = Normalize(baseRelPath) + "|" + vertexCount;
        return _cache.GetOrAdd(key, _ =>
        {
            var morphs = new List<TriMorph>();
            var wantedBase = Normalize(baseRelPath);
            foreach (var (archive, registrations) in _sources)
            {
                foreach (var registration in registrations)
                {
                    if (!Normalize(registration.BasePath).Equals(wantedBase, StringComparison.OrdinalIgnoreCase))
                        continue;
                    foreach (var extension in registration.ExtensionPaths)
                    {
                        var internalPath = MorphsRoot + @"\Morphs\" + extension;
                        var bytes = archive.Extract(internalPath);
                        if (bytes is null) continue;
                        try
                        {
                            var tri = TriFile.Read(bytes, internalPath);
                            if (tri.VertexCount == vertexCount) morphs.AddRange(tri.Morphs);
                        }
                        catch
                        {
                            // A malformed extension simply contributes nothing.
                        }
                    }
                }
            }
            return morphs;
        });
    }

    /// <summary>
    /// Parses <c>extension = &lt;base&gt;, &lt;ext1&gt;, &lt;ext2&gt;, ...</c> lines. One line registers any
    /// number of extension .tri files against a single chargen mesh, exactly as the loose reader does.
    /// </summary>
    private static IEnumerable<Registration> ParseRegistrations(string ini)
    {
        foreach (var raw in ini.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line[0] is '#' or ';') continue;
            var separator = line.IndexOf('=');
            if (separator < 0) continue;
            if (!line[..separator].Trim().Equals("extension", StringComparison.OrdinalIgnoreCase)) continue;
            var parts = line[(separator + 1)..].Split(',', StringSplitOptions.TrimEntries);
            if (parts.Length < 2 || parts[0].Length == 0) continue;
            var extensions = parts.Skip(1).Where(part => part.Length > 0).Select(Normalize).ToList();
            if (extensions.Count > 0) yield return new Registration(Normalize(parts[0]), extensions);
        }
    }

    private static string Normalize(string value) =>
        value.Trim().Trim(',').Trim().Replace('/', '\\').TrimStart('\\');
}
