import { Icon, type IconProps } from "./Icon";

export function FilesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 3.25h5.7l3.05 3.05v8.45a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 14.75v-10a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M12 3.5V6.5h3M8 9h4.5M8 12h4.5" />
      <path d="M3 6.25v8.5a3 3 0 0 0 3 3h6.75" opacity=".7" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8.75" cy="8.75" r="5" />
      <path d="m12.5 12.5 4 4" />
    </Icon>
  );
}

export function OutlineIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 5h9M7 10h7M7 15h9" />
      <circle cx="3.75" cy="5" r=".75" fill="currentColor" stroke="none" />
      <circle cx="3.75" cy="10" r=".75" fill="currentColor" stroke="none" />
      <circle cx="3.75" cy="15" r=".75" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 5h7M14 5h3M3 10h2M9 10h8M3 15h8M15 15h2" />
      <circle cx="12" cy="5" r="2" />
      <circle cx="7" cy="10" r="2" />
      <circle cx="13" cy="15" r="2" />
    </Icon>
  );
}

export function SidebarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="14" rx="2" width="16" x="2" y="3" />
      <path d="M7 3v14" />
    </Icon>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4 13.75-.5 2.75 2.75-.5L15.5 6.75 13.25 4.5 4 13.75Z" />
      <path d="m11.75 6 2.25 2.25M10 16.5h6.5" />
    </Icon>
  );
}

export function LiveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 3.25h8.25l3.75 3.8v9.7H4v-13.5Z" />
      <path d="M12 3.5V7h3.5M6.75 10h6.5M6.75 13h4" />
      <path d="m12.2 14.8 3.05-3.05 1.5 1.5-3.05 3.05-1.85.35.35-1.85Z" fill="var(--color-canvas)" />
    </Icon>
  );
}

export function SplitIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="14" rx="2" width="16" x="2" y="3" />
      <path d="M10 3v14M5 7h2M13 7h2M5 10h2M13 10h2" />
    </Icon>
  );
}

export function PreviewIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 10s2.6-4.25 7.5-4.25S17.5 10 17.5 10s-2.6 4.25-7.5 4.25S2.5 10 2.5 10Z" />
      <circle cx="10" cy="10" r="2.1" />
    </Icon>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 6.25A1.75 1.75 0 0 1 4.25 4.5h4l1.5 1.75h6A1.75 1.75 0 0 1 17.5 8v6.25A1.75 1.75 0 0 1 15.75 16h-11A1.75 1.75 0 0 1 3 14.25L2.5 6.25Z" />
    </Icon>
  );
}

export function FolderOpenIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8V6.25A1.75 1.75 0 0 1 4.75 4.5h3.5l1.5 1.75h5.5A1.75 1.75 0 0 1 17 8" />
      <path d="M3.8 15.75h10.8a1.5 1.5 0 0 0 1.42-1.03l1.48-4.47H6.1a1.5 1.5 0 0 0-1.42 1.03L3.2 15.75a.8.8 0 0 1-.7-.8V8h2" />
    </Icon>
  );
}

export function FileMarkdownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.5 2.75h6l3 3v11.5h-9a1.5 1.5 0 0 1-1.5-1.5V4.25a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M11.5 3v3h3M6.5 13V9.5l1.75 2 1.75-2V13M12 11.5l1.25 1.5 1.25-1.5M13.25 9.5V13" />
    </Icon>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="14" rx="2" width="16" x="2" y="3" />
      <circle cx="7" cy="7.25" r="1.25" />
      <path d="m3.5 14 4-4 2.5 2.5 2-2 4.5 4.5" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m7.5 5 5 5-5 5" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 7.5 5 5 5-5" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 5 10 10M15 5 5 15" />
    </Icon>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="4" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="10" r="1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function CommandIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 7V5a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v10a2 2 0 1 0 2-2H5a2 2 0 1 0 2 2V5" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4.5 10 3.5 3.5 7.5-8" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 3.5v13M3.5 10h13" />
    </Icon>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.55 3.55 2.3 14.4a1.45 1.45 0 0 0 1.25 2.18h12.9a1.45 1.45 0 0 0 1.25-2.18L11.45 3.55a1.67 1.67 0 0 0-2.9 0Z" />
      <path d="M10 7v4.25M10 14.2v.05" />
    </Icon>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9v5M10 6.25v.05" />
    </Icon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 10h13M12 5.5l4.5 4.5-4.5 4.5" />
    </Icon>
  );
}

export function SaveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 3.5h11l2 2v11h-13v-13Z" />
      <path d="M6 3.5v4h7v-4M6.5 16.5v-5h7v5" />
    </Icon>
  );
}

export function HistoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.25 7.25H1.75V4.75" />
      <path d="M2.1 7.1A7.5 7.5 0 1 1 3.8 14.9" />
      <path d="M10 5.75V10l2.9 1.65" />
    </Icon>
  );
}
