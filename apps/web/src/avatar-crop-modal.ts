// R14 批 AVATAR（头像与资料入口，2026-07-14 用户点名新增，追加拍板：必须支持用户自己裁剪，不能只做
// 自动居中裁）——头像裁剪层：选图后弹一个固定方形取景框，支持拖动平移（Pointer Events，鼠标/触控
// 统一处理）+ 缩放滑杆（键盘天然可达），确认后按取景框换算出源图区域、canvas 裁出 256x256 再走
// PUT /api/me/avatar；取消则什么都不做。取景框↔源图的坐标数学不在这里重写——全部复用
// packages/ui 的纯函数（initialCropState/panCropBy/zoomCropTo/cropSourceRect），桌面端的裁剪层
// （apps/desktop-webview/src/spotlight/views/settings.ts）复用同一套数学、各自只接一层薄 DOM。
//
// 独立成自己的文件（没有和 apps/web/src/browser.ts 的其余绑定函数放一起），是因为 browser.ts 顶层就
// 引用了 `document`（`const root = document.getElementById("root")`）——这个 workspace 的测试运行器
// 没有真实 DOM（node --import tsx --test，无 jsdom），一 import browser.ts 就在模块顶层炸。选图→裁剪→
// 确认→上传这条链路要能被单测覆盖（R14 用户拍板的验收门），裁剪层本体就不能和那一行顶层 DOM 访问共享
// 同一个模块；browser.ts 只 import 这里导出的 openAvatarCropModal 来用。
//
// AvatarCropDeps 是这一层相对"真实 DOM/Image/canvas"的唯一接缝：生产用 defaultAvatarCropDeps
// （真浏览器 API），测试注入假 dom/假图片加载/假 canvas 编码。

import {
  AVATAR_CROP_OUTPUT_SIZE,
  cropSourceRect,
  initialCropState,
  maxCropScale,
  minCropScale,
  panCropBy,
  zoomCropTo,
  type CropState,
  type NaturalSize
} from "@workhub/ui";

const AVATAR_CROP_VIEWPORT_SIZE = 240;

// 故意不用 HTMLElementTagNameMap 泛型——只声明这个模态真正用到的最小成员集合，让测试的假 DOM
// 对象不必去实现整个 HTMLElement 接口。真实 DOM 元素在运行时结构上天然满足这个形状。
export type AvatarCropElement = {
  style: Record<string, string>;
  className: string;
  textContent: string | null;
  hidden: boolean;
  disabled?: boolean;
  type?: string;
  value?: string;
  min?: string;
  max?: string;
  step?: string;
  alt?: string;
  appendChild(child: AvatarCropElement): void;
  remove(): void;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, handler: (event: any) => void): void;
  setPointerCapture?(pointerId: number): void;
};

export type AvatarCropRect = { sx: number; sy: number; sWidth: number; sHeight: number };

export type AvatarCropLoadedImage = {
  // 挂进取景框展示的那个元素（真实场景=<img>；测试可以是任意假元素，只要满足 AvatarCropElement）。
  previewElement: AvatarCropElement;
  // 喂给 canvas.drawImage 的绘制源；真实场景与 previewElement 是同一个 <img>，测试可以是任意占位对象。
  drawSource: unknown;
  naturalSize: NaturalSize;
  release: () => void;
};

export type AvatarCropDeps = {
  createElement: (tag: string) => AvatarCropElement;
  appendToBody: (el: AvatarCropElement) => void;
  loadImage: (file: File) => Promise<AvatarCropLoadedImage>;
  renderCrop: (source: unknown, rect: AvatarCropRect, outputSize: number) => Promise<Blob>;
};

export function defaultAvatarCropDeps(): AvatarCropDeps {
  return {
    createElement: (tag) => document.createElement(tag) as unknown as AvatarCropElement,
    appendToBody: (el) => document.body.appendChild(el as unknown as Node),
    loadImage: (file) =>
      new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
          resolve({
            previewElement: image as unknown as AvatarCropElement,
            drawSource: image,
            naturalSize: { width: image.naturalWidth, height: image.naturalHeight },
            release: () => URL.revokeObjectURL(url)
          });
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("avatar_image_load_failed"));
        };
        image.src = url;
      }),
    renderCrop: (source, rect, outputSize) =>
      new Promise((resolve, reject) => {
        const canvas = document.createElement("canvas");
        canvas.width = outputSize;
        canvas.height = outputSize;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("avatar_canvas_unavailable"));
          return;
        }
        ctx.drawImage(source as CanvasImageSource, rect.sx, rect.sy, rect.sWidth, rect.sHeight, 0, 0, outputSize, outputSize);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
              return;
            }
            // 部分浏览器不支持 webp 编码——原样退回 png（设计约定：toBlob 优先 webp，不支持则 png）。
            canvas.toBlob((pngBlob) => {
              if (pngBlob) {
                resolve(pngBlob);
              } else {
                reject(new Error("avatar_encode_failed"));
              }
            }, "image/png");
          },
          "image/webp",
          0.86
        );
      })
  };
}

// 导出供测试注入假 deps；生产调用点（apps/web/src/browser.ts 的 bindSettingsAvatarPanel）不传
// 第四参，走真浏览器 API。resolve：用户点了确认（无论上传成功与否，onConfirm 内部自己处理失败态）
// 或点了取消。reject：连图片都加载不出来（选了个坏文件）。
export function openAvatarCropModal(
  file: File,
  zh: boolean,
  onConfirm: (blob: Blob) => void | Promise<void>,
  deps: AvatarCropDeps = defaultAvatarCropDeps()
): Promise<void> {
  return new Promise((resolveOpen, rejectOpen) => {
    void deps
      .loadImage(file)
      .then((loaded) => {
        let disposed = false;
        let state: CropState = initialCropState(loaded.naturalSize, AVATAR_CROP_VIEWPORT_SIZE);

        const overlay = deps.createElement("div");
        overlay.className = "wh-avatar-crop-overlay";
        overlay.style.cssText =
          "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(15,18,28,.55);z-index:2000";

        const modal = deps.createElement("div");
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-label", zh ? "裁剪头像" : "Crop avatar");
        modal.style.cssText =
          "background:#fff;border-radius:16px;padding:20px;display:grid;gap:14px;max-width:calc(100vw - 32px)";

        const title = deps.createElement("h3");
        title.textContent = zh ? "裁剪头像" : "Crop avatar";
        title.style.cssText = "margin:0;font-size:16px";

        const viewport = deps.createElement("div");
        viewport.style.cssText = `position:relative;width:${AVATAR_CROP_VIEWPORT_SIZE}px;height:${AVATAR_CROP_VIEWPORT_SIZE}px;overflow:hidden;border-radius:12px;background:#111;touch-action:none;cursor:grab`;

        const previewEl = loaded.previewElement;
        previewEl.style.position = "absolute";
        previewEl.style.left = "0px";
        previewEl.style.top = "0px";
        previewEl.style.transformOrigin = "top left";
        previewEl.alt = "";

        const zoomSlider = deps.createElement("input");
        zoomSlider.type = "range";
        const minScale = minCropScale(loaded.naturalSize, AVATAR_CROP_VIEWPORT_SIZE);
        const maxScale = maxCropScale(loaded.naturalSize, AVATAR_CROP_VIEWPORT_SIZE);
        zoomSlider.min = String(minScale);
        zoomSlider.max = String(maxScale);
        zoomSlider.step = String((maxScale - minScale) / 200 || 0.001);
        zoomSlider.value = String(state.scale);
        zoomSlider.setAttribute("aria-label", zh ? "缩放" : "Zoom");

        const hint = deps.createElement("p");
        hint.textContent = zh
          ? "拖动图片调整位置，用滑杆缩放，取景框内的区域会被保存为头像。"
          : "Drag to reposition, use the slider to zoom — the area inside the frame becomes your avatar.";
        hint.style.cssText = "margin:0;font-size:12px;color:#666";

        const actions = deps.createElement("div");
        actions.style.cssText = "display:flex;gap:10px;justify-content:flex-end";
        const cancelBtn = deps.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "wh-btn";
        cancelBtn.textContent = zh ? "取消" : "Cancel";
        const confirmBtn = deps.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "wh-btn";
        confirmBtn.textContent = zh ? "确认" : "Confirm";

        viewport.appendChild(previewEl);
        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);
        modal.appendChild(title);
        modal.appendChild(viewport);
        modal.appendChild(zoomSlider);
        modal.appendChild(hint);
        modal.appendChild(actions);
        overlay.appendChild(modal);
        deps.appendToBody(overlay);

        const applyState = () => {
          previewEl.style.width = `${loaded.naturalSize.width * state.scale}px`;
          previewEl.style.height = `${loaded.naturalSize.height * state.scale}px`;
          previewEl.style.left = `${state.offset.x}px`;
          previewEl.style.top = `${state.offset.y}px`;
        };
        applyState();

        const close = () => {
          if (disposed) {
            return;
          }
          disposed = true;
          overlay.remove();
          loaded.release();
        };

        let dragging = false;
        let dragStart = { x: 0, y: 0 };
        let dragBase = state;
        viewport.addEventListener("pointerdown", (event: PointerEvent) => {
          dragging = true;
          dragStart = { x: event.clientX, y: event.clientY };
          dragBase = state;
          viewport.setPointerCapture?.(event.pointerId);
        });
        viewport.addEventListener("pointermove", (event: PointerEvent) => {
          if (!dragging) {
            return;
          }
          const delta = { x: event.clientX - dragStart.x, y: event.clientY - dragStart.y };
          state = panCropBy(dragBase, delta, loaded.naturalSize, AVATAR_CROP_VIEWPORT_SIZE);
          applyState();
        });
        const endDrag = () => {
          dragging = false;
        };
        viewport.addEventListener("pointerup", endDrag);
        viewport.addEventListener("pointercancel", endDrag);

        zoomSlider.addEventListener("input", () => {
          const next = Number(zoomSlider.value);
          state = zoomCropTo(state, Number.isFinite(next) ? next : state.scale, loaded.naturalSize, AVATAR_CROP_VIEWPORT_SIZE);
          zoomSlider.value = String(state.scale);
          applyState();
        });

        cancelBtn.addEventListener("click", () => {
          close();
          resolveOpen();
        });

        confirmBtn.addEventListener("click", () => {
          const rect = cropSourceRect(state, AVATAR_CROP_VIEWPORT_SIZE);
          void deps
            .renderCrop(loaded.drawSource, rect, AVATAR_CROP_OUTPUT_SIZE)
            .then((blob) => {
              close();
              return onConfirm(blob);
            })
            .then(() => resolveOpen())
            .catch((error: unknown) => {
              close();
              rejectOpen(error);
            });
        });
      })
      .catch((error: unknown) => {
        rejectOpen(error);
      });
  });
}
