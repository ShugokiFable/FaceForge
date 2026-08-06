import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const Base = ({ children, ...props }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    {children}
  </svg>
);

export const FolderIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M3 6.8h6l2 2h10v8.7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M3 9h18" />
  </Base>
);

export const ScanIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
    <circle cx="12" cy="11" r="3.2" />
    <path d="M7.5 18c1-2.4 2.5-3.6 4.5-3.6s3.5 1.2 4.5 3.6" />
  </Base>
);

export const DownloadIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 3v12" />
    <path d="m7 11 5 5 5-5" />
    <path d="M4 20h16" />
  </Base>
);

export const SettingsIcon = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z" />
  </Base>
);

export const ChevronIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="m9 5 7 7-7 7" />
  </Base>
);

export const InfoIcon = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 10.8V17" />
    <path d="M12 7.2h.01" />
  </Base>
);

export const MonitorIcon = (props: IconProps) => (
  <Base {...props}>
    <rect x="3" y="4" width="18" height="13" rx="1.5" />
    <path d="M8 21h8M12 17v4" />
  </Base>
);

export const CloseIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Base>
);

export const MinimizeIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M5 12h14" />
  </Base>
);

export const MaximizeIcon = (props: IconProps) => (
  <Base {...props}>
    <rect x="5" y="5" width="14" height="14" rx="1" />
  </Base>
);

export const FaceIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M8 4.5C5.7 6 4.5 8.5 4.5 12c0 4.8 3.2 8 7.5 8s7.5-3.2 7.5-8c0-3.5-1.2-6-3.5-7.5C13.5 3 10.5 3 8 4.5z" />
    <path d="M8.5 11h.01M15.5 11h.01M9 16c2 1.2 4 1.2 6 0" />
  </Base>
);

export const EyeIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5z" />
    <circle cx="12" cy="12" r="2.5" />
  </Base>
);

export const NoseIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 3c-.4 5-1.4 8.8-3 11.5-.8 1.4-.2 3.1 1.4 3.4 2.4.5 4.4.2 5.8-.9" />
  </Base>
);

export const MouthIcon = (props: IconProps) => (
  <Base {...props}>
    <path d="M3 13c2.5-1 4.5-3.5 7-3 1 .2 1.3 1 2 1s1-.8 2-1c2.5-.5 4.5 2 7 3-2 4-5 6-9 6s-7-2-9-6z" />
    <path d="M4 13h16" />
  </Base>
);
