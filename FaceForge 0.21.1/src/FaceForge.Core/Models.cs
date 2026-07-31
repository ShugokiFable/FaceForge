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
    IReadOnlyList<PlayableRace> PlayableRaces);

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
    IReadOnlyDictionary<string, double> SliderDeltas);

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
