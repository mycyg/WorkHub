// Cuu Hijiki Live2D 模型页引导脚本（DSK-04：从内联 <script> 抽出——tauri.conf.json 的
// CSP `script-src 'self'` 不允许内联脚本，dev 走 vite 无 CSP 所以只有打包后才暴露）。
// 依赖同目录 live2d.js 先加载（HTML 里本脚本在其后引入），全局 loadlive2d 由它提供。
(() => {
  const root = document.documentElement;
  const post = (status, detail) => {
    root.dataset.live2dStatus = status;
    try {
      window.parent.postMessage(
        {
          type: "workhub:cuu-live2d",
          model: "hijiki",
          status,
          detail: detail || ""
        },
        "*"
      );
    } catch {}
  };

  window.addEventListener("error", (event) => {
    post("error", event.message || "window error");
  });

  try {
    post("loading");
    loadlive2d("live2d", "./cuu-hijiki.model.json");
    window.setTimeout(() => post("running"), 1200);
  } catch (error) {
    post("error", error && error.message ? error.message : String(error));
  }
})();
