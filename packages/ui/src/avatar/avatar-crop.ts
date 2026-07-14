// R14 批 AVATAR（头像与资料入口，2026-07-14 用户点名新增，追加拍板：必须支持用户自己裁剪，
// 不能只做自动居中裁）——取景框 ↔ 源图坐标换算的纯函数，零 DOM 依赖，供 web（apps/web/src/browser.ts）
// 与桌面（apps/desktop-webview/src/spotlight/views/settings.ts）两端裁剪层复用同一套数学，不各写一份。
//
// 模型：取景框（viewport）是边长 viewportSize 的正方形，坐标原点在取景框左上角。图片以 scale 倍率铺进
// 取景框空间，图片左上角落在 (offset.x, offset.y)。硬约束——任意时刻图片必须完全盖住取景框、不许露出
// 空白边：故最小缩放 = 取景框边长 / 图片短边（短边缩放后恰好贴住取景框两边，短边这一轴因此不可平移；
// 长边缩放后必然 >= 取景框边长，只有长边那一轴才有平移余地）。缩放上限给一个保守倍数，用户拍板的
// 「不许缩出空白边」只约束下限，不约束上限——上限纯粹是不让用户拉到糊成马赛克。

export type NaturalSize = { width: number; height: number };
export type CropOffset = { x: number; y: number };
export type CropState = { scale: number; offset: CropOffset };
export type SourceCropRect = { sx: number; sy: number; sWidth: number; sHeight: number };

// 缩放上限 = 最小缩放的 4 倍——够用户精细取景，不至于放大到肉眼全是像素格。
const MAX_SCALE_MULTIPLIER = 4;

// 头像上传的最终输出边长（与服务端 users.avatar_webp 的约定尺寸一致，见
// apps/api/src/services/user-avatar.ts 的 AVATAR_OUTPUT_SIZE）。放在这里而不是各端各写一份魔数。
export const AVATAR_CROP_OUTPUT_SIZE = 256;

function safeDivisor(value: number): number {
  return value > 0 ? value : 1;
}

/** 短边恰好铺满取景框时的缩放——用户拍板的下限:图片不得因缩放不足而露出取景框外的空白。 */
export function minCropScale(natural: NaturalSize, viewportSize: number): number {
  if (viewportSize <= 0) {
    return 1;
  }
  const shortSide = Math.min(natural.width, natural.height);
  if (!Number.isFinite(shortSide) || shortSide <= 0) {
    return 1;
  }
  return viewportSize / shortSide;
}

export function maxCropScale(natural: NaturalSize, viewportSize: number): number {
  return minCropScale(natural, viewportSize) * MAX_SCALE_MULTIPLIER;
}

export function clampCropScale(scale: number, natural: NaturalSize, viewportSize: number): number {
  const min = minCropScale(natural, viewportSize);
  const max = maxCropScale(natural, viewportSize);
  // NaN 比较恒假，Math.min/Math.max 对 NaN 会传染成 NaN——必须特判，回落到安全下限。
  // +Infinity/-Infinity 则让它们照常参与比较，天然分别夹到 max/min，不需要特判。
  if (Number.isNaN(scale)) {
    return min;
  }
  return Math.min(Math.max(scale, min), max);
}

// 单轴平移夹紧：displaySize（该轴图片显示尺寸）理应总 >= viewportSize（minCropScale 保证），
// 但极端输入（natural 尺寸为 0 等损坏图片元数据）时兜底居中，不产出 NaN/负宽度传给 canvas。
function clampAxis(offset: number, displaySize: number, viewportSize: number): number {
  if (displaySize <= viewportSize) {
    return (viewportSize - displaySize) / 2;
  }
  const min = viewportSize - displaySize;
  const max = 0;
  return Math.min(Math.max(offset, min), max);
}

export function clampCropOffset(
  offset: CropOffset,
  natural: NaturalSize,
  scale: number,
  viewportSize: number
): CropOffset {
  const displayWidth = natural.width * scale;
  const displayHeight = natural.height * scale;
  return {
    x: clampAxis(offset.x, displayWidth, viewportSize),
    y: clampAxis(offset.y, displayHeight, viewportSize)
  };
}

/** 选图后的默认取景态：最小缩放（短边贴边）+ 长边居中。 */
export function initialCropState(natural: NaturalSize, viewportSize: number): CropState {
  const scale = minCropScale(natural, viewportSize);
  const displayWidth = natural.width * scale;
  const displayHeight = natural.height * scale;
  const offset = { x: (viewportSize - displayWidth) / 2, y: (viewportSize - displayHeight) / 2 };
  return { scale, offset: clampCropOffset(offset, natural, scale, viewportSize) };
}

/** 拖动平移（增量式）——结果总是被夹紧到「不露空白边」的合法范围内。 */
export function panCropBy(
  state: CropState,
  delta: CropOffset,
  natural: NaturalSize,
  viewportSize: number
): CropState {
  const nextOffset = { x: state.offset.x + delta.x, y: state.offset.y + delta.y };
  return { scale: state.scale, offset: clampCropOffset(nextOffset, natural, state.scale, viewportSize) };
}

// 缩放锚定取景框中心——滑杆缩放的直觉行为是围绕取景框中心放大/缩小，不是左上角一路飘走。
export function zoomCropTo(
  state: CropState,
  nextScaleRaw: number,
  natural: NaturalSize,
  viewportSize: number
): CropState {
  const nextScale = clampCropScale(nextScaleRaw, natural, viewportSize);
  const anchor = viewportSize / 2;
  const ratio = nextScale / safeDivisor(state.scale);
  const nextOffset = {
    x: anchor - (anchor - state.offset.x) * ratio,
    y: anchor - (anchor - state.offset.y) * ratio
  };
  return { scale: nextScale, offset: clampCropOffset(nextOffset, natural, nextScale, viewportSize) };
}

/**
 * 取景框（视口空间）→ 源图像素矩形。喂给 canvas.drawImage 的 9 参数重载做「裁切 + 降采样」一步到位：
 * drawImage(image, sx, sy, sWidth, sHeight, 0, 0, AVATAR_CROP_OUTPUT_SIZE, AVATAR_CROP_OUTPUT_SIZE)。
 */
export function cropSourceRect(state: CropState, viewportSize: number): SourceCropRect {
  const scale = safeDivisor(state.scale);
  return {
    sx: -state.offset.x / scale,
    sy: -state.offset.y / scale,
    sWidth: viewportSize / scale,
    sHeight: viewportSize / scale
  };
}
