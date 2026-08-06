import { useMemo, useRef, useState } from "react";
import {
  shapeStyleCatalog,
  shapeStyleDefinition,
  type FeatureTarget,
  type RaceRecommendation,
  type ShapeStyleId,
  type ShapeStyleRecommendation,
  type SliderGroup
} from "../domain/faceAnalysis";
import {
  fitsRace,
  fitsSex,
  isHighPolyHeadChoice,
  scoreHeadPartPreference
} from "../domain/headPartPreferences";
import type {
  AppearanceCategory,
  AppearanceChoice,
  PlayableRace,
  PluginProvider,
  PresetReport
} from "../domain/nativeBridge";
import type { RaceMenuTemplate } from "../domain/racemenu";
import { SLIDER_DEFINITIONS, type SliderInventory } from "../domain/sliderCatalog";
import {
  ChevronIcon,
  FaceIcon,
  EyeIcon,
  FolderIcon,
  MouthIcon,
  NoseIcon
} from "./Icons";

export type OutputMode = "preset-pack" | "racemenu-export-stage" | "follower-head-kit";

export type TargetSex = "male" | "female";

/**
 * Head-part slots a player picks in RaceMenu. Face/head mesh is first on purpose: High Poly Head
 * (and other head replacers) live here, and modern presets almost always require that topology.
 */
const SELECTABLE_CATEGORIES: AppearanceCategory[] = [
  "face",
  "hair",
  "brows",
  "eyes",
  "facialhair",
  "scars"
];

const CATEGORY_LABELS: Record<AppearanceCategory, string> = {
  hair: "hair",
  brows: "brows",
  eyes: "eyes",
  facialhair: "facial hair",
  scars: "scars",
  face: "head mesh",
  misc: "misc"
};

interface OutputPanelProps {
  template: RaceMenuTemplate | null;
  presetName: string;
  likeness: number;
  preserveSculpt: boolean;
  outputMode: OutputMode;
  permissionConfirmed: boolean;
  dependencyIndexed: boolean;
  dependencies: readonly PluginProvider[];
  raceRecommendations: readonly RaceRecommendation[];
  shapeStyleRecommendations: readonly ShapeStyleRecommendation[];
  featureTargets: readonly FeatureTarget[];
  appearanceChoices: readonly AppearanceChoice[];
  selectedAppearance: readonly AppearanceChoice[];
  playableRaces: readonly PlayableRace[];
  sliderInventory: SliderInventory | null;
  presetReport: PresetReport | null;
  targetRace: string | null;
  targetSex: TargetSex;
  /** Optional light male/female proportion nudge on slider baselines. */
  sexTouchUp: boolean;
  /** Optional geometry style (not ethnicity). */
  shapeStyle: ShapeStyleId;
  nativeAvailable: boolean;
  groups: readonly SliderGroup[];
  values: Readonly<Record<string, number>>;
  generatedValues: Readonly<Record<string, number>>;
  onChooseTemplate: (file: File) => void;
  onRequestTemplate: () => void;
  onUseFreshFoundation: () => void;
  onPresetNameChange: (value: string) => void;
  onLikenessChange: (value: number) => void;
  onPreserveSculptChange: (value: boolean) => void;
  onOutputModeChange: (value: OutputMode) => void;
  onPermissionConfirmedChange: (value: boolean) => void;
  onTargetRaceChange: (value: string | null) => void;
  onTargetSexChange: (value: TargetSex) => void;
  onSexTouchUpChange: (value: boolean) => void;
  onShapeStyleChange: (value: ShapeStyleId) => void;
  onFindBakedHead: () => void;
  onInspectPreset: () => void;
  onChooseSliderInventory: (file: File) => void;
  onClearSliderInventory: () => void;
  onAppearanceChoice: (value: AppearanceChoice) => void;
  onSliderChange: (name: string, finalValue: number) => void;
  onResetGroup: (group: SliderGroup) => void;
}

const iconFor = (id: SliderGroup["id"]) => {
  const Icon = { face: FaceIcon, eyes: EyeIcon, nose: NoseIcon, mouth: MouthIcon }[id];
  return <Icon />;
};

const finalValue = (raw: number, likeness: number) =>
  Math.round(raw * likeness * 100) / 100;

export default function OutputPanel({
  template,
  presetName,
  likeness,
  preserveSculpt,
  outputMode,
  permissionConfirmed,
  dependencyIndexed,
  dependencies,
  raceRecommendations,
  shapeStyleRecommendations,
  featureTargets,
  appearanceChoices,
  selectedAppearance,
  playableRaces,
  sliderInventory,
  presetReport,
  targetRace,
  targetSex,
  sexTouchUp,
  shapeStyle,
  nativeAvailable,
  groups,
  values,
  generatedValues,
  onChooseTemplate,
  onRequestTemplate,
  onUseFreshFoundation,
  onPresetNameChange,
  onLikenessChange,
  onPreserveSculptChange,
  onOutputModeChange,
  onPermissionConfirmedChange,
  onTargetRaceChange,
  onTargetSexChange,
  onSexTouchUpChange,
  onShapeStyleChange,
  onFindBakedHead,
  onInspectPreset,
  onChooseSliderInventory,
  onClearSliderInventory,
  onAppearanceChoice,
  onSliderChange,
  onResetGroup
}: OutputPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inventoryRef = useRef<HTMLInputElement>(null);
  const writtenCount = groups.reduce((count, group) => count + group.sliders.length, 0);
  // How many of FaceForge's measurable sliders this install actually defines. The difference
  // against writtenCount is what a re-run would add.
  const matchedCount = sliderInventory
    ? SLIDER_DEFINITIONS.filter((item) => sliderInventory.names.has(item.name)).length
    : writtenCount;
  const [openGroup, setOpenGroup] = useState<SliderGroup["id"] | null>("face");
  const [appearanceCategory, setAppearanceCategory] =
    useState<AppearanceCategory>("face");
  const [appearanceSearch, setAppearanceSearch] = useState("");
  const presentCount = dependencies.filter((dependency) => dependency.present).length;
  const trioAvailable = Boolean(template?.companions?.hasNif && template.companions.hasDds);
  const appearanceTarget = featureTargets.find(
    (item) => item.category === appearanceCategory
  );
  const selectedRace = playableRaces.find((race) => race.editorId === targetRace) ?? null;

  const categoryChoices = useMemo(
    () => appearanceChoices.filter((item) => item.category === appearanceCategory),
    [appearanceCategory, appearanceChoices]
  );

  // Everything the chosen race and sex can actually wear. RaceMenu applies exactly these gates,
  // so showing the rest is how 0.6.0 ended up offering thousands of unusable records.
  const eligibleChoices = useMemo(
    () =>
      categoryChoices.filter(
        (item) =>
          item.playable &&
          fitsSex(item.sex, targetSex) &&
          fitsRace(item.validRaces, targetRace)
      ),
    [categoryChoices, targetRace, targetSex]
  );

  const visibleAppearanceChoices = useMemo(() => {
    const query = appearanceSearch.trim().toLowerCase();
    const targetWords = (appearanceTarget?.label.toLowerCase().match(/[a-z]{4,}/g) ?? [])
      .filter((word) => word !== "strongly");
    return eligibleChoices
      .filter((item) => !query || [
        item.displayName,
        item.editorId ?? "",
        item.formIdentifier,
        item.sourceMod ?? "",
        item.pluginName
      ].some((value) => value.toLowerCase().includes(query)))
      .map((item) => ({
        item,
        nameScore: targetWords.filter((word) =>
          `${item.displayName} ${item.editorId ?? ""}`.toLowerCase().includes(word)
        ).length
      }))
      .sort((a, b) =>
        b.nameScore - a.nameScore ||
        a.item.displayName.localeCompare(b.item.displayName)
      )
      .slice(0, 80);
  }, [appearanceSearch, appearanceTarget?.label, eligibleChoices]);

  const gatedOut = categoryChoices.length - eligibleChoices.length;

  const requestTemplate = () => {
    if (nativeAvailable) onRequestTemplate();
    else inputRef.current?.click();
  };

  return (
    <section className="workspace-panel output-panel">
      <div className="panel-heading">
        <span className="step-number">3</span>
        <h2>RaceMenu output</h2>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".jslot,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onChooseTemplate(file);
          event.currentTarget.value = "";
        }}
      />
      <label className="field-label">Starting point</label>
      <div className="foundation-picker">
        <button
          type="button"
          className={template?.foundation === "fresh" ? "active" : ""}
          onClick={onUseFreshFoundation}
        >
          <strong>Build from photo</strong>
          <small>No source JSlot required</small>
        </button>
        <button
          type="button"
          className={template?.foundation === "template" ? "active" : ""}
          onClick={requestTemplate}
        >
          <FolderIcon />
          <span>
            <strong>Inherit optional base</strong>
            <small>{template?.foundation === "template" ? template.fileName : "hair, eyes, brows, sculpt"}</small>
          </span>
        </button>
      </div>
      <label className="field-label" htmlFor="preset-name">Output name</label>
      <div className="preset-name-row">
        <input
          id="preset-name"
          value={presetName}
          onChange={(event) => onPresetNameChange(event.target.value)}
          spellCheck={false}
        />
        <span>
          {outputMode === "preset-pack"
            ? ".zip"
            : outputMode === "racemenu-export-stage"
              ? " head export"
              : " kit"}
        </span>
      </div>

      <div className="guidance-card target-actor">
        <div className="guidance-heading">
          <h3>Target race and sex</h3>
          <span>{playableRaces.length > 0 ? "installed RACE records" : "waiting for index"}</span>
        </div>
        <div className="appearance-tabs" role="group" aria-label="Target sex">
          {(["female", "male"] as const).map((sex) => (
            <button
              type="button"
              key={sex}
              className={targetSex === sex ? "active" : ""}
              onClick={() => onTargetSexChange(sex)}
            >
              {sex}
            </button>
          ))}
        </div>
        <select
          className="appearance-search"
          value={targetRace ?? ""}
          aria-label="Target race"
          onChange={(event) => onTargetRaceChange(event.target.value || null)}
        >
          <option value="">
            {playableRaces.length > 0 ? "No race filter (show every record)" : "Index Skyrim to list races"}
          </option>
          {playableRaces.map((race) => (
            <option key={race.editorId} value={race.editorId}>
              {race.name ?? race.editorId} · {race.editorId}
              {race.faceGenHead ? "" : " (no FaceGen head)"}
            </option>
          ))}
        </select>
        <label className="toggle-row sex-touchup-toggle">
          <span>
            <strong>Sex proportion touch-up</strong>
            <small>
              {sexTouchUp
                ? targetSex === "male"
                  ? "On — slight firmer jaw/brow, a touch less eye/lip softness"
                  : "On — slight softer jaw, a touch more eye/lip"
                : "Off — photo proportions only (recommended default)"}
            </small>
          </span>
          <input
            type="checkbox"
            checked={sexTouchUp}
            onChange={(event) => onSexTouchUpChange(event.target.checked)}
          />
          <span className="toggle-track" aria-hidden="true">
            <span />
          </span>
        </label>
        <p className="guidance-caveat">
          This is the race and sex you must set in RaceMenu <strong>before</strong> loading the
          preset. It filters the head-part lists below to the records Skyrim will actually offer,
          and it is written into the export README. Changing the race also rebuilds sliders as
          offsets from that race&apos;s default head proportions. The optional sex touch-up only
          nudges those baselines slightly toward a firmer male or softer female read — it never
          replaces the photo.
        </p>
      </div>

      <div className="template-summary">
        <h3>{template?.foundation === "fresh" ? "Photo-built foundation" : "Inherited character base"}</h3>
        <dl>
          <div>
            <dt>Race / sex</dt>
            <dd>
              {selectedRace ? `${selectedRace.name ?? selectedRace.editorId} / ${targetSex}` : `any race / ${targetSex}`}
            </dd>
          </div>
          <div>
            <dt>Head parts</dt>
            <dd>
              {template?.foundation === "fresh"
                ? selectedAppearance.length > 0
                  ? `${selectedAppearance.length} exact selection(s) + race defaults`
                  : "race defaults"
                : `${template?.summary.headPartCount ?? 0} inherited + ${selectedAppearance.length} selected`}
            </dd>
          </div>
          <div><dt>Sculpt hosts</dt><dd>{template?.summary.sculptHostCount ?? "—"}</dd></div>
          <div><dt>Companions</dt><dd>{trioAvailable ? "NIF + DDS" : template ? "not complete" : "—"}</dd></div>
        </dl>
      </div>

      {template?.foundation === "fresh" && (
        <div className="texture-truth">
          <strong>Texture / DDS</strong>
          <span>
            RaceMenu creates the matching FaceTint DDS during the in-game head export stage.
            A flat portrait is not emitted as a broken Skyrim UV texture.
          </span>
        </div>
      )}

      <div className="guidance-card race-guidance">
        <div className="guidance-heading">
          <h3>Recommended race foundation</h3>
          <span>shape only</span>
        </div>
        {raceRecommendations.length > 0 ? (
          <>
            <div className="race-recommendations">
              {raceRecommendations.map((recommendation, index) => {
                const installed = playableRaces.find(
                  (race) =>
                    (race.name ?? "").replace(/\s+/g, "").toLowerCase() ===
                      recommendation.race.replace(/\s+/g, "").toLowerCase() ||
                    race.editorId
                      .toLowerCase()
                      .startsWith(recommendation.race.replace(/\s+/g, "").toLowerCase())
                );
                const active = Boolean(installed && installed.editorId === targetRace);
                return (
                  <button
                    type="button"
                    className={`race-choice${index === 0 ? " primary" : ""}${active ? " selected" : ""}`}
                    key={recommendation.race}
                    disabled={!installed}
                    aria-pressed={active}
                    onClick={() => installed && onTargetRaceChange(installed.editorId)}
                  >
                    <strong>{recommendation.race}</strong>
                    <span>{recommendation.score}% geometry fit</span>
                    <small>{recommendation.reasons.join(" · ")}</small>
                    <small>
                      {installed
                        ? active
                          ? `Target: ${installed.editorId}`
                          : `Click to target ${installed.editorId}`
                        : "No matching installed RACE record"}
                    </small>
                  </button>
                );
              })}
            </div>
            <p>
              This ranks EFM-compatible mesh foundations only. Skin color and real-world
              ethnicity are never analyzed. Selecting a race sets the measurement baseline to
              that race&apos;s estimated default head, so the same photo produces race-relative
              slider offsets rather than one universal neutral.
            </p>
          </>
        ) : (
          <p>Analyze the image to rank supported Skyrim race foundations.</p>
        )}
      </div>

      <div className="guidance-card shape-style-guidance">
        <div className="guidance-heading">
          <h3>Geometry style bridge</h3>
          <span>optional · not ethnicity</span>
        </div>
        <p className="guidance-caveat">
          Hand-authored presets that aim for a compact soft midface (narrow bridge/cheeks, softer
          jaw, larger eyes) often sit on Breton or Wood Elf foundations and lean hard on those
          EFM axes — and often on sculpt/external heads FaceForge cannot copy. This optional
          style only nudges the same shape axes and can pre-select a preferred race. It never
          classifies real-world ethnicity or skin color.
        </p>
        <div className="race-recommendations">
          <button
            type="button"
            className={`race-choice${shapeStyle === "none" ? " selected" : ""}`}
            aria-pressed={shapeStyle === "none"}
            onClick={() => onShapeStyleChange("none")}
          >
            <strong>Photo only</strong>
            <span>default</span>
            <small>No silhouette nudge beyond race and optional sex touch-up</small>
          </button>
          {shapeStyleCatalog.map((style) => {
            const ranked = shapeStyleRecommendations.find((item) => item.id === style.id);
            const active = shapeStyle === style.id;
            return (
              <button
                type="button"
                className={`race-choice${ranked && ranked === shapeStyleRecommendations[0] ? " primary" : ""}${active ? " selected" : ""}`}
                key={style.id}
                aria-pressed={active}
                onClick={() => onShapeStyleChange(style.id)}
              >
                <strong>{style.label}</strong>
                <span>
                  {ranked ? `${ranked.score}% geometry cue fit` : "analyze photo to score"}
                </span>
                <small>{style.summary}</small>
                <small>Prefers: {style.preferredRaces.join(" · ")}</small>
              </button>
            );
          })}
        </div>
        {shapeStyle !== "none" && shapeStyleDefinition(shapeStyle) ? (
          <p>
            Active style nudges midface/bridge/jaw/eye baselines and keeps the photo in charge.
            Pick a different race above anytime — the style still applies on top.
          </p>
        ) : null}
      </div>

      <div className="guidance-card appearance-guidance">
        <div className="guidance-heading">
          <h3>Installed exact appearance choices</h3>
          <span>{appearanceChoices.length > 0 ? "parsed HDPT records" : "waiting for index"}</span>
        </div>
        <div className="appearance-tabs" role="group" aria-label="Appearance category">
          {SELECTABLE_CATEGORIES.map((category) => (
            <button
              type="button"
              key={category}
              className={appearanceCategory === category ? "active" : ""}
              onClick={() => {
                setAppearanceCategory(category);
                setAppearanceSearch("");
              }}
            >
              {CATEGORY_LABELS[category]}
            </button>
          ))}
        </div>
        <div className="appearance-gate">
          {eligibleChoices.length.toLocaleString()} of {categoryChoices.length.toLocaleString()}{" "}
          installed {CATEGORY_LABELS[appearanceCategory]} records fit{" "}
          {selectedRace?.editorId ?? "any race"} / {targetSex}
          {gatedOut > 0
            ? ` · ${gatedOut.toLocaleString()} hidden by the record's own gender flags, ValidRaces list, or Playable flag`
            : ""}
        </div>
        {appearanceTarget && (
          <div className="feature-target">
            <strong>Photo target: {appearanceTarget.label}</strong>
            <span>{appearanceTarget.description}</span>
          </div>
        )}
        <input
          className="appearance-search"
          value={appearanceSearch}
          onChange={(event) => setAppearanceSearch(event.target.value)}
          placeholder={`Search exact ${appearanceCategory} names, plugins, or FormIDs`}
          aria-label={`Search ${appearanceCategory}`}
        />
        {visibleAppearanceChoices.length > 0 ? (
          <div className="appearance-list">
            {[...visibleAppearanceChoices]
              .sort((a, b) => {
                // Prefer High Poly Head and other high-scoring install parts at the top of the list.
                const pref =
                  scoreHeadPartPreference(b.item) - scoreHeadPartPreference(a.item);
                if (pref !== 0) return pref;
                return b.nameScore - a.nameScore;
              })
              .map(({ item, nameScore }) => {
              const selected = selectedAppearance.some(
                (choice) => choice.formIdentifier === item.formIdentifier
              );
              const hph = isHighPolyHeadChoice(item);
              return (
                <button
                  type="button"
                  className={`appearance-recommendation appearance-choice ${selected ? "selected" : ""}${hph ? " preferred-head" : ""}`}
                  key={`${item.category}-${item.formIdentifier}`}
                  onClick={() => onAppearanceChoice(item)}
                  aria-pressed={selected}
                >
                  <div>
                    <strong>
                      {selected ? "Selected: " : nameScore > 0 ? "Name match: " : ""}
                      {item.displayName}
                      {hph ? " · High Poly Head" : ""}
                    </strong>
                    <span>
                      {item.formIdentifier}
                      {item.editorId && item.editorId !== item.displayName
                        ? ` · ${item.editorId}`
                        : ""}
                    </span>
                  </div>
                  <small>
                    sex: {item.sex} · races:{" "}
                    {item.validRaces.length > 0
                      ? `${item.validRacesEditorId ?? "list"} (${item.validRaces.length})`
                      : "unresolved — verify in RaceMenu"}
                  </small>
                  <small>
                    {item.sourceMod ?? "deployed plugin"} · winner: {item.pluginName}
                    {item.masters.length > 0 ? ` · masters: ${item.masters.join(", ")}` : ""}
                  </small>
                  {item.missingMasters.length > 0 && (
                    <small className="missing-requirement">
                      Missing: {item.missingMasters.join(", ")}
                    </small>
                  )}
                  <small>
                    {hph
                      ? "Preferred when High Poly Head is installed — modern presets and EFM sculpt hosts use this topology."
                      : nameScore > 0
                        ? "Name supports the photo target"
                        : item.matchEvidence}
                  </small>
                </button>
              );
            })}
          </div>
        ) : (
          <p>
            {dependencyIndexed
              ? `No installed ${CATEGORY_LABELS[appearanceCategory]} record is valid for ${selectedRace?.editorId ?? "this race"} / ${targetSex} with this search.`
              : "Skyrim/Vortex will be indexed automatically when detected; manual selection remains in Settings."}
          </p>
        )}
        <p className="guidance-caveat">
          Category comes from each record&apos;s own HDPT Type subrecord, and the sex and race gates
          come from its flags and ValidRaces form list — not from its name. When the index finds
          High Poly Head, FaceForge auto-selects its face mesh for the active race/sex (you can
          override). The selected FormID is written into the JSlot. Confirm looks visually in
          RaceMenu. Skin/body replacers are deliberately not treated as head-mesh choices.
        </p>
      </div>

      <div className="dependency-card">
        <div className="dependency-heading">
          <h3>Required plugin index</h3>
          <span className={dependencyIndexed ? "index-live" : ""}>
            {dependencyIndexed ? `${presentCount}/${dependencies.length} present` : "index not run"}
          </span>
        </div>
        {template ? (
          dependencies.length > 0 ? (
            <div className="dependency-list">
              {dependencies.map((dependency) => (
                <div className="dependency-row" key={dependency.pluginName}>
                  <span className={dependency.present ? "dependency-dot present" : "dependency-dot missing"} />
                  <strong>{dependency.pluginName}</strong>
                  <small>
                    {dependency.baseGame
                      ? "base game"
                      : dependency.sourceMod ?? (dependencyIndexed ? "missing" : "unresolved")}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p>No external plugin names were declared by this template.</p>
          )
        ) : (
          <p>Load a template to resolve exact plugin providers from Vortex.</p>
        )}
      </div>

      <div className="output-mode-block">
        <label className="field-label">Package target</label>
        <div className="output-mode-picker" role="group" aria-label="Package target">
          <button
            type="button"
            className={outputMode === "racemenu-export-stage" ? "active" : ""}
            onClick={() => onOutputModeChange("racemenu-export-stage")}
          >
            <strong>RaceMenu Head Export</strong>
            <small>JSLOT + exact choices; make NIF/DDS in-game</small>
          </button>
          <button
            type="button"
            className={outputMode === "preset-pack" ? "active" : ""}
            onClick={() => onOutputModeChange("preset-pack")}
          >
            <strong>Preset Pack</strong>
            <small>RaceMenu JSLOT + dependency report</small>
          </button>
          <button
            type="button"
            className={outputMode === "follower-head-kit" ? "active" : ""}
            onClick={() => onOutputModeChange("follower-head-kit")}
            disabled={!trioAvailable}
            title={trioAvailable ? "" : "A complete matching JSLOT/NIF/DDS trio is required"}
          >
            <strong>Follower Head Kit</strong>
            <small>Preserved source trio + handoff</small>
          </button>
        </div>
        <div className="baked-head-step">
          <p>
            A JSlot is not a head. FollowerForge lists a face only once Skyrim has baked the
            matching <code>{presetName}.nif</code> and <code>.dds</code> into
            <code> Data\SKSE\Plugins\CharGen</code>. Export the head stage, load it in RaceMenu at
            the race and sex above, save the preset back out with sculpt data, then come back here.
          </p>
          <button
            type="button"
            className="text-button"
            onClick={onFindBakedHead}
            disabled={!nativeAvailable}
          >
            {trioAvailable
              ? `Baked head found for ${template?.fileName ?? presetName}`
              : `Check Skyrim for a baked head named "${presetName}"`}
          </button>
        </div>
        <p className="guidance-caveat">
          An install-ready follower still needs that baked trio plus race, voice, class,
          placement, equipment, spells, perks, and an NPC plugin built in FollowerForge.
        </p>
      </div>

      {outputMode === "follower-head-kit" && (
        <label className="permission-row">
          <input
            type="checkbox"
            checked={permissionConfirmed}
            onChange={(event) => onPermissionConfirmedChange(event.target.checked)}
          />
          <span>I confirm I may package these source head assets.</span>
        </label>
      )}

      <div className="likeness-control">
        <div className="control-label-row">
          <label htmlFor="likeness">Likeness strength</label>
          <strong>{Math.round(likeness * 100)}%</strong>
        </div>
        <input
          id="likeness"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={likeness}
          onChange={(event) => onLikenessChange(Number(event.target.value))}
        />
        <div className="range-labels"><span>Subtle</span><span>Full</span></div>
      </div>

      {template?.foundation === "template" && <label className="toggle-row">
        <span>
          Preserve existing sculpt
          <small>
            {outputMode === "follower-head-kit"
              ? "Required: keeps the JSLOT aligned with its source NIF/DDS."
              : template?.summary.hasSculpt
                ? "Template contains sculpt data."
                : "Template has no sculpt data."}
          </small>
        </span>
        <input
          type="checkbox"
          checked={preserveSculpt}
          disabled={outputMode === "follower-head-kit"}
          onChange={(event) => onPreserveSculptChange(event.target.checked)}
        />
        <span className="toggle-track" aria-hidden="true"><span /></span>
      </label>}

      <div className="guidance-card preset-report">
        <div className="guidance-heading">
          <h3>Finished preset check</h3>
          <span className={presetReport ? (presetReport.shareReady ? "index-live" : "") : ""}>
            {presetReport
              ? presetReport.shareReady
                ? "ready to share"
                : `${presetReport.blockers.length} blocker${presetReport.blockers.length === 1 ? "" : "s"}`
              : "not checked"}
          </span>
        </div>
        {presetReport ? (
          <>
            <dl className="report-grid">
              <div>
                <dt>File</dt>
                <dd>{presetReport.fileName}</dd>
              </div>
              <div>
                <dt>Sliders</dt>
                <dd>
                  {presetReport.customMorphCount}
                  {presetReport.morphFamilies.length > 0
                    ? ` (${presetReport.morphFamilies
                        .map((family) => `${family.family} ${family.count}`)
                        .join(", ")})`
                    : ""}
                </dd>
              </div>
              <div>
                <dt>Sculpt</dt>
                <dd>
                  {presetReport.sculptHosts.length > 0
                    ? `${presetReport.sculptHosts.length} host(s)`
                    : "none"}
                </dd>
              </div>
              <div>
                <dt>Vanilla base</dt>
                <dd>{presetReport.hasVanillaBase ? "present" : "absent"}</dd>
              </div>
              <div>
                <dt>Tint layers</dt>
                <dd>{presetReport.tintLayerCount || "none"}</dd>
              </div>
              <div>
                <dt>Weight</dt>
                <dd>{presetReport.weight}</dd>
              </div>
            </dl>

            <h4>Head parts ({presetReport.headParts.length})</h4>
            <div className="report-parts">
              {presetReport.headParts.map((part) => (
                <div
                  className={part.resolved ? "report-part" : "report-part unresolved"}
                  key={part.formIdentifier}
                >
                  <strong>{part.displayName ?? part.formIdentifier}</strong>
                  <span>
                    {part.category} · {part.sex} · {part.pluginName}
                  </span>
                  <small>
                    {part.resolved
                      ? `${part.sourceMod ?? "deployed plugin"}${
                          part.validRaces.length > 0 ? ` · ${part.validRaces.length} valid races` : ""
                        }`
                      : "Not found in the indexed head-part records on this machine"}
                  </small>
                </div>
              ))}
            </div>

            <h4>Required plugins ({presetReport.dependencies.length})</h4>
            <div className="dependency-list">
              {presetReport.dependencies.map((dependency) => (
                <div className="dependency-row" key={dependency.pluginName}>
                  <span
                    className={
                      dependency.present ? "dependency-dot present" : "dependency-dot missing"
                    }
                  />
                  <strong>{dependency.pluginName}</strong>
                  <small>
                    {dependency.baseGame
                      ? "base game"
                      : dependency.sourceMod ?? "not installed here"}
                  </small>
                </div>
              ))}
            </div>

            {presetReport.blockers.length > 0 && (
              <ul className="warning-list">
                {presetReport.blockers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {presetReport.notes.length > 0 && (
              <p className="guidance-caveat">{presetReport.notes.join(" ")}</p>
            )}
            <p className="guidance-caveat">
              These are the requirements as the file stands now, recomputed from its own head-part
              records — not the ones FaceForge guessed when it first wrote the preset. Export a
              Preset Pack to ship this list with the file, or use the Follower Head Kit once the
              head is baked.
            </p>
          </>
        ) : (
          <p>
            Edited the preset in RaceMenu? Load it back and FaceForge re-reads what it now needs:
            every head part by name, every plugin those parts come from, whether each one is
            installed here, and whether the file is safe to share or hand to FollowerForge.
          </p>
        )}
        <button
          type="button"
          className="text-button"
          onClick={onInspectPreset}
          disabled={!nativeAvailable}
        >
          {presetReport ? "Check another preset" : "Check a finished preset"}
        </button>
      </div>

      <div className="guidance-card slider-inventory">
        <div className="guidance-heading">
          <h3>Slider inventory</h3>
          <span>{sliderInventory ? `${sliderInventory.names.size} installed` : "EFM only"}</span>
        </div>
        <input
          ref={inventoryRef}
          type="file"
          accept=".jslot,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onChooseSliderInventory(file);
            event.currentTarget.value = "";
          }}
        />
        {sliderInventory ? (
          <>
            <div className="inventory-families">
              {Object.entries(sliderInventory.familyCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([family, count]) => (
                  <span key={family}>
                    <strong>{family}</strong> {count}
                  </span>
                ))}
            </div>
            <p>
              Read from <code>{sliderInventory.fileName}</code>. FaceForge writes{" "}
              {writtenCount} of the {matchedCount} sliders it can measure in this install.
            </p>
            {matchedCount > writtenCount ? (
              <p className="inventory-note">
                The other {matchedCount - writtenCount} are duplicates, not omissions. EFM, CME,
                NSK and SPG are separate mods with separate morphs, and RaceMenu adds them all
                together &mdash; so a brow height written into all four moves the brow four times.
                Only the strongest family each measurement appears in is written.
              </p>
            ) : null}
            <button type="button" className="text-button" onClick={onClearSliderInventory}>
              Forget this inventory
            </button>
          </>
        ) : (
          <p>
            FaceForge is writing the Expressive Facegen Morphs family only, because that is the
            one it can confirm from the plugin index. If you have CME, NSK, SPG or RAN's slider
            mods, save a RaceMenu preset with those sliders touched and load it here — FaceForge
            will then write every slider it can measure that your install actually defines.
          </p>
        )}
        <button type="button" className="text-button" onClick={() => inventoryRef.current?.click()}>
          {sliderInventory ? "Load a different preset" : "Load a preset to read your sliders"}
        </button>
      </div>

      <div className="generated-heading">
        <h3>Generated sliders <span>(editable)</span></h3>
        <span>{groups.reduce((count, group) => count + group.sliders.length, 0)} values</span>
      </div>

      <div className="slider-groups">
        {groups.length === 0 ? (
          <div className="slider-empty">Analyze a portrait to generate sliders.</div>
        ) : groups.map((group) => {
          const isOpen = openGroup === group.id;
          const changed = group.sliders.some(
            (slider) => values[slider.name] !== generatedValues[slider.name]
          );
          return (
            <div className={`slider-group ${isOpen ? "open" : ""}`} key={group.id}>
              <button
                type="button"
                className="slider-group-header"
                onClick={() => setOpenGroup(isOpen ? null : group.id)}
                aria-expanded={isOpen}
              >
                {iconFor(group.id)}
                <span>{group.title}</span>
                <small>{group.sliders.length} sliders{changed ? " · edited" : ""}</small>
                <ChevronIcon />
              </button>
              {isOpen && (
                <div className="slider-group-body">
                  {group.sliders.map((slider) => {
                    const shown = finalValue(values[slider.name] ?? slider.value, likeness);
                    const held = slider.confidence < 0.35;
                    const reduced = !held && slider.confidence < 0.9;
                    return (
                      <label
                        className={`slider-row${held ? " held" : reduced ? " reduced" : ""}`}
                        key={slider.name}
                        title={
                          held
                            ? `Source: ${slider.source} — the photo could not measure this, so it is left at the neutral default. Set it by hand if you know the shape.`
                            : reduced
                              ? `Source: ${slider.source} — measured at ${Math.round(slider.confidence * 100)}% confidence and faded toward neutral by the rest.`
                              : `Source: ${slider.source}`
                        }
                      >
                        <span>
                          {slider.label}
                          {held ? <em className="slider-flag held">neutral</em> : null}
                          {reduced ? (
                            <em className="slider-flag">{Math.round(slider.confidence * 100)}%</em>
                          ) : null}
                        </span>
                        <input
                          type="range"
                          min={-slider.range}
                          max={slider.range}
                          step="0.01"
                          value={shown}
                          onChange={(event) => onSliderChange(slider.name, Number(event.target.value))}
                        />
                        <input
                          className="slider-number"
                          type="number"
                          min={-slider.range}
                          max={slider.range}
                          step="0.01"
                          value={shown}
                          onChange={(event) => onSliderChange(slider.name, Number(event.target.value))}
                        />
                      </label>
                    );
                  })}
                  <button type="button" className="text-button" onClick={() => onResetGroup(group)}>
                    Reset this group
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
