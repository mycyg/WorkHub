// SVG displacement refraction is disabled for R9.3-4. Spotlight and pet surfaces
// hide this layer, so generating per-size SVG maps only burned CPU without drawing.
export const liquidGlassFilterHtml = "";

export const liquidGlassFilterCss = [
  ".wh-liquid-glass-warp{position:absolute;inset:0;z-index:0;pointer-events:none;border-radius:inherit;background:transparent;overflow:hidden;isolation:isolate;contain:paint;--wh-liquid-frost:.6px;--wh-liquid-saturation:155%;--wh-liquid-contrast:1.04;--wh-liquid-haze:rgba(246,248,252,.38);--wh-liquid-haze-blur:24px}",
  ".wh-liquid-glass-warp--spotlight{--wh-liquid-frost:.7px;--wh-liquid-saturation:160%;--wh-liquid-contrast:1.05;--wh-liquid-edge:14px;--wh-liquid-haze:rgba(246,248,252,.44);--wh-liquid-haze-blur:30px}",
  ".wh-liquid-glass-warp--pet{--wh-liquid-frost:.65px;--wh-liquid-saturation:158%;--wh-liquid-contrast:1.04;--wh-liquid-edge:16px;--wh-liquid-haze:rgba(248,250,252,.40);--wh-liquid-haze-blur:26px}",
  ".wh-liquid-glass-haze{position:absolute;inset:0;pointer-events:none;border-radius:inherit;background:var(--wh-liquid-haze);backdrop-filter:blur(var(--wh-liquid-haze-blur)) saturate(180%) contrast(1.02);-webkit-backdrop-filter:blur(var(--wh-liquid-haze-blur)) saturate(180%) contrast(1.02);box-shadow:inset 0 1px 0 rgba(255,255,255,.36),inset 0 -1px 0 rgba(0,0,0,.05)}",
  ".wh-liquid-glass-refract{position:absolute;inset:0;pointer-events:none;border-radius:inherit;background:transparent;isolation:isolate;filter:none;-webkit-filter:none}",
  ".wh-liquid-glass-edge{position:absolute;pointer-events:none;background:transparent;isolation:isolate;box-shadow:inset 0 1px 0 rgba(255,255,255,.54),inset 0 -1px 0 rgba(0,0,0,.12);filter:none;-webkit-filter:none}",
  ".wh-liquid-glass-warp--spotlight .wh-liquid-glass-edge{display:none}",
  ".wh-liquid-glass-edge--top{left:0;right:0;top:0;height:var(--wh-liquid-edge,12px);border-top-left-radius:inherit;border-top-right-radius:inherit}",
  ".wh-liquid-glass-edge--right{top:0;right:0;bottom:0;width:var(--wh-liquid-edge,12px);border-top-right-radius:inherit;border-bottom-right-radius:inherit}",
  ".wh-liquid-glass-edge--bottom{left:0;right:0;bottom:0;height:var(--wh-liquid-edge,12px);border-bottom-left-radius:inherit;border-bottom-right-radius:inherit}",
  ".wh-liquid-glass-edge--left{top:0;left:0;bottom:0;width:var(--wh-liquid-edge,12px);border-top-left-radius:inherit;border-bottom-left-radius:inherit}",
  ".wh-liquid-glass-rim{position:absolute;inset:0;z-index:1;pointer-events:none;border-radius:inherit;background:transparent;border:1px solid rgba(255,255,255,.34);box-shadow:inset 0 1px 0 rgba(255,255,255,.34),inset 0 -1px 0 rgba(255,255,255,.10),0 1px 0 rgba(255,255,255,.16);opacity:.64}",
  ".wh-liquid-glass-content{position:relative;z-index:2;min-width:0;max-width:100%}"
].join("");

type LiquidGlassSurfaceKind = "spotlight" | "pet";

const liquidGlassEdges = ["top", "right", "bottom", "left"] as const;

export function renderWorkHubLiquidGlassLayer(kind: LiquidGlassSurfaceKind): string {
  const edges = liquidGlassEdges
    .map((edge) => `<span class="wh-liquid-glass-edge wh-liquid-glass-edge--${edge}"></span>`)
    .join("");
  return `<span class="wh-liquid-glass-warp wh-liquid-glass-warp--${kind}" aria-hidden="true"><span class="wh-liquid-glass-haze"></span><span class="wh-liquid-glass-refract"></span>${edges}</span>`;
}

export function rebuildWorkHubLiquidGlassFilters(_doc?: Document): void {
  // Intentionally inert while SVG refraction is disabled.
}

export function scheduleWorkHubLiquidGlassFilterRebuild(_doc?: Document): void {
  // Intentionally inert while SVG refraction is disabled.
}
