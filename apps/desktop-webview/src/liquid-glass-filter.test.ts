import assert from "node:assert/strict";
import test from "node:test";

import {
  liquidGlassFilterCss,
  rebuildWorkHubLiquidGlassFilters,
  renderWorkHubLiquidGlassLayer
} from "./liquid-glass-filter.js";

test("liquid glass layer only refracts at the edge, without a colored backing surface", () => {
  assert.match(renderWorkHubLiquidGlassLayer("pet"), /wh-liquid-glass-refract/u);
  assert.doesNotMatch(liquidGlassFilterCss, /wh-liquid-glass-tint|--wh-liquid-tint/u);
  assert.doesNotMatch(liquidGlassFilterCss, /opacity:var\(--wh-liquid-opacity|--wh-liquid-opacity/u);
  assert.match(liquidGlassFilterCss, /\.wh-liquid-glass-warp\{[^}]*background:transparent/u);
  assert.match(liquidGlassFilterCss, /\.wh-liquid-glass-warp\{[^}]*--wh-liquid-frost:\.6px/u);
  assert.match(liquidGlassFilterCss, /\.wh-liquid-glass-refract\{[^}]*background:transparent/u);
  assert.match(liquidGlassFilterCss, /\.wh-liquid-glass-refract\{[^}]*filter:none;-webkit-filter:none/u);
  assert.doesNotMatch(liquidGlassFilterCss, /\.wh-liquid-glass-warp--pet \.wh-liquid-glass-refract\{[^}]*backdrop-filter/u);
  assert.doesNotMatch(liquidGlassFilterCss, /\.wh-liquid-glass-warp--spotlight \.wh-liquid-glass-refract\{[^}]*backdrop-filter/u);
  assert.doesNotMatch(liquidGlassFilterCss, /\.wh-liquid-glass-warp--pet \.wh-liquid-glass-refract\{[^}]*-webkit-backdrop-filter/u);
  assert.doesNotMatch(liquidGlassFilterCss, /\.wh-liquid-glass-warp--spotlight \.wh-liquid-glass-refract\{[^}]*-webkit-backdrop-filter/u);
  assert.match(liquidGlassFilterCss, /\.wh-liquid-glass-warp--pet \.wh-liquid-glass-edge\{backdrop-filter:url\(#workhub-liquid-glass-pet-filter\) blur\(var\(--wh-liquid-frost\)\)/u);
  assert.match(liquidGlassFilterCss, /\.wh-liquid-glass-warp--spotlight \.wh-liquid-glass-edge\{backdrop-filter:url\(#workhub-liquid-glass-spotlight-filter\) blur\(var\(--wh-liquid-frost\)\)/u);
  assert.doesNotMatch(liquidGlassFilterCss, /(?:^|[;{])filter:url\(#workhub-liquid-glass/u);
  assert.doesNotMatch(liquidGlassFilterCss, /--wh-liquid-frost:(?:1[0-9]|[2-9][0-9])px/u);
});

test("liquid glass filters are not rewritten when surface geometry is unchanged", () => {
  let innerHtmlWrites = 0;
  const defs = {
    dataset: {} as Record<string, string>,
    _innerHTML: "",
    get innerHTML() {
      return this._innerHTML;
    },
    set innerHTML(value: string) {
      innerHtmlWrites += 1;
      this._innerHTML = value;
    }
  };
  const canvasContext = {
    createImageData(width: number, height: number) {
      return { data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData() {}
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => canvasContext,
    toDataURL: () => "data:image/png;base64,stable"
  };
  const element = {
    getBoundingClientRect: () => ({ width: 320, height: 140 }),
    offsetWidth: 320,
    offsetHeight: 140
  };
  const doc = {
    getElementById: (id: string) => (id === "workhub-liquid-glass-defs" ? defs : null),
    querySelector: () => element,
    createElement: () => canvas
  } as unknown as Document;

  rebuildWorkHubLiquidGlassFilters(doc);
  rebuildWorkHubLiquidGlassFilters(doc);

  assert.equal(innerHtmlWrites, 1);
  assert.match(defs.innerHTML, /result="edge_mask"/u);
  assert.match(defs.innerHTML, /<feComposite in="displaced_sat" in2="edge_mask" operator="in" result="edge_refracted"/u);
  assert.match(defs.innerHTML, /<feComposite in="spec_faded" in2="edge_mask" operator="in" result="edge_specular"/u);
  assert.doesNotMatch(defs.innerHTML, /<feBlend in="displaced_sat" in2="spec_faded"/u);
});
