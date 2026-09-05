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

import { webT } from "./locales.js";

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
  // R20 P2-10（焦点生命周期）：开弹窗要把焦点送进去、Tab 圈闭要挪焦点、关弹窗要把焦点还给触发钮——
  // 三处都要能对着某个 AvatarCropElement 调用 .focus()（真实 DOM 元素天生就有；测试假元素补一个
  // 可观察的桩即可，不需要真的模拟浏览器焦点系统）。
  focus(): void;
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
  // R20 P2-10：当前持有焦点的元素——打开时用来记住"触发裁剪的那个按钮"，关闭时把焦点还回去；
  // Tab 圈闭时用来判断"现在焦点在三个可操作件里的第几个"。真实浏览器 = document.activeElement；
  // 缺省（未注入）时视为 null（不做焦点管理，向后兼容任何没有传这个 dep 的调用点）。
  getActiveElement?: () => AvatarCropElement | null;
};

export function defaultAvatarCropDeps(): AvatarCropDeps {
  return {
    createElement: (tag) => document.createElement(tag) as unknown as AvatarCropElement,
    appendToBody: (el) => document.body.appendChild(el as unknown as Node),
    getActiveElement: () => document.activeElement as unknown as AvatarCropElement | null,
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
  // R20 P2-10（焦点生命周期）：记下打开裁剪层之前谁有焦点（通常是"更换头像"触发钮）——关闭（无论
  // 取消/确认/Esc）都要把焦点原样还回去。loadImage 是异步的，必须在它之前、同步地捕获，否则等图片
  // 加载完时焦点可能已经不在原处了（哪怕这个窗口通常很短）。
  const triggerElement = deps.getActiveElement?.() ?? null;
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
        modal.setAttribute("aria-label", webT(zh, "cropAvatar"));
        modal.style.cssText =
          "background:#fff;border-radius:16px;padding:20px;display:grid;gap:14px;max-width:calc(100vw - 32px)";

        const title = deps.createElement("h3");
        title.textContent = webT(zh, "cropAvatar");
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
        zoomSlider.setAttribute("aria-label", webT(zh, "zoom"));

        const hint = deps.createElement("p");
        hint.textContent = webT(zh, "dragToRepositionUseTheSlider");
        hint.style.cssText = "margin:0;font-size:12px;color:#666";

        const actions = deps.createElement("div");
        actions.style.cssText = "display:flex;gap:10px;justify-content:flex-end";
        const cancelBtn = deps.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "wh-btn";
        cancelBtn.textContent = webT(zh, "cancel");
        const confirmBtn = deps.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "wh-btn";
        confirmBtn.textContent = webT(zh, "confirm");

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
        // R20 P2-10（开弹窗焦点移入）：首个可操作件是缩放滑杆（DOM 里第一个真正可聚焦的控件——
        // 取景框本身不接受焦点，只能拖拽）。不挪的话读屏/键盘用户开了弹窗却毫无焦点提示。
        zoomSlider.focus();

        const close = () => {
          if (disposed) {
            return;
          }
          disposed = true;
          overlay.remove();
          loaded.release();
          // R20 P2-10：关闭（取消/确认/Esc 任意路径都走这一个 close）把焦点原样还给触发钮，
          // 键盘/读屏用户不能在裁剪层消失后跌回文档顶部、丢失原本的操作上下文。
          triggerElement?.focus();
        };

        // R20 P2-10（Tab 圈闭）：这个模态只有三个可操作件（缩放滑杆/取消/确认），DOM 顺序即视觉顺序即
        // 期望的 Tab 顺序。overlay 是它们共同的祖先——键盘事件会冒泡上来，在这一层统一拦截管理，不依赖
        // 浏览器原生 Tab 顺序（背景页面其余可聚焦元素仍在文档里，放任原生 Tab 会漏出模态之外）。
        const focusOrder: AvatarCropElement[] = [zoomSlider, cancelBtn, confirmBtn];
        overlay.addEventListener("keydown", (event: KeyboardEvent) => {
          if (event.key === "Escape") {
            event.preventDefault?.();
            close();
            resolveOpen();
            return;
          }
          if (event.key !== "Tab") {
            return;
          }
          event.preventDefault?.();
          const active = deps.getActiveElement?.() ?? null;
          const currentIndex = active ? focusOrder.indexOf(active) : -1;
          const lastIndex = focusOrder.length - 1;
          const nextIndex = event.shiftKey
            ? (currentIndex <= 0 ? lastIndex : currentIndex - 1)
            : (currentIndex === -1 || currentIndex === lastIndex ? 0 : currentIndex + 1);
          focusOrder[nextIndex]?.focus();
        });

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
