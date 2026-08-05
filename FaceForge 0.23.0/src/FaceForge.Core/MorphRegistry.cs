namespace FaceForge.Core;

/// <summary>
/// Reads which RaceMenu sliders the installation can actually move, from the installation itself.
///
/// A RaceMenu slider is not a thing the game knows about. It is a name in an ini that points at a
/// pair of named vertex morphs, and the morphs live in .tri files. Two directories decide whether
/// a slider does anything:
///
///   meshes\actors\character\facegenmorphs\&lt;Plugin&gt;\morphs.ini
///       extension = &lt;base chargen tri&gt;, &lt;extension tri&gt;
///       Attaches extra named morphs to one specific chargen mesh, keyed by PATH.
///
///   meshes\actors\character\facegenmorphs\&lt;Plugin&gt;\races.ini   -> which slider ini a race gets
///   meshes\actors\character\facegenmorphs\&lt;Plugin&gt;\sliders\*.ini
///       &lt;SliderName&gt; = &lt;flags&gt;, Slider, &lt;negative morph&gt;, &lt;positive morph&gt;
///       &lt;SliderName&gt; = &lt;flags&gt;, HeadPart, &lt;index&gt;
///
/// The trap this class exists to catch: RaceMenu shows a slider whenever races.ini registers it,
/// but it can only MOVE that slider if the morph pair exists in a .tri whose vertex count matches
/// the head being worn. Those two conditions are independent. On a High Poly Head character every
/// Expressive Facegen Morphs slider is registered (so it appears, and a saved preset lists it) and
/// none of them has any geometry, because EFM registers its extension against the vanilla
/// Actors\Character\Character Assets head and ships 996-vertex morphs, while the HPH head is 3832
/// vertices. A slider in that state is inert: writing a value to it changes nothing at all.
///
/// So topology match is checked here, not assumed. Vertex count is the check the engine itself
/// cannot fudge -- a morph is a flat per-vertex delta array, so a count mismatch cannot be applied
/// under any interpretation.
/// </summary>
public static class MorphRegistry
{
    private const string MorphsRoot = @"meshes\actors\character\facegenmorphs";

    /// <summary>
    /// Head configurations FaceForge can target, each as the set of chargen meshes a character
    /// actually wears. The parts matter: a slider is applied to whichever mesh carries its morph,
    /// so eye, brow, and mouth sliders would read as inert if only the head were inspected.
    ///
    /// Vanilla male is MaleHeadCustomizations, not MaleHeadChargen -- Bethesda named the male
    /// chargen mesh differently and the morphs.ini files follow that name. High Poly Head replaces
    /// the head and brows but leaves eyes and mouth on the vanilla meshes, which is why an HPH
    /// character mixes 3832-vertex and 176-vertex parts.
    /// </summary>
    private static readonly HeadConfiguration[] KnownHeads =
    [
        new("female", false,
        [
            @"Actors\Character\Character Assets\FemaleHeadChargen.tri",
            @"Actors\Character\Character Assets\FaceParts\FemaleHeadBrowsChargen.tri",
            @"Actors\Character\Character Assets\EyesFemaleChargen.tri",
            @"Actors\Character\Character Assets\Mouth\MouthHumanFChargen.tri"
        ]),
        new("male", false,
        [
            @"Actors\Character\Character Assets\MaleHeadCustomizations.tri",
            @"Actors\Character\Character Assets\FaceParts\MaleHeadBrowsChargen.tri",
            @"Actors\Character\Character Assets\EyesMaleChargen.tri",
            @"Actors\Character\Character Assets\Mouth\MouthHumanChargen.tri"
        ]),
        new("female", true,
        [
            @"KL\High Poly Head\femaleheadchargen.tri",
            @"KL\High Poly Head\FaceParts\femaleheadbrowschargen.tri",
            @"Actors\Character\Character Assets\EyesFemaleChargen.tri",
            @"Actors\Character\Character Assets\Mouth\MouthHumanFChargen.tri"
        ]),
        new("male", true,
        [
            @"KL\High Poly Head\MaleHeadCustomizations.tri",
            @"KL\High Poly Head\FaceParts\maleheadbrowschargen.tri",
            @"Actors\Character\Character Assets\EyesMaleChargen.tri",
            @"Actors\Character\Character Assets\Mouth\MouthHumanChargen.tri"
        ])
    ];

    private sealed record HeadConfiguration(string Sex, bool HighPoly, string[] Parts);

    public static MorphRegistrySnapshot Build(string gameDataPath)
    {
        var root = Path.Combine(gameDataPath, MorphsRoot);
        var extensions = Directory.Exists(root) ? ReadExtensions(root) : [];
        var sliderSets = Directory.Exists(root) ? ReadSliderSets(root) : [];
        var heads = new List<HeadMorphProfile>();

        foreach (var configuration in KnownHeads)
        {
            var headPath = configuration.Parts[0];
            var headFull = Path.Combine(gameDataPath, "meshes", headPath);
            if (!File.Exists(headFull)) continue;

            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var attached = new List<MorphExtensionInfo>();
            var parts = new List<MorphPartInfo>();
            var headVertexCount = 0;

            foreach (var relative in configuration.Parts)
            {
                var full = Path.Combine(gameDataPath, "meshes", relative);
                if (!File.Exists(full))
                {
                    parts.Add(new MorphPartInfo(relative, 0, 0, "chargen .tri not found on disk"));
                    continue;
                }

                TriFile part;
                try { part = TriFile.Read(full); }
                catch (Exception error)
                {
                    parts.Add(new MorphPartInfo(relative, 0, 0, error.Message));
                    continue;
                }

                if (relative == headPath) headVertexCount = part.VertexCount;
                foreach (var morph in part.Morphs) names.Add(morph.Name);
                var partMorphs = part.Morphs.Count;

                foreach (var extension in extensions)
                {
                    if (!PathsMatch(extension.BasePath, relative)) continue;
                    var extensionFull = Path.Combine(root, "Morphs", extension.ExtensionPath);
                    if (!File.Exists(extensionFull))
                    {
                        attached.Add(new MorphExtensionInfo(
                            extension.ExtensionPath, extension.Plugin, 0, false, 0,
                            "extension .tri not found on disk"));
                        continue;
                    }

                    TriFile morphs;
                    try { morphs = TriFile.Read(extensionFull); }
                    catch (Exception error)
                    {
                        attached.Add(new MorphExtensionInfo(
                            extension.ExtensionPath, extension.Plugin, 0, false, 0, error.Message));
                        continue;
                    }

                    var matches = morphs.VertexCount == part.VertexCount;
                    if (matches)
                    {
                        foreach (var morph in morphs.Morphs) names.Add(morph.Name);
                        partMorphs += morphs.Morphs.Count;
                    }

                    attached.Add(new MorphExtensionInfo(
                        extension.ExtensionPath,
                        extension.Plugin,
                        morphs.VertexCount,
                        matches,
                        morphs.Morphs.Count,
                        matches
                            ? null
                            : $"{Path.GetFileName(relative)} has {part.VertexCount} vertices, this extension carries {morphs.VertexCount}"));
                }

                parts.Add(new MorphPartInfo(relative, part.VertexCount, partMorphs, null));
            }

            heads.Add(new HeadMorphProfile(
                headPath,
                configuration.Sex,
                configuration.HighPoly,
                headVertexCount,
                names.OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToList(),
                parts,
                attached,
                null));
        }

        return new MorphRegistrySnapshot(heads, sliderSets);
    }

    /// <summary>
    /// morphs.ini paths and real file paths disagree about separators, case, and the odd trailing
    /// comma, so compare them normalized rather than ordinally.
    /// </summary>
    private static bool PathsMatch(string left, string right) =>
        string.Equals(Normalize(left), Normalize(right), StringComparison.OrdinalIgnoreCase);

    private static string Normalize(string value) =>
        value.Trim().Trim(',').Trim().Replace('/', '\\').TrimStart('\\');

    private static List<MorphExtensionRegistration> ReadExtensions(string root)
    {
        var results = new List<MorphExtensionRegistration>();
        foreach (var directory in Directory.EnumerateDirectories(root))
        {
            var plugin = Path.GetFileName(directory);
            foreach (var ini in Directory.EnumerateFiles(directory, "morphs.ini", SearchOption.TopDirectoryOnly))
            {
                foreach (var line in ReadIniLines(ini))
                {
                    var separator = line.IndexOf('=');
                    if (separator < 0) continue;
                    if (!line[..separator].Trim().Equals("extension", StringComparison.OrdinalIgnoreCase)) continue;
                    var parts = line[(separator + 1)..].Split(',', StringSplitOptions.TrimEntries);
                    if (parts.Length < 2 || parts[0].Length == 0 || parts[1].Length == 0) continue;
                    results.Add(new MorphExtensionRegistration(plugin, Normalize(parts[0]), Normalize(parts[1])));
                }
            }
        }
        return results;
    }

    private static List<MorphSliderSet> ReadSliderSets(string root)
    {
        var results = new List<MorphSliderSet>();
        foreach (var directory in Directory.EnumerateDirectories(root))
        {
            var plugin = Path.GetFileName(directory);
            var races = ReadRaces(directory);
            if (races.Count == 0) continue;

            foreach (var group in races.GroupBy(entry => entry.Value, StringComparer.OrdinalIgnoreCase))
            {
                var iniPath = Path.Combine(directory, group.Key.Replace('/', '\\'));
                if (!File.Exists(iniPath)) continue;
                var raceIds = group.Select(entry => entry.Key)
                    .OrderBy(id => id, StringComparer.OrdinalIgnoreCase)
                    .ToList();
                foreach (var (sex, sliders) in ReadSliders(iniPath))
                {
                    if (sliders.Count == 0) continue;
                    results.Add(new MorphSliderSet(plugin, group.Key, sex, raceIds, sliders));
                }
            }
        }
        return results;
    }

    private static Dictionary<string, string> ReadRaces(string directory)
    {
        var races = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var ini in Directory.EnumerateFiles(directory, "races.ini", SearchOption.TopDirectoryOnly))
        {
            foreach (var line in ReadIniLines(ini))
            {
                var separator = line.IndexOf('=');
                if (separator <= 0) continue;
                var race = line[..separator].Trim();
                var target = line[(separator + 1)..].Trim().Trim(',').Trim();
                if (race.Length == 0 || target.Length == 0) continue;
                races[race] = target;
            }
        }
        return races;
    }

    /// <summary>
    /// A slider ini is split into [Female] and [Male] sections; entries outside a section belong to
    /// both. Only the "Slider" data type carries morph geometry -- "HeadPart" entries swap a whole
    /// head part and are deliberately excluded, because they are not something a measurement drives.
    /// </summary>
    private static List<(string Sex, List<MorphSliderEntry> Sliders)> ReadSliders(string iniPath)
    {
        var female = new List<MorphSliderEntry>();
        var male = new List<MorphSliderEntry>();
        List<MorphSliderEntry>? current = null;

        foreach (var line in ReadIniLines(iniPath))
        {
            if (line.StartsWith('['))
            {
                var section = line.Trim('[', ']').Trim();
                current = section.Equals("Female", StringComparison.OrdinalIgnoreCase) ? female
                    : section.Equals("Male", StringComparison.OrdinalIgnoreCase) ? male
                    : null;
                continue;
            }

            var separator = line.IndexOf('=');
            if (separator <= 0) continue;
            var name = line[..separator].Trim();
            var parts = line[(separator + 1)..].Split(',', StringSplitOptions.TrimEntries);
            if (name.Length == 0 || parts.Length < 4) continue;
            if (!parts[1].Equals("Slider", StringComparison.OrdinalIgnoreCase)) continue;
            if (parts[2].Length == 0 || parts[3].Length == 0) continue;

            var entry = new MorphSliderEntry(name, parts[2], parts[3]);
            if (current is not null) current.Add(entry);
            else { female.Add(entry); male.Add(entry); }
        }

        return [("female", female), ("male", male)];
    }

    private static IEnumerable<string> ReadIniLines(string path)
    {
        foreach (var raw in File.ReadLines(path))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#') || line.StartsWith(';')) continue;
            yield return line;
        }
    }

    private sealed record MorphExtensionRegistration(string Plugin, string BasePath, string ExtensionPath);
}
