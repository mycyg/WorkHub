// WorkHub 桌面 · 工作台样式（照 src/spotlight/css.ts 的注入模式：一批 rule 字符串，join 后整块 <style>）。
// token 复用 design-system.ts 的 --ds-* 体系（间距/圆角/时长/缓动/字体不变），但工作台是深色玻璃视觉
// （原型 prototype/index.html 的配色），不是 Spotlight 盒子那套浅色玻璃——所以在 .wh-wb 作用域内重新赋值
// 一批颜色相关 token（--ds-ink/--ds-glass/--ds-accent 等），结构类 token（--ds-s*/--ds-radius-*/--ds-dur-*）
// 不动，靠 CSS 自定义属性的级联天然只影响 .wh-wb 子树，不污染同一 bundle 里可能出现的其它浅色表面。
//
// 透明 Tauri 窗口里 backdrop-filter 是空操作（本仓库踩过的坑，见 04 §4-2 与 02 §0）：玻璃质感真正来源是
// window_controls.rs 里的原生 vibrancy（macOS HudWindow material）；这里的 backdrop-filter 只是「有 vibrancy
// 时锦上添花、没有时也不出错」的渐进增强，不透明兜底用 .92 实底（浏览器 dev 预览/vibrancy 失败都落到这层）。

export const workbenchCss = [
  // —— 深色玻璃 token 覆盖（作用域 .wh-ds.wh-wb，选择器特异性天然高于 .wh-ds 本身） —— //
  ".wh-ds.wh-wb{--ds-ink:#e8eaf0;--ds-ink-soft:#c3c7d6;--ds-ink-muted:#9aa1b2;--ds-ink-faint:#666d80;" +
    "--ds-accent:#7aa2ff;--ds-accent-2:#9db8ff;--ds-accent-soft:rgba(122,162,255,.16);" +
    "--ds-success:#5ed49a;--ds-success-soft:rgba(94,212,154,.14);--ds-warn:#f6c66b;--ds-warn-soft:rgba(246,198,107,.14);" +
    "--ds-danger:#ff7a88;--ds-danger-soft:rgba(255,122,136,.14);--ds-info:#7aa2ff;--ds-info-soft:rgba(122,162,255,.14);" +
    "--ds-glass:rgba(255,255,255,.055);--ds-glass-strong:rgba(255,255,255,.09);--ds-glass-quiet:rgba(255,255,255,.035);" +
    "--ds-glass-border:rgba(255,255,255,.08);--ds-glass-hairline:rgba(255,255,255,.14);" +
    "--wb-bg0:#0b0d12;--wb-bg1:#12151d;--wb-cuu:#ffab5e;--wb-cuu-soft:rgba(255,171,94,.14)}",
  ".wh-wb .ds-field{background:rgba(255,255,255,.06);color:var(--ds-ink)}",
  ".wh-wb .ds-field::placeholder{color:var(--ds-ink-faint)}",

  // —— 窗口外壳：无边框，靠自绘拖拽区 + 关闭/最小化控件（透明窗无原生标题栏）。 —— //
  "html,body,#root{margin:0;height:100%;background:transparent}",
  ".wh-wb-window{position:relative;height:100vh;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;" +
    "border-radius:14px;border:1px solid rgba(255,255,255,.1);" +
    "background:linear-gradient(180deg,rgba(30,34,46,.92),rgba(18,21,29,.94));" +
    "box-shadow:0 40px 120px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.06)}",
  ".wh-wb-titlebar{flex:0 0 auto;height:44px;display:flex;align-items:center;gap:10px;padding:0 8px 0 16px;" +
    "border-bottom:1px solid var(--ds-glass-border);-webkit-app-region:drag}",
  ".wh-wb-crumb{font:600 13px/1 var(--ds-font);color:var(--ds-ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-wb-crumb b{color:var(--ds-ink);font-weight:700}",
  ".wh-wb-titlebar-spacer{flex:1 1 auto}",
  ".wh-wb-titlebar-controls{display:flex;align-items:center;gap:4px;-webkit-app-region:no-drag}",
  ".wh-wb-winbtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;" +
    "border:0;background:transparent;color:var(--ds-ink-muted);cursor:pointer;transition:background var(--ds-dur-fast) var(--ds-ease),color var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-winbtn svg{width:14px;height:14px}",
  ".wh-wb-winbtn:hover{background:rgba(255,255,255,.08);color:var(--ds-ink)}",
  ".wh-wb-winbtn--close:hover{background:rgba(255,122,136,.16);color:var(--ds-danger)}",

  // —— 三栏骨架 —— //
  ".wh-wb-body{flex:1 1 auto;min-height:0;display:flex}",
  ".wh-wb-rail{width:242px;flex:0 0 auto;border-right:1px solid var(--ds-glass-border);display:flex;flex-direction:column;" +
    "background:rgba(0,0,0,.14);overflow-y:auto}",
  ".wh-wb-rail-head{padding:14px 14px 8px;font:700 11px/1 var(--ds-font);letter-spacing:.12em;color:var(--ds-ink-faint);text-transform:uppercase}",
  ".wh-wb-project{margin:2px 8px;border-radius:var(--ds-radius-md)}",
  ".wh-wb-project-row{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;padding:8px 10px;" +
    "border:0;border-radius:var(--ds-radius-md);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}",
  ".wh-wb-project-row:hover{background:rgba(255,255,255,.05)}",
  ".wh-wb-project.active .wh-wb-project-row{background:var(--ds-glass-strong)}",
  ".wh-wb-tile{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;" +
    "font:700 12px/1 var(--ds-font);flex:0 0 auto;background:var(--ds-accent-soft);color:var(--ds-accent)}",
  ".wh-wb-tile--new{background:var(--ds-glass);color:var(--ds-ink-faint)}",
  ".wh-wb-tile--new svg{width:14px;height:14px}",
  ".wh-wb-project-name{font:600 13.5px/1.3 var(--ds-font);flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ds-ink)}",
  ".wh-wb-project-name--muted{color:var(--ds-ink-muted);font-weight:500}",
  ".wh-wb-project-dot{width:7px;height:7px;border-radius:50%;background:var(--ds-success);box-shadow:0 0 8px var(--ds-success);flex:0 0 auto}",
  ".wh-wb-tree{padding:2px 0 6px 22px}",
  // 批 1 的树叶行是只读信息(真会话标题/真文件数),主区群聊/网盘视图还没接进这个窗口——不给 cursor:pointer/
  // hover 反馈,免得看起来能点却什么都不做（04 §4-3 铁律）。批 2/6 把对应视图接进来时再升级成可点。
  ".wh-wb-leaf{display:flex;align-items:center;gap:8px;width:calc(100% - 8px);box-sizing:border-box;font:500 13px/1.3 var(--ds-font);" +
    "color:var(--ds-ink-muted);padding:6px 10px;margin:1px 8px 1px 0;border-radius:9px;border:1px solid transparent;" +
    "background:transparent;cursor:default}",
  ".wh-wb-leaf.sel{background:var(--ds-accent-soft);color:var(--ds-ink);border-color:rgba(122,162,255,.25)}",
  ".wh-wb-leaf svg{width:13px;height:13px;flex:0 0 auto;color:var(--ds-ink-faint)}",
  ".wh-wb-leaf.sel svg{color:var(--ds-accent)}",
  ".wh-wb-leaf-count{margin-left:auto;font:700 10.5px/1 var(--ds-font);color:var(--ds-ink-faint);background:var(--ds-glass);padding:1px 6px;border-radius:99px}",
  ".wh-wb-rail-foot{margin-top:auto;border-top:1px solid var(--ds-glass-border);padding:10px 12px}",
  // 军团总览是批 5 的预告条,不是可点按钮(真聚合端点还没接)——没有 hover/cursor:pointer，理由同 .wh-wb-leaf。
  ".wh-wb-army-sum{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;padding:8px 10px;" +
    "border-radius:var(--ds-radius-md);background:var(--ds-glass);color:inherit;cursor:default}",
  ".wh-wb-army-sum svg{width:18px;height:18px;color:var(--wb-cuu)}",
  ".wh-wb-army-sum-t{font:600 12.5px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-army-sum-s{font:500 11px/1.3 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-me{display:flex;align-items:center;gap:8px;padding:10px 10px 2px;font:500 12.5px/1.3 var(--ds-font);color:var(--ds-ink-muted)}",

  // —— 中栏 —— //
  ".wh-wb-center{flex:1 1 auto;min-width:0;overflow-y:auto;padding:20px 26px}",
  ".wh-wb-empty{max-width:420px;margin:14vh auto 0;text-align:center}",
  ".wh-wb-empty-icon{display:inline-flex;width:34px;height:34px;color:var(--ds-accent)}",
  ".wh-wb-empty-icon svg{width:34px;height:34px}",
  ".wh-wb-empty-title{margin:14px 0 0;font:700 17px/1.35 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-empty-sub{margin:8px 0 0;font:500 13px/1.6 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-empty-actions{margin-top:18px;display:flex;justify-content:center}",
  ".wh-wb-summary{max-width:640px}",
  ".wh-wb-summary-title{margin:0;font:700 20px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-summary-sub{margin:6px 0 0;font:500 13px/1.6 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-summary-grid{margin-top:18px;display:flex;flex-wrap:wrap;gap:10px}",
  ".wh-wb-summary-metric{flex:1 1 140px;border:1px solid var(--ds-glass-border);background:var(--ds-glass);" +
    "border-radius:var(--ds-radius-md);padding:12px 14px}",
  ".wh-wb-summary-metric-k{font:600 11px/1 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-summary-metric-v{margin-top:5px;font:800 18px/1 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-summary-note{margin-top:18px;padding:13px 15px;border:1px dashed var(--ds-glass-border);border-radius:var(--ds-radius-md);" +
    "font:500 12.5px/1.6 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-loading{display:flex;align-items:center;justify-content:center;gap:10px;padding:60px 18px;color:var(--ds-ink-muted);font:600 13px/1 var(--ds-font)}",
  ".wh-wb-spinner{width:16px;height:16px;border-radius:50%;border:2px solid var(--ds-accent-soft);border-top-color:var(--ds-accent);animation:ds-spin .7s linear infinite}",
  "@keyframes ds-spin{to{transform:rotate(360deg)}}",
  ".wh-wb-error{padding:40px 18px;text-align:center;color:var(--ds-ink-muted);font:500 13px/1.6 var(--ds-font)}",

  // —— 右栏：情境面板外壳（批 1 只给收放骨架 + 未接内容的诚实占位；真内容归批 5）。 —— //
  ".wh-wb-side{width:300px;flex:0 0 auto;border-left:1px solid var(--ds-glass-border);display:flex;flex-direction:column;" +
    "background:rgba(0,0,0,.14);transition:width var(--ds-dur) var(--ds-ease),opacity var(--ds-dur) var(--ds-ease)}",
  ".wh-wb-side[data-open=\"false\"]{width:0;opacity:0;overflow:hidden;border-left:0}",
  ".wh-wb-side-head{padding:13px 15px 10px;border-bottom:1px solid var(--ds-glass-border);display:flex;align-items:center;gap:8px}",
  ".wh-wb-side-head svg{width:16px;height:16px;color:var(--ds-ink-muted)}",
  ".wh-wb-side-title{font:700 13px/1 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-side-body{flex:1 1 auto;overflow-y:auto;padding:16px 15px;font:500 12.5px/1.6 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-side-toggle{position:absolute;top:8px;right:8px;-webkit-app-region:no-drag}",

  // —— 新建项目模态 —— //
  ".wh-wb-modal-overlay{position:fixed;inset:0;display:none;align-items:flex-start;justify-content:center;" +
    "padding-top:16vh;z-index:50;background:rgba(5,7,12,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}",
  ".wh-wb-modal-overlay[data-open=\"true\"]{display:flex}",
  ".wh-wb-modal{width:min(480px,calc(100vw - 40px));border-radius:20px;overflow:hidden;" +
    "background:linear-gradient(180deg,rgba(44,49,64,.97),rgba(28,32,43,.98));border:1px solid rgba(255,255,255,.14);" +
    "box-shadow:0 50px 140px rgba(0,0,0,.55);padding:18px 20px}",
  ".wh-wb-modal-title{margin:0;font:700 14px/1 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-modal-input{width:100%;box-sizing:border-box;margin:12px 0 10px;padding:10px 12px;" +
    "background:rgba(255,255,255,.06);border:1px solid var(--ds-glass-border);border-radius:10px;" +
    "color:var(--ds-ink);font:500 13.5px/1.3 var(--ds-font);outline:none}",
  ".wh-wb-modal-input:focus{border-color:rgba(122,162,255,.45)}",
  ".wh-wb-modal-note{margin:0;font:500 11.5px/1.7 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-modal-note b{color:var(--ds-ink-soft);font-weight:600}",
  ".wh-wb-modal-error{margin:10px 0 0;font:600 12px/1.5 var(--ds-font);color:var(--ds-danger)}",
  ".wh-wb-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}",

  // —— 通用按钮（复用 .ds-btn 结构，深色配色）。 —— //
  ".wh-wb-btn{font:600 12.5px/1 var(--ds-font);padding:8px 14px;border-radius:99px;border:1px solid var(--ds-glass-border);" +
    "background:var(--ds-glass);color:var(--ds-ink);cursor:pointer;transition:background var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-btn:hover{background:var(--ds-glass-strong)}",
  ".wh-wb-btn:disabled{opacity:.5;cursor:default}",
  ".wh-wb-btn--primary{border:0;color:#0b0d12;background:linear-gradient(135deg,#7aa2ff,#9db8ff);font-weight:700}",
  ".wh-wb-btn--ghost{color:var(--ds-ink-muted);background:transparent;border-color:transparent}",

  "@media (prefers-reduced-motion:reduce){.wh-wb-side,.wh-wb-winbtn,.wh-wb-project-row,.wh-wb-leaf,.wh-wb-btn{transition-duration:.01ms!important}}"
].join("");
