import assert from "node:assert/strict";
import test from "node:test";

import { openAvatarCropModal, type AvatarCropDeps, type AvatarCropElement } from "./avatar-crop-modal.js";

// R14 批 AVATAR（头像与资料入口，2026-07-14 用户点名新增，追加拍板：必须支持用户自己裁剪）——
// 集成测试：选图 → 裁剪层弹出 → 拖动平移 + 缩放 → 确认 → PUT 上传成功这条完整链路。这个 workspace
// 的测试运行器没有真实 DOM（node --import tsx --test，无 jsdom），所以用一个最小假 DOM（FakeElement）
// 通过 AvatarCropDeps 注入，只实现 openAvatarCropModal 真正用到的那几个成员——不是重新发明 jsdom，
// 是给这一条纯 JS 编排逻辑（事件监听→状态更新→style 赋值→confirm 时调 canvas 编码）一个可观察的替身。
// 纯裁剪数学（clampCropOffset/zoomCropTo/cropSourceRect 等）已经在 packages/ui/src/avatar/
// avatar-crop.test.ts 里被穷举单测覆盖，这里只验证「桌面/web 各自的薄 DOM 接线」本身没接错线。

class FakeElement implements AvatarCropElement {
  style: Record<string, string> = {};
  className = "";
  textContent: string | null = null;
  hidden = false;
  disabled?: boolean;
  type?: string;
  value?: string;
  min?: string;
  max?: string;
  step?: string;
  alt?: string;
  attrs: Record<string, string> = {};
  children: AvatarCropElement[] = [];
  removed = false;
  private listeners = new Map<string, Array<(event: any) => void>>();

  appendChild(child: AvatarCropElement): void {
    this.children.push(child);
  }
  remove(): void {
    this.removed = true;
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  addEventListener(type: string, handler: (event: any) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  dispatch(type: string, event: unknown = {}): void {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }
}

function makeFakeDeps(overrides: Partial<AvatarCropDeps> = {}) {
  const created: FakeElement[] = [];
  const body: FakeElement[] = [];
  const releaseState = { released: false };
  const previewElement = new FakeElement();
  const deps: AvatarCropDeps = {
    createElement: (_tag: string) => {
      const el = new FakeElement();
      created.push(el);
      return el;
    },
    appendToBody: (el) => {
      body.push(el as FakeElement);
    },
    loadImage: async () => ({
      previewElement,
      drawSource: "fake-source-token",
      naturalSize: { width: 800, height: 400 },
      release: () => {
        releaseState.released = true;
      }
    }),
    renderCrop: async () => new Blob(["fake-webp-bytes"], { type: "image/webp" }),
    ...overrides
  };
  return { deps, created, body, releaseState, previewElement };
}

function findByTextContent(elements: FakeElement[], text: string): FakeElement {
  const found = elements.find((el) => el.textContent === text);
  assert.ok(found, `expected an element with textContent ${JSON.stringify(text)}`);
  return found;
}

function findByType(elements: FakeElement[], type: string): FakeElement {
  const found = elements.find((el) => el.type === type);
  assert.ok(found, `expected an element with type ${JSON.stringify(type)}`);
  return found;
}

async function flush() {
  // 让 loadImage 的 Promise 链与内部 .then 链跑完，模态构建是同步的，只需要一次微任务。
  await Promise.resolve();
  await Promise.resolve();
}

test("select image -> crop (drag + zoom) -> confirm -> upload succeeds end to end", async () => {
  const file = new File(["fake-picked-bytes"], "photo.png", { type: "image/png" });
  const { deps, created, body, releaseState, previewElement } = makeFakeDeps();
  const uploaded: Blob[] = [];

  const openPromise = openAvatarCropModal(file, true, async (blob) => {
    uploaded.push(blob);
  }, deps);
  await flush();

  // The modal is mounted.
  assert.equal(body.length, 1, "the overlay must be appended to the body exactly once");
  const confirmBtn = findByTextContent(created, "确认");
  const cancelBtn = findByTextContent(created, "取消");
  assert.ok(cancelBtn, "cancel button exists");

  // The viewport is the element the preview image was appended into (initial pan/zoom state applied).
  const viewport = created.find((el) => el.children.includes(previewElement));
  assert.ok(viewport, "expected the preview element to be mounted inside a viewport container");
  const initialLeft = previewElement.style.left;
  const initialWidth = previewElement.style.width;
  assert.ok(initialWidth, "initial crop state must size the preview element (min-zoom applied)");

  // Drag: pan the image — this exercises the pointerdown/pointermove wiring end to end
  // (not just the pure pan math, which is covered separately in packages/ui).
  viewport!.dispatch("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 });
  viewport!.dispatch("pointermove", { clientX: 70, clientY: 100, pointerId: 1 });
  assert.notEqual(previewElement.style.left, initialLeft, "dragging must move the preview element");
  viewport!.dispatch("pointerup", { pointerId: 1 });

  // Zoom: move the slider — exercises the zoom wiring end to end.
  const slider = findByType(created, "range");
  const zoomedInScale = String(Number(slider.min) * 1.5);
  slider.value = zoomedInScale;
  slider.dispatch("input");
  assert.notEqual(previewElement.style.width, initialWidth, "zooming must resize the preview element");

  // Confirm: draws via deps.renderCrop, uploads via onConfirm, then resolves/cleans up.
  confirmBtn.dispatch("click");
  await flush();
  await openPromise;

  assert.equal(uploaded.length, 1, "onConfirm (the upload callback) must be called exactly once");
  assert.equal(uploaded[0]!.type, "image/webp");
  assert.equal(body[0]!.removed, true, "the overlay must be removed from the DOM after confirm");
  assert.equal(releaseState.released, true, "the object URL / loaded image resources must be released after confirm");
});

test("cancel closes the modal without ever calling onConfirm or uploading anything", async () => {
  const file = new File(["fake-picked-bytes"], "photo.png", { type: "image/png" });
  const { deps, created, body, releaseState } = makeFakeDeps();
  let confirmCalls = 0;

  const openPromise = openAvatarCropModal(file, true, async () => {
    confirmCalls += 1;
  }, deps);
  await flush();

  const cancelBtn = findByTextContent(created, "取消");
  cancelBtn.dispatch("click");
  await openPromise;

  assert.equal(confirmCalls, 0);
  assert.equal(body[0]!.removed, true);
  assert.equal(releaseState.released, true);
});

test("a failed image load rejects instead of opening a modal for a broken file", async () => {
  const file = new File(["not really an image"], "broken.png", { type: "image/png" });
  const { deps, body } = makeFakeDeps({
    loadImage: async () => {
      throw new Error("avatar_image_load_failed");
    }
  });

  await assert.rejects(
    openAvatarCropModal(file, true, async () => undefined, deps),
    /avatar_image_load_failed/
  );
  assert.equal(body.length, 0, "no modal should ever be mounted when the image fails to load");
});

test("a canvas encode failure surfaces as a rejection and still tears down the modal (resources released)", async () => {
  const file = new File(["fake-picked-bytes"], "photo.png", { type: "image/png" });
  const { deps, created, releaseState } = makeFakeDeps({
    renderCrop: async () => {
      throw new Error("avatar_encode_failed");
    }
  });

  const openPromise = openAvatarCropModal(file, true, async () => undefined, deps);
  await flush();
  const confirmBtn = findByTextContent(created, "确认");
  confirmBtn.dispatch("click");

  await assert.rejects(openPromise, /avatar_encode_failed/);
  assert.equal(releaseState.released, true, "even a failed encode must release the loaded image resources");
});

test("the crop layer's copy is Chinese, has no emoji, and (web) never says Cuu", async () => {
  const file = new File(["fake-picked-bytes"], "photo.png", { type: "image/png" });
  const { deps, created } = makeFakeDeps();

  // Deliberately not awaited to completion — the modal stays open until confirm/cancel, and this
  // test only inspects the copy rendered into it, not the resolve path (covered by the tests above).
  void openAvatarCropModal(file, true, async () => undefined, deps);
  await flush();

  const allText = created.map((el) => el.textContent ?? "").concat(created.flatMap((el) => Object.values(el.attrs))).join(" | ");
  assert.match(allText, /裁剪头像/u);
  assert.doesNotMatch(allText, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "no emoji in crop-layer copy");
  assert.doesNotMatch(allText, /\bCuu\b/u, "web copy must never say Cuu");
});
