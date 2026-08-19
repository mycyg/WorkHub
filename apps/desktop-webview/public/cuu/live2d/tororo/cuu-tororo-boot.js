// Cuu Tororo Live2D 模型页引导脚本（同 hijiki 的 DSK-04 修法：内联 <script> 会被
// tauri.conf.json 的 CSP `script-src 'self'` 拦死，抽成独立文件走 'self'）。
(() => {
  const root = document.documentElement;
  const post = (status, detail) => {
    root.dataset.live2dStatus = status;
    try {
      window.parent.postMessage(
        {
          type: "workhub:cuu-live2d",
          model: "tororo",
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
    loadlive2d("live2d", "./cuu-tororo.model.json");
    window.setTimeout(() => post("running"), 1200);
  } catch (error) {
    post("error", error && error.message ? error.message : String(error));
  }
})();
