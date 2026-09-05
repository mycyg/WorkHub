// WorkHub 桌面 · 玻璃白底 alpha 运行期覆写（R24 真机调优留下的调试开关）。
//
// 聚焦盒「通透」与否由两层决定：Rust 侧 apply_vibrancy 贴的原生材质（真模糊，见 main.rs 的
// GlassMaterial），和盒子自己那层半透白底（决定「能不能看见背后的窗口」）。透明 Tauri 窗里
// CSS backdrop-filter 没有内容可糊，所以白底 alpha 就是前端唯一能调的一档。
//
// 默认值写死在 spotlight/css.ts 的 --wh-spot-glass-top/bottom。这里只提供运行期覆写，好处是
// 一次构建能跑完多个候选值：Rust 侧 WORKHUB_GLASS_ALPHA 注入 window.__WORKHUB_GLASS_ALPHA__，
// 本机也可以直接写 localStorage["workhub.glass.alpha"]。两者都不置位 = 零行为变化。

export const GLASS_ALPHA_STORAGE_KEY = "workhub.glass.alpha";
export const GLASS_ALPHA_GLOBAL_KEY = "__WORKHUB_GLASS_ALPHA__";

// 底色是 135° 渐变，右下角比左上角再透一档；保留默认 .78 → .6 的同一比例，覆写时观感一致。
const BOTTOM_RATIO = 0.77;

export interface GlassAlphaSource {
  /** window.__WORKHUB_GLASS_ALPHA__（Rust 注入）。 */
  globalValue?: unknown;
  /** localStorage["workhub.glass.alpha"]（本机手动置位）。 */
  storedValue?: unknown;
}

/** 只认 (0,1] 的有限数；0 与越界值一律当作没置位——盒子全透明是不可读的，不给这个脚。 */
function normalizeAlpha(raw: unknown): number | null {
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseFloat(raw.trim())
        : Number.NaN;
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

export function resolveGlassAlphaOverride(source: GlassAlphaSource): number | null {
  return normalizeAlpha(source.globalValue) ?? normalizeAlpha(source.storedValue);
}

/** 覆写要写到宿主元素（.wh-ds.wh-spot-stage）上：内联自定义属性既压得住 :root 默认值，也压得住 .wh-ds 上的 --ds-glass-strong。 */
export function glassAlphaCustomProperties(alpha: number): Array<[string, string]> {
  const top = Math.round(alpha * 100) / 100;
  const bottom = Math.round(alpha * BOTTOM_RATIO * 100) / 100;
  return [
    ["--wh-spot-glass-top", `rgba(255,255,255,${top})`],
    ["--wh-spot-glass-bottom", `rgba(255,255,255,${bottom})`],
    ["--ds-glass-strong", `rgba(255,255,255,${top})`]
  ];
}

interface GlassAlphaTarget {
  style: { setProperty(name: string, value: string): void };
}

/** 读全局/本地存储，取到值就写到宿主元素上并返回它；没置位返回 null 且一个字节都不动。 */
export function applyGlassAlphaOverride(
  host: GlassAlphaTarget,
  source: GlassAlphaSource
): number | null {
  const alpha = resolveGlassAlphaOverride(source);
  if (alpha === null) {
    return null;
  }
  for (const [name, value] of glassAlphaCustomProperties(alpha)) {
    host.style.setProperty(name, value);
  }
  return alpha;
}

/** 浏览器开发态/测试环境里 window 或 localStorage 可能缺席或抛错，两处都兜住——调试开关绝不该让盒子挂掉。 */
export function readGlassAlphaSource(view: unknown): GlassAlphaSource {
  const scope = view as
    | { localStorage?: { getItem(key: string): string | null } | null; [key: string]: unknown }
    | null
    | undefined;
  if (!scope) {
    return {};
  }
  let storedValue: unknown;
  try {
    storedValue = scope.localStorage?.getItem(GLASS_ALPHA_STORAGE_KEY) ?? undefined;
  } catch {
    storedValue = undefined;
  }
  return { globalValue: scope[GLASS_ALPHA_GLOBAL_KEY], storedValue };
}
