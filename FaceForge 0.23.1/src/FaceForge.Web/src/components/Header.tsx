import { MaximizeIcon, MinimizeIcon, SettingsIcon, CloseIcon } from "./Icons";

interface HeaderProps {
  templateName: string | null;
  status: "waiting" | "ready" | "working" | "error";
  onSettings: () => void;
}

const hostMessage = (type: string) => {
  const webview = (
    window as typeof window & { chrome?: { webview?: { postMessage: (value: unknown) => void } } }
  ).chrome?.webview;
  webview?.postMessage({ type });
};

export default function Header({ templateName, status, onSettings }: HeaderProps) {
  const statusText = {
    waiting: "Waiting",
    ready: "Ready",
    working: "Analyzing",
    error: "Needs attention"
  }[status];

  return (
    <header
      className="app-header"
      onMouseDown={(event) => {
        if (event.button === 0 && !(event.target as HTMLElement).closest("button")) {
          hostMessage("drag");
        }
      }}
      onDoubleClick={() => hostMessage("maximize")}
    >
      <div className="brand">
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <path d="M20 3 34 11v18L20 37 6 29V11z" />
          <path d="M14 14c-3 4-3 10 0 14M26 14c3 4 3 10 0 14M14 20h12M20 10v20" />
          <circle cx="15" cy="18" r="1.2" />
          <circle cx="25" cy="18" r="1.2" />
        </svg>
        <span>FaceForge</span>
      </div>
      <div className="header-context">
        <span>Template: <strong>{templateName ?? "not selected"}</strong></span>
        <span>Status: <strong className={`status-${status}`}>{statusText}</strong></span>
      </div>
      <div className="header-actions">
        <button type="button" className="settings-button" onClick={onSettings}>
          <SettingsIcon />
          Settings
        </button>
        <button type="button" className="window-button" aria-label="Minimize" onClick={() => hostMessage("minimize")}>
          <MinimizeIcon />
        </button>
        <button type="button" className="window-button" aria-label="Maximize" onClick={() => hostMessage("maximize")}>
          <MaximizeIcon />
        </button>
        <button type="button" className="window-button close" aria-label="Close" onClick={() => hostMessage("close")}>
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}
