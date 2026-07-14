import assert from "node:assert/strict";
import test from "node:test";

import {
  AVATAR_CROP_OUTPUT_SIZE,
  clampCropOffset,
  clampCropScale,
  cropSourceRect,
  initialCropState,
  maxCropScale,
  minCropScale,
  panCropBy,
  zoomCropTo,
  type CropState,
  type NaturalSize
} from "./avatar-crop.js";

const VIEWPORT = 280;

function approxEqual(actual: number, expected: number, message: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, got ${actual}`);
}

// —— minCropScale / maxCropScale ——

test("minCropScale for a square image is viewportSize / side", () => {
  const natural: NaturalSize = { width: 1000, height: 1000 };
  approxEqual(minCropScale(natural, VIEWPORT), VIEWPORT / 1000, "square min scale");
});

test("minCropScale for a wide image locks to the short (height) side", () => {
  const natural: NaturalSize = { width: 800, height: 400 };
  approxEqual(minCropScale(natural, VIEWPORT), VIEWPORT / 400, "wide min scale uses height");
});

test("minCropScale for a tall image locks to the short (width) side", () => {
  const natural: NaturalSize = { width: 300, height: 900 };
  approxEqual(minCropScale(natural, VIEWPORT), VIEWPORT / 300, "tall min scale uses width");
});

test("minCropScale for a 1x1 extreme image does not divide by a tiny/zero number", () => {
  const natural: NaturalSize = { width: 1, height: 1 };
  approxEqual(minCropScale(natural, VIEWPORT), VIEWPORT, "1x1 min scale");
});

test("minCropScale falls back to 1 for degenerate (zero-sized) natural dimensions", () => {
  assert.equal(minCropScale({ width: 0, height: 500 }, VIEWPORT), 1);
  assert.equal(minCropScale({ width: 500, height: 0 }, VIEWPORT), 1);
});

test("maxCropScale is a fixed multiple of minCropScale", () => {
  const natural: NaturalSize = { width: 1000, height: 1000 };
  const min = minCropScale(natural, VIEWPORT);
  approxEqual(maxCropScale(natural, VIEWPORT), min * 4, "max scale multiple");
});

// —— clampCropScale ——

test("clampCropScale clamps below the minimum up to the minimum (no blank edges)", () => {
  const natural: NaturalSize = { width: 1000, height: 1000 };
  const min = minCropScale(natural, VIEWPORT);
  approxEqual(clampCropScale(min / 2, natural, VIEWPORT), min, "clamps to min");
});

test("clampCropScale clamps above the maximum down to the maximum", () => {
  const natural: NaturalSize = { width: 1000, height: 1000 };
  const max = maxCropScale(natural, VIEWPORT);
  approxEqual(clampCropScale(max * 10, natural, VIEWPORT), max, "clamps to max");
});

test("clampCropScale treats non-finite input (NaN/Infinity) as the minimum, not a crash", () => {
  const natural: NaturalSize = { width: 1000, height: 1000 };
  const min = minCropScale(natural, VIEWPORT);
  approxEqual(clampCropScale(Number.NaN, natural, VIEWPORT), min, "NaN clamps to min");
  approxEqual(clampCropScale(Number.POSITIVE_INFINITY, natural, VIEWPORT), maxCropScale(natural, VIEWPORT), "Infinity clamps to max");
});

// —— initialCropState ——

test("initialCropState for a square image starts at min scale with zero offset on both axes", () => {
  const natural: NaturalSize = { width: 500, height: 500 };
  const state = initialCropState(natural, VIEWPORT);
  approxEqual(state.scale, minCropScale(natural, VIEWPORT), "square initial scale");
  approxEqual(state.offset.x, 0, "square initial offset x");
  approxEqual(state.offset.y, 0, "square initial offset y");
});

test("initialCropState for a wide image centers on the long (x) axis and pins the short (y) axis to zero", () => {
  const natural: NaturalSize = { width: 800, height: 400 };
  const state = initialCropState(natural, VIEWPORT);
  const scale = minCropScale(natural, VIEWPORT);
  const displayWidth = natural.width * scale;
  approxEqual(state.offset.x, (VIEWPORT - displayWidth) / 2, "wide initial offset x centered");
  approxEqual(state.offset.y, 0, "wide initial offset y pinned");
  assert.ok(state.offset.x < 0, "wide image must be shifted left of the viewport origin to center it");
});

test("initialCropState for a tall image centers on the long (y) axis and pins the short (x) axis to zero", () => {
  const natural: NaturalSize = { width: 300, height: 900 };
  const state = initialCropState(natural, VIEWPORT);
  const scale = minCropScale(natural, VIEWPORT);
  const displayHeight = natural.height * scale;
  approxEqual(state.offset.y, (VIEWPORT - displayHeight) / 2, "tall initial offset y centered");
  approxEqual(state.offset.x, 0, "tall initial offset x pinned");
});

test("initialCropState for a 1x1 extreme image has no room to pan on either axis", () => {
  const natural: NaturalSize = { width: 1, height: 1 };
  const state = initialCropState(natural, VIEWPORT);
  approxEqual(state.offset.x, 0, "1x1 offset x");
  approxEqual(state.offset.y, 0, "1x1 offset y");
});

// —— clampCropOffset / panCropBy ——

test("clampCropOffset refuses to reveal blank space past the image's leading edge", () => {
  const natural: NaturalSize = { width: 800, height: 400 };
  const scale = minCropScale(natural, VIEWPORT);
  const clamped = clampCropOffset({ x: 999, y: 999 }, natural, scale, VIEWPORT);
  // leading edge clamp: offset must never exceed 0 (that would show blank space above/left of the image)
  assert.ok(clamped.x <= 0, "x offset must not exceed 0");
  assert.ok(clamped.y <= 0, "y offset must not exceed 0 (pinned axis stays exactly at its single legal value)");
});

test("clampCropOffset refuses to reveal blank space past the image's trailing edge", () => {
  const natural: NaturalSize = { width: 800, height: 400 };
  const scale = minCropScale(natural, VIEWPORT);
  const displayWidth = natural.width * scale;
  const clamped = clampCropOffset({ x: -999999, y: -999999 }, natural, scale, VIEWPORT);
  approxEqual(clamped.x, VIEWPORT - displayWidth, "x offset clamps to the trailing edge");
  approxEqual(clamped.y, 0, "y offset has no legal range beyond 0 (short axis pinned)");
});

test("panCropBy accumulates a drag delta and clamps the result within legal bounds", () => {
  const natural: NaturalSize = { width: 800, height: 400 };
  const start = initialCropState(natural, VIEWPORT);
  const dragged = panCropBy(start, { x: -20, y: 5 }, natural, VIEWPORT);
  approxEqual(dragged.offset.x, start.offset.x - 20, "pan moves x by the delta while in range");
  approxEqual(dragged.offset.y, 0, "pan cannot move the pinned short axis away from 0");
});

test("panCropBy dragged far past either edge lands exactly at the clamp, never beyond it", () => {
  const natural: NaturalSize = { width: 800, height: 400 };
  const start = initialCropState(natural, VIEWPORT);
  const scale = minCropScale(natural, VIEWPORT);
  const displayWidth = natural.width * scale;
  const draggedRight = panCropBy(start, { x: 100000, y: 0 }, natural, VIEWPORT);
  approxEqual(draggedRight.offset.x, 0, "drag right clamps to 0");
  const draggedLeft = panCropBy(start, { x: -100000, y: 0 }, natural, VIEWPORT);
  approxEqual(draggedLeft.offset.x, VIEWPORT - displayWidth, "drag left clamps to the trailing edge");
});

// —— zoomCropTo ——

test("zoomCropTo anchors on the viewport center: zooming in keeps the visual center point stable", () => {
  const natural: NaturalSize = { width: 1000, height: 1000 };
  const start = initialCropState(natural, VIEWPORT);
  const center = VIEWPORT / 2;
  const sourceCenterBefore = (center - start.offset.x) / start.scale;
  const zoomed = zoomCropTo(start, start.scale * 2, natural, VIEWPORT);
  const sourceCenterAfter = (center - zoomed.offset.x) / zoomed.scale;
  approxEqual(sourceCenterAfter, sourceCenterBefore, "same source pixel stays under the viewport center after zoom");
});

test("zoomCropTo clamps requested scale to the [min, max] legal range", () => {
  const natural: NaturalSize = { width: 1000, height: 1000 };
  const start = initialCropState(natural, VIEWPORT);
  const min = minCropScale(natural, VIEWPORT);
  const max = maxCropScale(natural, VIEWPORT);
  const zoomedTooFar = zoomCropTo(start, max * 100, natural, VIEWPORT);
  approxEqual(zoomedTooFar.scale, max, "zoom clamps to max");
  const zoomedTooLittle = zoomCropTo(start, min / 100, natural, VIEWPORT);
  approxEqual(zoomedTooLittle.scale, min, "zoom clamps to min");
});

test("zoomCropTo never leaves blank space after zooming out to the minimum", () => {
  const natural: NaturalSize = { width: 800, height: 400 };
  const zoomedIn = zoomCropTo(initialCropState(natural, VIEWPORT), maxCropScale(natural, VIEWPORT), natural, VIEWPORT);
  const backToMin = zoomCropTo(zoomedIn, minCropScale(natural, VIEWPORT), natural, VIEWPORT);
  const displayWidth = natural.width * backToMin.scale;
  const displayHeight = natural.height * backToMin.scale;
  assert.ok(backToMin.offset.x <= 0 && backToMin.offset.x >= VIEWPORT - displayWidth, "x within legal range");
  assert.ok(backToMin.offset.y <= 0 && backToMin.offset.y >= VIEWPORT - displayHeight, "y within legal range");
});

// —— cropSourceRect ——

test("cropSourceRect at the initial (min-zoom, centered) state covers the full short axis of the source image", () => {
  const natural: NaturalSize = { width: 800, height: 400 };
  const state = initialCropState(natural, VIEWPORT);
  const rect = cropSourceRect(state, VIEWPORT);
  approxEqual(rect.sy, 0, "wide image: crop starts at the top of the source (short axis pinned)");
  approxEqual(rect.sHeight, natural.height, "wide image: crop spans the entire source height");
  // The long (x) axis should be a centered subset of the source width.
  approxEqual(rect.sWidth, natural.height, "square viewport onto a wide source: crop width == source height (square crop)");
  approxEqual(rect.sx, (natural.width - rect.sWidth) / 2, "wide image: crop is horizontally centered in the source");
});

test("cropSourceRect for a 1x1 extreme image returns the whole single pixel with no NaN/negatives", () => {
  const natural: NaturalSize = { width: 1, height: 1 };
  const state = initialCropState(natural, VIEWPORT);
  const rect = cropSourceRect(state, VIEWPORT);
  approxEqual(rect.sx, 0, "1x1 sx");
  approxEqual(rect.sy, 0, "1x1 sy");
  approxEqual(rect.sWidth, 1, "1x1 sWidth");
  approxEqual(rect.sHeight, 1, "1x1 sHeight");
  for (const value of [rect.sx, rect.sy, rect.sWidth, rect.sHeight]) {
    assert.ok(Number.isFinite(value), "no NaN/Infinity in the extreme 1x1 case");
  }
});

test("cropSourceRect after panning to the trailing edge covers the far end of the source image", () => {
  const natural: NaturalSize = { width: 800, height: 400 };
  const state = initialCropState(natural, VIEWPORT);
  const scale = state.scale;
  const displayWidth = natural.width * scale;
  const panned: CropState = { scale, offset: { x: VIEWPORT - displayWidth, y: 0 } };
  const rect = cropSourceRect(panned, VIEWPORT);
  approxEqual(rect.sx + rect.sWidth, natural.width, "panned fully right: crop window touches the source's right edge");
});

test("cropSourceRect shrinks (zooms in) as scale increases, staying centered on the same source point", () => {
  const natural: NaturalSize = { width: 1000, height: 1000 };
  const start = initialCropState(natural, VIEWPORT);
  const zoomed = zoomCropTo(start, start.scale * 2, natural, VIEWPORT);
  const rectStart = cropSourceRect(start, VIEWPORT);
  const rectZoomed = cropSourceRect(zoomed, VIEWPORT);
  assert.ok(rectZoomed.sWidth < rectStart.sWidth, "zooming in narrows the source crop window");
  approxEqual(rectZoomed.sWidth, rectStart.sWidth / 2, "doubling scale halves the source crop window");
});

test("AVATAR_CROP_OUTPUT_SIZE is the documented 256px square output", () => {
  assert.equal(AVATAR_CROP_OUTPUT_SIZE, 256);
});
