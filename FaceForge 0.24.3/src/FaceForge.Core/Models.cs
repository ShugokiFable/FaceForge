namespace FaceForge.Core;

public sealed record DeploymentHeader(
    string? DeploymentMethod,
    string? GameId,
    string? StagingPath,
    string? TargetPath,
    long DeploymentTimeUtcMs);

public sealed record DeploymentEntry(string RelPath, string SourceMod, long TimeUtcMs);

public sealed record PluginProvider(
    string PluginName,
    string? SourceMod,
    bool Present,
    bool BaseGame,
    int SourceBsaCount,
    int SourceRelevantAssetCount);

public sealed record IndexedPreset(
    string Id,
    string FileName,
    string JslotPath,
    string? NifPath,
    string? DdsPath,
    string Layout,
    IReadOnlyList<string> RequiredPlugins,
    int SculptHostCount)
{
    public bool HasNif => NifPath is not null;
    public bool HasDds => DdsPath is not null;
}

public sealed record AppearancePluginRequirement(
    string PluginName,
    IReadOnlyList<string> Masters,
    IReadOnlyList<string> MissingMasters);

public sealed record AppearanceRecommendation(
    string Category,
    string SourceMod,
    int ConfidenceScore,
    int AssetCount,
    int SourceBsaCount,
    IReadOnlyList<string> EvidencePaths,
    IReadOnlyList<AppearancePluginRequirement> PluginRequirements,
    IReadOnlyList<string> CompatibilityNotes);

/// <summary>
/// One installed HDPT record. Category, sex, and race validity come from the record's own
/// Type field, Flags, and ValidRaces form list -- never from the record name.
/// </summary>
public sealed record AppearanceChoice(
    string Category,
    string DisplayName,
    string? EditorId,
    string FormIdentifier,
    string PluginName,
    string? SourceMod,
    IReadOnlyList<string> Masters,
    IReadOnlyList<string> MissingMasters,
    string MatchEvidence,
    string Sex = "unflagged",
    bool Playable = true,
    string? ValidRacesEditorId = null,
    IReadOnlyList<string>? ValidRaces = null,
    bool TypeFromRecord = false)
{
    public IReadOnlyList<string> ValidRaces { get; init; } = ValidRaces ?? [];
}

public sealed record MorphFamilyCount(string Family, int Count);

/// <summary>One head part named in a preset, resolved against the indexed HDPT records.</summary>
public sealed record PresetHeadPartReport(
    string FormIdentifier,
    string? DisplayName,
    string? EditorId,
    string Category,
    string Sex,
    IReadOnlyList<string> ValidRaces,
    string PluginName,
    string? SourceMod,
    bool Resolved);

/// <summary>What a finished preset needs, recomputed from the file rather than from export time.</summary>
public sealed record PresetReport(
    string FileName,
    string FullPath,
    int CustomMorphCount,
    IReadOnlyList<MorphFamilyCount> MorphFamilies,
    IReadOnlyList<string> SculptHosts,
    IReadOnlyList<PresetHeadPartReport> HeadParts,
    IReadOnlyList<PluginProvider> Dependencies,
    int TintLayerCount,
    uint? HairColor,
    float Weight,
    string? HeadTexture,
    bool HasVanillaBase,
    bool ShareReady,
    IReadOnlyList<string> Blockers,
    IReadOnlyList<string> Notes);

/// <summary>A playable RACE parsed from the installed base game, not a hardcoded name list.</summary>
public sealed record PlayableRace(
    string EditorId,
    string? Name,
    string FormIdentifier,
    bool FaceGenHead);

/// <summary>
/// One extension .tri attached to a head by a facegenmorphs morphs.ini. <paramref name="TopologyMatches"/>
/// is the whole point: a non-matching extension is registered, listed by RaceMenu, and completely
/// inert, because a morph is a flat per-vertex delta array that cannot address a different mesh.
/// </summary>
public sealed record MorphExtensionInfo(
    string ExtensionPath,
    string Plugin,
    int VertexCount,
    bool TopologyMatches,
    int MorphCount,
    string? Rejection);

/// <summary>One chargen mesh a character wears, and how many morphs reach it.</summary>
public sealed record MorphPartInfo(
    string ChargenTriPath,
    int VertexCount,
    int MorphCount,
    string? Error);

/// <summary>
/// Every morph name that can actually move on one head configuration -- the union across the head,
/// brow, eye, and mouth meshes, because RaceMenu applies a slider to whichever part carries its
/// morph.
/// </summary>
public sealed record HeadMorphProfile(
    string ChargenTriPath,
    string TargetSex,
    bool HighPoly,
    int VertexCount,
    IReadOnlyList<string> MorphNames,
    IReadOnlyList<MorphPartInfo> Parts,
    IReadOnlyList<MorphExtensionInfo> Extensions,
    string? Error);

public sealed record MorphSliderEntry(string Name, string NegativeMorph, string PositiveMorph);

/// <summary>One slider ini, plus the races whose races.ini points at it.</summary>
public sealed record MorphSliderSet(
    string Plugin,
    string IniPath,
    string Sex,
    IReadOnlyList<string> Races,
    IReadOnlyList<MorphSliderEntry> Sliders);

/// <summary>
/// <paramref name="Complete"/> is the licence to draw a negative conclusion. It is false whenever an
/// installed archive declares facegenmorphs content this loose-file read cannot open, because a
/// slider whose morphs live in that archive would look dead and is not.
/// </summary>
public sealed record MorphRegistrySnapshot(
    IReadOnlyList<HeadMorphProfile> Heads,
    IReadOnlyList<MorphSliderSet> SliderSets,
    bool Complete,
    IReadOnlyList<string> UnreadArchives);

public sealed record EnvironmentSummary(
    string GameDataPath,
    string DetectionMethod,
    bool AutoDetected,
    string? ManifestPath,
    string? StagingPath,
    long DeploymentTimeUtcMs,
    int SourceModCount,
    int PluginCount,
    int RelevantAssetCount,
    int BsaCount,
    int PresetCount,
    IReadOnlyList<IndexedPreset> Presets,
    IReadOnlyList<AppearanceRecommendation> AppearanceRecommendations,
    IReadOnlyList<AppearanceChoice> AppearanceChoices,
    IReadOnlyList<PlayableRace> PlayableRaces,
    MorphRegistrySnapshot MorphRegistry);

public sealed record TemplatePayload(
    string FileName,
    string Contents,
    string? SourceId,
    string? NifPath,
    string? DdsPath,
    string Layout);

public sealed record VisionResult(
    string Model,
    double Confidence,
    IReadOnlyList<string> Observations,
    IReadOnlyDictionary<string, double> SliderDeltas,
    /// <summary>0-100 match rating the model gives in "assess" mode (read-only fit critique); null for refine/interpret.</summary>
    int? FitScore = null);

public sealed record ExportRequest(
    string Mode,
    string OutputPath,
    string PresetName,
    string JslotContents,
    string? SourceNifPath,
    string? SourceDdsPath,
    bool PreserveSculpt,
    bool RedistributionPermissionConfirmed,
    IReadOnlyList<PluginProvider> Dependencies,
    IReadOnlyList<AppearanceChoice>? AppearanceChoices = null,
    string? TargetRaceEditorId = null,
    string TargetSex = "female");

public sealed record ExportResult(
    string OutputPath,
    string Mode,
    int FileCount,
    string Sha256,
    IReadOnlyList<string> Entries);
