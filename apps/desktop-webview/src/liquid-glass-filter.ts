export const spotlightLiquidGlassFilterId = "workhub-liquid-glass-spotlight-filter";
export const petLiquidGlassFilterId = "workhub-liquid-glass-pet-filter";
const defsId = "workhub-liquid-glass-defs";
const svgId = "workhub-liquid-glass-svg-defs";

export const liquidGlassFilterHtml =
  `<svg id="${svgId}" class="wh-liquid-glass-defs" xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;overflow:hidden;pointer-events:none;color-interpolation-filters:sRGB"><defs id="${defsId}"></defs></svg>`;

export const liquidGlassFilterCss = [
  ".wh-liquid-glass-defs{position:absolute!important;width:0!important;height:0!important;overflow:hidden!important;pointer-events:none!important}",
  ".wh-liquid-glass-warp{position:absolute;inset:0;z-index:0;pointer-events:none;border-radius:inherit;background:transparent;overflow:hidden;isolation:isolate;contain:paint;--wh-liquid-frost:.6px;--wh-liquid-saturation:155%;--wh-liquid-contrast:1.04;--wh-liquid-haze:rgba(246,248,252,.38);--wh-liquid-haze-blur:24px}",
  ".wh-liquid-glass-warp--spotlight{--wh-liquid-frost:.7px;--wh-liquid-saturation:160%;--wh-liquid-contrast:1.05;--wh-liquid-edge:14px;--wh-liquid-haze:rgba(246,248,252,.44);--wh-liquid-haze-blur:30px}",
  ".wh-liquid-glass-warp--pet{--wh-liquid-frost:.65px;--wh-liquid-saturation:158%;--wh-liquid-contrast:1.04;--wh-liquid-edge:16px;--wh-liquid-haze:rgba(248,250,252,.40);--wh-liquid-haze-blur:26px}",
  ".wh-liquid-glass-haze{position:absolute;inset:0;pointer-events:none;border-radius:inherit;background:var(--wh-liquid-haze);backdrop-filter:blur(var(--wh-liquid-haze-blur)) saturate(180%) contrast(1.02);-webkit-backdrop-filter:blur(var(--wh-liquid-haze-blur)) saturate(180%) contrast(1.02);box-shadow:inset 0 1px 0 rgba(255,255,255,.36),inset 0 -1px 0 rgba(0,0,0,.05)}",
  ".wh-liquid-glass-refract{position:absolute;inset:0;pointer-events:none;border-radius:inherit;background:transparent;isolation:isolate;filter:none;-webkit-filter:none}",
  ".wh-liquid-glass-edge{position:absolute;pointer-events:none;background:transparent;isolation:isolate;box-shadow:inset 0 1px 0 rgba(255,255,255,.54),inset 0 -1px 0 rgba(0,0,0,.12);filter:none;-webkit-filter:none}",
  `.wh-liquid-glass-warp--spotlight .wh-liquid-glass-edge{backdrop-filter:url(#${spotlightLiquidGlassFilterId}) blur(var(--wh-liquid-frost)) saturate(var(--wh-liquid-saturation)) contrast(var(--wh-liquid-contrast));-webkit-backdrop-filter:url(#${spotlightLiquidGlassFilterId}) blur(var(--wh-liquid-frost)) saturate(var(--wh-liquid-saturation)) contrast(var(--wh-liquid-contrast))}`,
  `.wh-liquid-glass-warp--pet .wh-liquid-glass-edge{backdrop-filter:url(#${petLiquidGlassFilterId}) blur(var(--wh-liquid-frost)) saturate(var(--wh-liquid-saturation)) contrast(var(--wh-liquid-contrast));-webkit-backdrop-filter:url(#${petLiquidGlassFilterId}) blur(var(--wh-liquid-frost)) saturate(var(--wh-liquid-saturation)) contrast(var(--wh-liquid-contrast))}`,
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

type LiquidGlassFilterTarget = {
  id: string;
  selector: string;
  radius: number;
  bezel: number;
  thickness: number;
  ior: number;
  blur: number;
  scale: number;
  specularOpacity: number;
  specularSaturation: number;
};

const defaultTargets: LiquidGlassFilterTarget[] = [
  {
    id: spotlightLiquidGlassFilterId,
    selector: ".wh-spot",
    radius: 24,
    bezel: 18,
    thickness: 58,
    ior: 1.32,
    blur: 0.8,
    scale: 0.28,
    specularOpacity: 0.55,
    specularSaturation: 1.35
  },
  {
    id: petLiquidGlassFilterId,
    selector: ".wh-pet-bubble",
    radius: 20,
    bezel: 15,
    thickness: 68,
    ior: 1.36,
    blur: 0.9,
    scale: 0.32,
    specularOpacity: 0.62,
    specularSaturation: 1.38
  }
];

function ensureLiquidGlassSvg(doc: Document): SVGDefsElement | undefined {
  let svg = doc.getElementById(svgId) as SVGSVGElement | null;
  if (!svg) {
    const container = doc.createElement("div");
    container.innerHTML = liquidGlassFilterHtml;
    svg = container.firstElementChild as SVGSVGElement | null;
    if (svg) {
      doc.body?.prepend(svg);
    }
  }
  return doc.getElementById(defsId) as SVGDefsElement | null ?? undefined;
}

const surfaceHeight = (x: number) => {
  const convex = Math.pow(1 - Math.pow(1 - Math.min(x * 2, 1), 4), 0.25);
  const concave = 1 - Math.sqrt(1 - (1 - x) * (1 - x)) + 0.1;
  const t = 6 * x ** 5 - 15 * x ** 4 + 10 * x ** 3;
  return convex * (1 - t) + concave * t;
};

function calculateRefractionProfile(glassThickness: number, bezelWidth: number, ior: number, samples = 96) {
  const eta = 1 / ior;
  const profile = new Float64Array(samples);
  const refract = (nx: number, ny: number) => {
    const dot = ny;
    const k = 1 - eta * eta * (1 - dot * dot);
    if (k < 0) {
      return undefined;
    }
    const sq = Math.sqrt(k);
    return [-(eta * dot + sq) * nx, eta - (eta * dot + sq) * ny] as const;
  };

  for (let i = 0; i < samples; i += 1) {
    const x = i / samples;
    const y = surfaceHeight(x);
    const dx = x < 1 ? 0.0001 : -0.0001;
    const y2 = surfaceHeight(x + dx);
    const derivative = (y2 - y) / dx;
    const magnitude = Math.sqrt(derivative * derivative + 1);
    const ref = refract(-derivative / magnitude, -1 / magnitude);
    profile[i] = ref ? ref[0] * ((y * bezelWidth + glassThickness) / ref[1]) : 0;
  }
  return profile;
}

function createCanvas(doc: Document, width: number, height: number) {
  const canvas = doc.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function generateDisplacementMap(doc: Document, width: number, height: number, radius: number, bezelWidth: number, profile: Float64Array, maxDisp: number) {
  const canvas = createCanvas(doc, width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return "";
  }
  const img = ctx.createImageData(width, height);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 128;
    data[i + 1] = 128;
    data[i + 2] = 128;
    data[i + 3] = 255;
  }

  const r = radius;
  const rSq = r * r;
  const r1Sq = (r + 1) ** 2;
  const rBezelSq = Math.max(r - bezelWidth, 0) ** 2;
  const innerWidth = width - r * 2;
  const innerHeight = height - r * 2;
  const samples = profile.length;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const edgeX = x < r ? x - r : x >= width - r ? x - r - innerWidth : 0;
      const edgeY = y < r ? y - r : y >= height - r ? y - r - innerHeight : 0;
      const distanceSq = edgeX * edgeX + edgeY * edgeY;
      if (distanceSq > r1Sq || distanceSq < rBezelSq) {
        continue;
      }
      const distance = Math.sqrt(distanceSq);
      const fromSide = r - distance;
      const opacity = distanceSq < rSq ? 1 : 1 - (distance - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq));
      if (opacity <= 0 || distance === 0) {
        continue;
      }
      const profileIndex = Math.min(((fromSide / bezelWidth) * samples) | 0, samples - 1);
      const displacement = profile[profileIndex] || 0;
      const dx = (-(edgeX / distance) * displacement) / maxDisp;
      const dy = (-(edgeY / distance) * displacement) / maxDisp;
      const idx = (y * width + x) * 4;
      const red = (128 + dx * 127 * opacity + 0.5) | 0;
      const green = (128 + dy * 127 * opacity + 0.5) | 0;
      data[idx] = red;
      data[idx + 1] = green;
      data[idx + 2] = green;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

function generateSpecularMap(doc: Document, width: number, height: number, radius: number, bezelWidth: number) {
  const canvas = createCanvas(doc, width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return "";
  }
  const img = ctx.createImageData(width, height);
  const data = img.data;
  data.fill(0);
  const r = radius;
  const rSq = r * r;
  const r1Sq = (r + 1) ** 2;
  const rBezelSq = Math.max(r - bezelWidth, 0) ** 2;
  const innerWidth = width - r * 2;
  const innerHeight = height - r * 2;
  const light = [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)] as const;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const edgeX = x < r ? x - r : x >= width - r ? x - r - innerWidth : 0;
      const edgeY = y < r ? y - r : y >= height - r ? y - r - innerHeight : 0;
      const distanceSq = edgeX * edgeX + edgeY * edgeY;
      if (distanceSq > r1Sq || distanceSq < rBezelSq) {
        continue;
      }
      const distance = Math.sqrt(distanceSq);
      const fromSide = r - distance;
      const opacity = distanceSq < rSq ? 1 : 1 - (distance - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq));
      if (opacity <= 0 || distance === 0) {
        continue;
      }
      const dot = Math.abs((edgeX / distance) * light[0] + (-edgeY / distance) * light[1]);
      const edge = Math.sqrt(Math.max(0, 1 - (1 - fromSide) ** 2));
      const coeff = dot * edge;
      const col = (255 * coeff) | 0;
      const alpha = (col * coeff * opacity) | 0;
      const idx = (y * width + x) * 4;
      data[idx] = col;
      data[idx + 1] = col;
      data[idx + 2] = col;
      data[idx + 3] = alpha;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

function generateEdgeMaskMap(doc: Document, width: number, height: number, radius: number, bezelWidth: number) {
  const canvas = createCanvas(doc, width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return "";
  }
  const img = ctx.createImageData(width, height);
  const data = img.data;
  data.fill(0);
  const r = radius;
  const rSq = r * r;
  const r1Sq = (r + 1) ** 2;
  const rBezelSq = Math.max(r - bezelWidth, 0) ** 2;
  const innerWidth = width - r * 2;
  const innerHeight = height - r * 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const edgeX = x < r ? x - r : x >= width - r ? x - r - innerWidth : 0;
      const edgeY = y < r ? y - r : y >= height - r ? y - r - innerHeight : 0;
      const distanceSq = edgeX * edgeX + edgeY * edgeY;
      if (distanceSq > r1Sq || distanceSq < rBezelSq) {
        continue;
      }
      const distance = Math.sqrt(distanceSq);
      const fromSide = r - distance;
      const outerOpacity = distanceSq < rSq ? 1 : 1 - (distance - Math.sqrt(rSq)) / (Math.sqrt(r1Sq) - Math.sqrt(rSq));
      const innerFade = Math.max(0, Math.min(1, 1 - fromSide / bezelWidth));
      const alpha = Math.round(255 * outerOpacity * Math.pow(innerFade, 0.72));
      const idx = (y * width + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = alpha;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

function filterMarkup(target: LiquidGlassFilterTarget, width: number, height: number, doc: Document) {
  const radius = Math.min(target.radius, Math.floor(Math.min(width, height) / 2) - 1);
  const bezel = Math.max(2, Math.min(target.bezel, radius - 1));
  const profile = calculateRefractionProfile(target.thickness, bezel, target.ior);
  const maxDisp = Math.max(...Array.from(profile).map(Math.abs)) || 1;
  const dispUrl = generateDisplacementMap(doc, width, height, radius, bezel, profile, maxDisp);
  const specUrl = generateSpecularMap(doc, width, height, radius, bezel * 2.5);
  const edgeMaskUrl = generateEdgeMaskMap(doc, width, height, radius, bezel * 2.25);
  const scale = maxDisp * target.scale;

  return `<filter id="${target.id}" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceGraphic" stdDeviation="${target.blur}" result="blurred_source" />
    <feImage href="${dispUrl}" x="0" y="0" width="${width}" height="${height}" result="disp_map" preserveAspectRatio="none" />
    <feDisplacementMap in="blurred_source" in2="disp_map" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="displaced" />
    <feColorMatrix in="displaced" type="saturate" values="${target.specularSaturation}" result="displaced_sat" />
    <feImage href="${edgeMaskUrl}" x="0" y="0" width="${width}" height="${height}" result="edge_mask" preserveAspectRatio="none" />
    <feComposite in="displaced_sat" in2="edge_mask" operator="in" result="edge_refracted" />
    <feImage href="${specUrl}" x="0" y="0" width="${width}" height="${height}" result="spec_layer" preserveAspectRatio="none" />
    <feComponentTransfer in="spec_layer" result="spec_faded"><feFuncA type="linear" slope="${target.specularOpacity}" /></feComponentTransfer>
    <feComposite in="spec_faded" in2="edge_mask" operator="in" result="edge_specular" />
    <feBlend in="edge_refracted" in2="edge_specular" mode="screen" />
  </filter>`;
}

export function rebuildWorkHubLiquidGlassFilters(doc?: Document): void {
  if (!doc) {
    return;
  }
  const defs = ensureLiquidGlassSvg(doc);
  if (!defs) {
    return;
  }
  const targets = defaultTargets.flatMap((target) => {
    const el = doc.querySelector<HTMLElement>(target.selector);
    if (!el) {
      return [];
    }
    const rect = el.getBoundingClientRect();
    const width = Math.max(80, Math.round(rect.width || el.offsetWidth || 240));
    const height = Math.max(48, Math.round(rect.height || el.offsetHeight || 80));
    return [{ target, width, height }];
  });
  const cacheKey = targets.map(({ target, width, height }) => `${target.id}:${width}x${height}`).join("|");
  if (!cacheKey || defs.dataset.workhubLiquidGlassKey === cacheKey) {
    return;
  }
  const markup = targets.map(({ target, width, height }) => filterMarkup(target, width, height, doc)).join("");
  if (markup) {
    defs.innerHTML = markup;
    defs.dataset.workhubLiquidGlassKey = cacheKey;
  }
}

export function scheduleWorkHubLiquidGlassFilterRebuild(doc?: Document): void {
  if (!doc) {
    return;
  }
  const win = doc.defaultView;
  if (!win?.requestAnimationFrame) {
    rebuildWorkHubLiquidGlassFilters(doc);
    return;
  }
  win.requestAnimationFrame(() => rebuildWorkHubLiquidGlassFilters(doc));
}
