using Mutagen.Bethesda.Plugins;
using Mutagen.Bethesda.Skyrim;

namespace FaceForge.Core;

/// <summary>
/// Reads the installed base game once so head parts can be gated by the records that actually
/// decide visibility in RaceMenu: the HDPT ValidRaces form list and the playable RACE list.
/// Without this, a head part can only be guessed at from its name.
/// </summary>
public sealed class SkyrimRecordIndex
{
    /// <summary>
    /// Base-game plugins are the ones that define the playable races and the shared head-part
    /// form lists that almost every appearance mod points at.
    /// </summary>
    public static readonly string[] BaseGamePlugins =
    [
        "Skyrim.esm",
        "Update.esm",
        "Dawnguard.esm",
        "HearthFires.esm",
        "Dragonborn.esm"
    ];

    private readonly Dictionary<FormKey, string> _raceEditorIds = [];
    private readonly Dictionary<FormKey, FormListEntry> _formLists = [];
    private readonly List<PlayableRace> _playableRaces = [];

    public IReadOnlyList<PlayableRace> PlayableRaces => _playableRaces;

    /// <summary>Base-game plugin files that exist in this Data folder, in load order.</summary>
    public static IReadOnlyList<string> PresentBaseGamePlugins(string gameDataPath) =>
        BaseGamePlugins
            .Where(name => File.Exists(Path.Combine(gameDataPath, name)))
            .ToArray();

    public static SkyrimRecordIndex Build(string gameDataPath)
    {
        var index = new SkyrimRecordIndex();
        foreach (var name in PresentBaseGamePlugins(gameDataPath))
        {
            try
            {
                using var mod = SkyrimMod.CreateFromBinaryOverlay(
                    Path.Combine(gameDataPath, name),
                    SkyrimRelease.SkyrimSE);
                index.Absorb(mod);
            }
            catch
            {
                // A base plugin that cannot be parsed must not abort the whole index; head parts
                // simply fall back to "race validity unresolved" instead of being hidden.
            }
        }

        index._playableRaces.Sort((left, right) =>
            string.Compare(left.EditorId, right.EditorId, StringComparison.OrdinalIgnoreCase));
        return index;
    }

    /// <summary>Records a plugin's own form lists so mod-defined ValidRaces lists also resolve.</summary>
    public void AbsorbFormLists(ISkyrimModGetter mod)
    {
        foreach (var list in mod.FormLists)
        {
            _formLists[list.FormKey] = new FormListEntry(
                list.EditorID,
                list.Items.Select(item => item.FormKey).ToArray());
        }
    }

    private void Absorb(ISkyrimModGetter mod)
    {
        AbsorbFormLists(mod);
        foreach (var race in mod.Races)
        {
            if (race.EditorID is not { Length: > 0 } editorId) continue;
            _raceEditorIds[race.FormKey] = editorId;
            if (!race.Flags.HasFlag(Race.Flag.Playable)) continue;
            if (_playableRaces.Any(item => item.EditorId.Equals(editorId, StringComparison.OrdinalIgnoreCase)))
                continue;
            _playableRaces.Add(new PlayableRace(
                editorId,
                race.Name?.String,
                $"{race.FormKey.ModKey.FileName}|{race.FormKey.ID:X6}",
                race.Flags.HasFlag(Race.Flag.FaceGenHead)));
        }
    }

    /// <summary>
    /// Resolves an HDPT ValidRaces link to the RACE EditorIDs it grants. Returns an empty list
    /// when the form list is not indexed; callers must treat that as "unknown", never "excluded".
    /// </summary>
    public (string? ListEditorId, IReadOnlyList<string> Races) ResolveValidRaces(FormKey? formListKey)
    {
        if (formListKey is not { } key || key.IsNull) return (null, []);
        if (!_formLists.TryGetValue(key, out var entry)) return (null, []);
        var races = entry.Items
            .Select(item => _raceEditorIds.GetValueOrDefault(item))
            .Where(item => item is { Length: > 0 })
            .Select(item => item!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(item => item, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        return (entry.EditorId, races);
    }

    private sealed record FormListEntry(string? EditorId, IReadOnlyList<FormKey> Items);
}
