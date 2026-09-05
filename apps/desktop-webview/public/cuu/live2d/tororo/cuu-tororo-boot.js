// Cuu Tororo Live2D 模型页引导脚本（同 hijiki 的 DSK-04 修法：内联 <script> 会被
// tauri.conf.json 的 CSP `script-src 'self'` 拦死，抽成独立文件走 'self'）。
// 状态只写 <html data-live2d-status>；DSK-13：向父窗投 "workhub:cuu-live2d" 消息的死通道已删（同 hijiki）。
(() => {
  const root = document.documentElement;
  const post = (status, detail) => {
    root.dataset.live2dStatus = status;
    if (status === "error" && detail) {
      root.dataset.live2dError = String(detail);
    }
  };

  window.addEventListener("error", (event) => {
    post("error", event.message || "window error");
  });

  try {
    post("loading");
    loadlive2d("live2d", "./cuu-tororo.model.json");
    window.setTimeout(() => post("running"), 1200);
  } catch (error) {
    post("error", error && error.message ? error.message : String(error));
  }
})();
