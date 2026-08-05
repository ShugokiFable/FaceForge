import { useEffect, useState } from "react";
import type {
  CliProviderStatus,
  EnvironmentSummary
} from "../domain/nativeBridge";
import { CloseIcon, FolderIcon, ScanIcon } from "./Icons";

export type VisionProvider = "codex" | "claude" | "gemini" | "openrouter";

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
  onLoadIndexedPreset: (id: string) => void;
  onConnectProvider: (provider: VisionProvider) => void;
  onOpenProviderDocs: (provider: VisionProvider) => void;
  onClose: () => void;
}

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
          Version 0.23.0 is a standalone app. Face analysis stays local unless you
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
                    Image-capable model ID
                  </label>
                  <input
                    id="openrouter-model"
                    value={vision.model}
                    spellCheck={false}
                    placeholder="For example: provider/model-name"
                    onChange={(event) => updateVision({ model: event.target.value })}
                  />
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
