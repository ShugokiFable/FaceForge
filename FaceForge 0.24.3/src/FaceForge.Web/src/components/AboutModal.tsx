import { useEffect, useState } from "react";
import type {
  CliProviderStatus,
  EnvironmentSummary
} from "../domain/nativeBridge";
import { CloseIcon, FolderIcon, ScanIcon } from "./Icons";

export type VisionProvider = "codex" | "claude" | "gemini" | "openrouter";

/** Mod Organizer 2 selection state: the mods folder, the resolved profiles, and the current pick. */
export interface Mo2State {
  modsPath: string;
  profile: string;
  profiles: string[];
  gameDataPath: string | null;
  error: string | null;
}

export interface VisionSettings {
  enabled: boolean;
  provider: VisionProvider;
  apiKey: string;
  model: string;
  consent: boolean;
}

interface AboutModalProps {
  environment: EnvironmentSummary | null;
  isIndexing: boolean;
  nativeAvailable: boolean;
  vision: VisionSettings;
  providerStatuses: CliProviderStatus[];
  onVisionChange: (settings: VisionSettings) => void;
  onIndex: () => void;
  mo2: Mo2State;
  onMo2ModsPathChange: (path: string) => void;
  onMo2Browse: () => void;
  onMo2ListProfiles: (path: string) => void;
  onMo2ProfileChange: (profile: string) => void;
  onMo2Index: (modsPath: string, profile: string) => void;
  onLoadIndexedPreset: (id: string) => void;
  onConnectProvider: (provider: VisionProvider) => void;
  onOpenProviderDocs: (provider: VisionProvider) => void;
  onClose: () => void;
}

/**
 * Suggested OpenRouter models that accept an image and reply with text/JSON (what FaceForge needs).
 * Deliberately excludes image-generation models, which return a picture and fail structured parsing.
 * Shown as datalist hints only — any vision model ID can still be typed.
 */
const VISION_MODEL_SUGGESTIONS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "openai/gpt-4o",
  "openai/gpt-4.1",
  "anthropic/claude-3.7-sonnet",
  "qwen/qwen2.5-vl-72b-instruct"
];

const providerLabel = (provider: VisionProvider) => {
  switch (provider) {
    case "codex": return "ChatGPT account (Codex)";
    case "claude": return "Claude subscription (Claude Code)";
    case "gemini": return "Google / Gemini subscription";
    case "openrouter": return "OpenRouter API key";
  }
};

export default function AboutModal({
  environment,
  isIndexing,
  nativeAvailable,
  vision,
  providerStatuses,
  onVisionChange,
  onIndex,
  mo2,
  onMo2ModsPathChange,
  onMo2Browse,
  onMo2ListProfiles,
  onMo2ProfileChange,
  onMo2Index,
  onLoadIndexedPreset,
  onConnectProvider,
  onOpenProviderDocs,
  onClose
}: AboutModalProps) {
  const [selectedPreset, setSelectedPreset] = useState("");

  useEffect(() => {
    if (!selectedPreset && environment?.presets[0]) {
      setSelectedPreset(environment.presets[0].id);
    }
  }, [environment, selectedPreset]);

  const updateVision = (patch: Partial<VisionSettings>) =>
    onVisionChange({ ...vision, ...patch });
  const cliStatus = providerStatuses.find((item) => item.id === vision.provider);
  const usesOfficialCli = vision.provider !== "openrouter";

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          aria-label="Close settings"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
        <h2 id="settings-title">FaceForge settings</h2>
        <p>
          Version 0.24.15 is a standalone app. Face analysis stays local unless you
          explicitly enable and run optional vision refinement.
        </p>

        <div className="settings-section">
          <div className="settings-section-heading">
            <div>
              <h3>Skyrim environment index</h3>
              <small>Automatic read-only Skyrim, Vortex, CharGen, and appearance discovery</small>
            </div>
            <button
              type="button"
              className="compact-button"
              disabled={!nativeAvailable || isIndexing}
              onClick={onIndex}
            >
              <ScanIcon />
              {isIndexing ? "Indexingâ€¦" : environment ? "Re-index" : "Index Data"}
            </button>
          </div>
          {environment ? (
            <>
              <div className="detected-environment">
                <strong>{environment.autoDetected ? "Detected automatically" : "Selected manually"}</strong>
                <span>{environment.detectionMethod}</span>
                <small>{environment.gameDataPath}</small>
              </div>
              <dl className="index-stats">
                <div><dt>Winning plugins</dt><dd>{environment.pluginCount.toLocaleString()}</dd></div>
                <div><dt>Source mods</dt><dd>{environment.sourceModCount.toLocaleString()}</dd></div>
                <div><dt>Relevant assets</dt><dd>{environment.relevantAssetCount.toLocaleString()}</dd></div>
                <div><dt>BSA archives</dt><dd>{environment.bsaCount.toLocaleString()}</dd></div>
                <div><dt>CharGen presets</dt><dd>{environment.presetCount.toLocaleString()}</dd></div>
              </dl>
              <label className="settings-label" htmlFor="indexed-preset">
                Indexed character base
              </label>
              <div className="indexed-preset-row">
                <select
                  id="indexed-preset"
                  value={selectedPreset}
                  onChange={(event) => setSelectedPreset(event.target.value)}
                >
                  {environment.presets.map((preset) => (
                    <option value={preset.id} key={preset.id}>
                      {preset.fileName} Â· {preset.hasNif && preset.hasDds ? "trio" : "JSlot only"}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="compact-button"
                  disabled={!selectedPreset}
                  onClick={() => onLoadIndexedPreset(selectedPreset)}
                >
                  <FolderIcon />
                  Use
                </button>
              </div>
            </>
          ) : (
            <div className="settings-empty">
              {nativeAvailable
                ? "FaceForge checks Steam, Skyrim, Vortex, and CharGen automatically. Use this button only if the game is in an unusual location."
                : "Environment indexing is available in the Windows app."}
            </div>
          )}
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <div>
              <h3>Mod Organizer 2 instance</h3>
              <small>
                Index the enabled mods and load order from an MO2 profile. Use this when your
                mods live in an MO2 mods folder rather than deployed into the game Data folder.
              </small>
            </div>
          </div>
          <label className="settings-label" htmlFor="mo2-mods">
            MO2 mods folder
          </label>
          <div className="indexed-preset-row">
            <input
              id="mo2-mods"
              value={mo2.modsPath}
              spellCheck={false}
              placeholder="E:\MGO\4beta\mods"
              onChange={(event) => onMo2ModsPathChange(event.target.value)}
            />
            <button
              type="button"
              className="compact-button"
              disabled={!nativeAvailable}
              onClick={onMo2Browse}
            >
              <FolderIcon />
              Browse
            </button>
            <button
              type="button"
              className="compact-button"
              disabled={!nativeAvailable || !mo2.modsPath.trim()}
              onClick={() => onMo2ListProfiles(mo2.modsPath.trim())}
            >
              <ScanIcon />
              Load profiles
            </button>
          </div>

          {mo2.profiles.length > 0 && (
            <>
              <label className="settings-label" htmlFor="mo2-profile">
                MO2 profile
              </label>
              <div className="indexed-preset-row">
                <select
                  id="mo2-profile"
                  value={mo2.profile}
                  onChange={(event) => onMo2ProfileChange(event.target.value)}
                >
                  {mo2.profiles.map((profile) => (
                    <option value={profile} key={profile}>
                      {profile}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="compact-button"
                  disabled={!nativeAvailable || isIndexing || !mo2.profile}
                  onClick={() => onMo2Index(mo2.modsPath.trim(), mo2.profile)}
                >
                  <ScanIcon />
                  {isIndexing ? "Indexing…" : "Index MO2 profile"}
                </button>
              </div>
            </>
          )}

          {mo2.gameDataPath && (
            <div className="detected-environment">
              <strong>Base game detected for this instance</strong>
              <small>{mo2.gameDataPath}</small>
            </div>
          )}
          {mo2.error && <div className="settings-empty">{mo2.error}</div>}
          {!nativeAvailable && (
            <div className="settings-empty">
              MO2 indexing is available in the Windows app.
            </div>
          )}
        </div>

        <div className="settings-section">
          <label className="settings-toggle">
            <span>
              <strong>Optional AI vision refinement</strong>
              <small>The prepared portrait is sent only when you press Refine</small>
            </span>
            <input
              type="checkbox"
              checked={vision.enabled}
              onChange={(event) => updateVision({ enabled: event.target.checked })}
            />
          </label>
          {vision.enabled && (
            <div className="vision-fields">
              <label className="settings-label" htmlFor="vision-provider">
                Vision account
              </label>
              <select
                id="vision-provider"
                value={vision.provider}
                onChange={(event) =>
                  updateVision({ provider: event.target.value as VisionProvider, consent: false })
                }
              >
                {(["codex", "claude", "gemini", "openrouter"] as VisionProvider[]).map(
                  (provider) => (
                    <option key={provider} value={provider}>{providerLabel(provider)}</option>
                  )
                )}
              </select>

              {usesOfficialCli ? (
                <div className="provider-card">
                  <div>
                    <strong>{cliStatus?.displayName ?? providerLabel(vision.provider)}</strong>
                    <small>
                      {cliStatus?.installed
                        ? "Official CLI found on this PC"
                        : "Official CLI must be installed first"}
                    </small>
                  </div>
                  <div className="provider-actions">
                    <button
                      type="button"
                      className="compact-button"
                      onClick={() => onConnectProvider(vision.provider)}
                    >
                      {cliStatus?.installed ? "Connect / sign in" : "Install"}
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onOpenProviderDocs(vision.provider)}
                    >
                      Official help
                    </button>
                  </div>
                  <p>
                    FaceForge runs the providerâ€™s official CLI. Login tokens remain
                    under that CLIâ€™s control and are never copied into FaceForge.
                  </p>
                </div>
              ) : (
                <>
                  <label className="settings-label" htmlFor="openrouter-key">
                    OpenRouter API key
                  </label>
                  <input
                    id="openrouter-key"
                    type="password"
                    value={vision.apiKey}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Session only; never saved"
                    onChange={(event) => updateVision({ apiKey: event.target.value })}
                  />
                  <label className="settings-label" htmlFor="openrouter-model">
                    Vision (image-understanding) model ID
                  </label>
                  <input
                    id="openrouter-model"
                    value={vision.model}
                    spellCheck={false}
                    list="openrouter-vision-models"
                    placeholder="e.g. google/gemini-2.5-flash"
                    onChange={(event) => updateVision({ model: event.target.value })}
                  />
                  <datalist id="openrouter-vision-models">
                    {VISION_MODEL_SUGGESTIONS.map((id) => (
                      <option value={id} key={id} />
                    ))}
                  </datalist>
                  <small className="settings-hint">
                    Pick a model that <strong>reads a photo and replies with text</strong>.
                    Image-<em>generation</em> models — anything ending in <code>-image</code> or{" "}
                    <code>-image-pro</code> (e.g. <code>google/gemini-3-pro-image</code>,{" "}
                    <code>microsoft/mai-image-2.5-pro</code>) return a picture, not analysis, and
                    will fail here.
                  </small>
                </>
              )}

              <label className="consent-row">
                <input
                  type="checkbox"
                  checked={vision.consent}
                  onChange={(event) => updateVision({ consent: event.target.checked })}
                />
                <span>
                  I consent to sending the prepared portrait to {providerLabel(vision.provider)}
                  {" "}for this one request.
                </span>
              </label>
              <div className="privacy-box">
                Subscriptions are not unlimited: the providerâ€™s current plan quotas and
                rate limits apply. API usage is separate from consumer subscriptions.
              </div>
            </div>
          )}
        </div>

        <button type="button" className="primary-button modal-done" onClick={onClose}>
          Done
        </button>
      </section>
    </div>
  );
}
