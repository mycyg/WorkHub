import assert from "node:assert/strict";
import test from "node:test";

import {
  openSpotlightAvatarCropModal,
  type SpotlightAvatarCropDeps,
  type SpotlightAvatarCropElement
} from "./settings.js";

// R14 批 AVATAR（头像与资料入口，2026-07-14 用户点名新增，追加拍板：必须支持用户自己裁剪）——
// 桌面 Spotlight 设置视图裁剪层的集成测试：选图 → 裁剪层弹出 → 拖动平移 + 缩放 → 确认 →
// PUT 上传成功这条完整链路。逐字对应 apps/web/src/avatar-crop-modal.test.ts 的 web 端版本——
// 同一套纯裁剪数学（packages/ui/src/avatar/avatar-crop.ts）、各自独立的薄 DOM 接线，这里验证
// 桌面这一侧的接线本身没接错。createSettingsView() 本身可以在无 DOM 的 node:test 下 import
// （settings.test.ts 已经这么做了），但 openSpotlightAvatarCropModal 的默认 deps 会摸真
// document/Image/canvas——所以这里始终传入注入的假 deps，不依赖任何全局 DOM。

class FakeElement implements SpotlightAvatarCropElement {
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
  children: SpotlightAvatarCropElement[] = [];
  removed = false;
  private listeners = new Map<string, Array<(event: any) => void>>();

  appendChild(child: SpotlightAvatarCropElement): void {
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

function makeFakeDeps(overrides: Partial<SpotlightAvatarCropDeps> = {}) {
  const created: FakeElement[] = [];
  const body: FakeElement[] = [];
  const releaseState = { released: false };
  const previewElement = new FakeElement();
  const deps: SpotlightAvatarCropDeps = {
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
      naturalSize: { width: 300, height: 900 },
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

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

test("select image -> crop (drag + zoom) -> confirm -> upload succeeds end to end (desktop Spotlight settings)", async () => {
  const file = new File(["fake-picked-bytes"], "photo.png", { type: "image/png" });
  const { deps, created, body, releaseState, previewElement } = makeFakeDeps();
  const uploaded: Blob[] = [];

  const openPromise = openSpotlightAvatarCropModal(
    file,
    true,
    async (blob) => {
      uploaded.push(blob);
    },
    deps
  );
  await flush();

  assert.equal(body.length, 1, "the overlay must be appended to the body exactly once");
  const confirmBtn = findByTextContent(created, "确认");
  const viewport = created.find((el) => el.children.includes(previewElement));
  assert.ok(viewport, "expected the preview element to be mounted inside a viewport container");
  const initialTop = previewElement.style.top;

  // Tall image (300x900): the short (x) axis is pinned, so drag vertically to actually move it.
  viewport!.dispatch("pointerdown", { clientX: 50, clientY: 200, pointerId: 1 });
  viewport!.dispatch("pointermove", { clientX: 50, clientY: 140, pointerId: 1 });
  assert.notEqual(previewElement.style.top, initialTop, "dragging must move the preview element");
  viewport!.dispatch("pointerup", { pointerId: 1 });

  confirmBtn.dispatch("click");
  await flush();
  await openPromise;

  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0]!.type, "image/webp");
  assert.equal(body[0]!.removed, true);
  assert.equal(releaseState.released, true);
});

test("cancel closes the desktop crop modal without ever calling onConfirm or uploading anything", async () => {
  const file = new File(["fake-picked-bytes"], "photo.png", { type: "image/png" });
  const { deps, created, body, releaseState } = makeFakeDeps();
  let confirmCalls = 0;

  const openPromise = openSpotlightAvatarCropModal(
    file,
    true,
    async () => {
      confirmCalls += 1;
    },
    deps
  );
  await flush();

  const cancelBtn = findByTextContent(created, "取消");
  cancelBtn.dispatch("click");
  await openPromise;

  assert.equal(confirmCalls, 0);
  assert.equal(body[0]!.removed, true);
  assert.equal(releaseState.released, true);
});

test("a failed image load rejects instead of opening a modal (desktop)", async () => {
  const file = new File(["not really an image"], "broken.png", { type: "image/png" });
  const { deps, body } = makeFakeDeps({
    loadImage: async () => {
      throw new Error("avatar_image_load_failed");
    }
  });

  await assert.rejects(
    openSpotlightAvatarCropModal(file, true, async () => undefined, deps),
    /avatar_image_load_failed/
  );
  assert.equal(body.length, 0);
});

test("a canvas encode failure surfaces as a rejection and still releases resources (desktop)", async () => {
  const file = new File(["fake-picked-bytes"], "photo.png", { type: "image/png" });
  const { deps, created, releaseState } = makeFakeDeps({
    renderCrop: async () => {
      throw new Error("avatar_encode_failed");
    }
  });

  const openPromise = openSpotlightAvatarCropModal(file, true, async () => undefined, deps);
  await flush();
  const confirmBtn = findByTextContent(created, "确认");
  confirmBtn.dispatch("click");

  await assert.rejects(openPromise, /avatar_encode_failed/);
  assert.equal(releaseState.released, true);
});

test("the desktop crop layer's copy is Chinese and has no emoji", async () => {
  const file = new File(["fake-picked-bytes"], "photo.png", { type: "image/png" });
  const { deps, created } = makeFakeDeps();

  void openSpotlightAvatarCropModal(file, true, async () => undefined, deps);
  await flush();

  const allText = created.map((el) => el.textContent ?? "").concat(created.flatMap((el) => Object.values(el.attrs))).join(" | ");
  assert.match(allText, /裁剪头像/u);
  assert.doesNotMatch(allText, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "no emoji in crop-layer copy");
});
