using Mutagen.Bethesda.Skyrim;
using System.Text.RegularExpressions;

namespace FaceForge.Core;

internal static class HeadPartCatalog
{
    public static IReadOnlyList<AppearanceChoice> Read(
        string pluginPath,
        string? sourceMod,
        IReadOnlyList<string> masters,
        IReadOnlyList<string> missingMasters,
        SkyrimRecordIndex index)
    {
        try
        {
            using var mod = SkyrimMod.CreateFromBinaryOverlay(
                pluginPath,
                SkyrimRelease.SkyrimSE);
            // A mod may declare its own ValidRaces form lists; without absorbing them first every
            // record from that plugin would report "race validity unresolved".
            index.AbsorbFormLists(mod);
            return mod.HeadParts
                .Select(part =>
                {
                    var editorId = part.EditorID;
                    var displayName = part.Name?.String;
                    var typed = CategoryFor(part.Type);
                    var category = typed ?? Classify(editorId, displayName);
                    if (category is null) return null;
                    var formPlugin = part.FormKey.ModKey.FileName.String;
                    var formIdentifier = $"{formPlugin}|{part.FormKey.ID:X6}";
                    var shownName = string.IsNullOrWhiteSpace(displayName)
                        ? editorId ?? formIdentifier
                        : displayName;
                    var (listEditorId, races) = index.ResolveValidRaces(part.ValidRaces.FormKey);
                    return new AppearanceChoice(
                        category,
                        shownName,
                        editorId,
                        formIdentifier,
                        Path.GetFileName(pluginPath),
                        sourceMod,
                        masters,
                        missingMasters,
                        Evidence(typed is not null, shownName, editorId),
                        SexFor(part.Flags),
                        part.Flags.HasFlag(HeadPart.Flag.Playable),
                        listEditorId,
                        races,
                        typed is not null);
                })
                .Where(item => item is not null)
                .Cast<AppearanceChoice>()
                .ToArray();
        }
        catch
        {
            // A malformed or unsupported plugin must not abort the environment index.
            return [];
        }
    }

    /// <summary>The HDPT Type subrecord, which is what Skyrim itself slots the part by.</summary>
    internal static string? CategoryFor(HeadPart.TypeEnum? type) => type switch
    {
        HeadPart.TypeEnum.Hair => "hair",
        HeadPart.TypeEnum.Eyes => "eyes",
        HeadPart.TypeEnum.Eyebrows => "brows",
        HeadPart.TypeEnum.FacialHair => "facialhair",
        HeadPart.TypeEnum.Scars => "scars",
        HeadPart.TypeEnum.Face => "face",
        HeadPart.TypeEnum.Misc => "misc",
        _ => null
    };

    /// <summary>
    /// HDPT gender flags. A record with neither flag set is offered to both sexes because Skyrim
    /// does not restrict it; hiding it would drop legitimate unisex parts.
    /// </summary>
    internal static string SexFor(HeadPart.Flag flags)
    {
        var male = flags.HasFlag(HeadPart.Flag.Male);
        var female = flags.HasFlag(HeadPart.Flag.Female);
        if (male && female) return "any";
        if (male) return "male";
        if (female) return "female";
        return "unflagged";
    }

    /// <summary>Name-based fallback used only when the record has no Type subrecord at all.</summary>
    internal static string? Classify(string? editorId, string? displayName)
    {
        var text = $"{editorId} {displayName}".ToLowerInvariant();
        if ((text.Contains("brow") && !text.Contains("brown")) ||
            text.Contains("eyebrow"))
            return "brows";
        if (text.Contains("hair")) return "hair";
        if (text.Contains("eye")) return "eyes";
        return null;
    }

    private static string Evidence(bool typedFromRecord, string shownName, string? editorId)
    {
        if (!typedFromRecord)
            return "No HDPT Type subrecord; category guessed from the record name";
        return HasShapeWords(shownName + " " + editorId)
            ? "HDPT Type subrecord; record name contains visual shape words"
            : "HDPT Type subrecord; visual confirmation still required";
    }

    internal static bool HasShapeWords(string text) =>
        Regex.IsMatch(
            text,
            @"(?:^|[^a-z])(?:wide|narrow|thick|thin|straight|flat|arch|angled?)(?:[^a-z]|$)",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
}
