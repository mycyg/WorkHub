import { appleGlassDesignSystemCss } from "./design-system.js";
import { liquidGlassHeadHtml } from "./liquid-glass.js";
import { liquidGlassFilterHtml } from "./liquid-glass-filter.js";
import { spotlightCss } from "./spotlight/css.js";

export function renderDesktopSpotlightBootShell(): string {
  return `${liquidGlassHeadHtml}${liquidGlassFilterHtml}<style>${appleGlassDesignSystemCss}${spotlightCss}</style><div data-spot-host></div>`;
}
