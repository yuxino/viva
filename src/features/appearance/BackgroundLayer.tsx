import type { CSSProperties } from "react";
import {
  BUILTIN_BACKGROUND_URL,
  backgroundPositionToCss,
  type BackgroundSettings,
} from "../../lib/background";
import "./appearance.css";

export interface BackgroundLayerProps {
  assetUrl?: string | null;
  className?: string;
  settings: BackgroundSettings;
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function BackgroundLayer({
  assetUrl,
  className,
  settings,
}: BackgroundLayerProps) {
  const resolvedUrl =
    settings.source === "viva" ? BUILTIN_BACKGROUND_URL : assetUrl;
  if (settings.source === "none" || !resolvedUrl) return null;

  const bleed = Math.ceil(settings.blur * 1.5 + 2);
  const style: CSSProperties = {
    backgroundImage: `url(${JSON.stringify(resolvedUrl)})`,
    backgroundPosition: backgroundPositionToCss(settings.position),
    backgroundSize: settings.fit,
    filter: settings.blur ? `blur(${settings.blur}px)` : undefined,
    inset: -bleed,
    opacity: settings.opacity,
  };

  return (
    <div
      aria-hidden="true"
      className={joinClassNames("viva-background-layer", className)}
      style={style}
    />
  );
}
