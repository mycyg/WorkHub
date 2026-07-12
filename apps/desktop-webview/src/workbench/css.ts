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
    "border-radius:24px;border:1px solid rgba(255,255,255,.1);" +
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
  ".wh-wb-tile--ok{background:var(--ds-success-soft);color:var(--ds-success)}",
  ".wh-wb-tile--warn{background:var(--ds-warn-soft);color:var(--ds-warn)}",
  ".wh-wb-tile--cuu{background:var(--wb-cuu-soft);color:var(--wb-cuu)}",
  ".wh-wb-tile--new svg{width:14px;height:14px}",
  ".wh-wb-project-name{font:600 13.5px/1.3 var(--ds-font);flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ds-ink)}",
  ".wh-wb-project-name--muted{color:var(--ds-ink-muted);font-weight:500}",
  ".wh-wb-project-dot{width:7px;height:7px;border-radius:50%;background:var(--ds-success);box-shadow:0 0 8px var(--ds-success);flex:0 0 auto}",
  ".wh-wb-tree{padding:2px 0 6px 22px}",
  // 批 1 的树叶行是只读信息(真会话标题/真文件数)——网盘视图还没接进这个窗口(批 6)，不给
  // cursor:pointer/hover 反馈,免得看起来能点却什么都不做（04 §4-3 铁律）。批 2 把主区群聊接进这个
  // 窗口后，「主区」升级成 .wh-wb-leaf--live（真 <button>，会话点击路由）；「网盘」仍是这条规则。
  ".wh-wb-leaf{display:flex;align-items:center;gap:8px;width:calc(100% - 8px);box-sizing:border-box;font:500 13px/1.3 var(--ds-font);" +
    "text-align:left;color:var(--ds-ink-muted);padding:6px 10px;margin:1px 8px 1px 0;border-radius:9px;border:1px solid transparent;" +
    "background:transparent;cursor:default}",
  ".wh-wb-leaf.sel{background:var(--ds-accent-soft);color:var(--ds-ink);border-color:rgba(122,162,255,.25)}",
  ".wh-wb-leaf svg{width:13px;height:13px;flex:0 0 auto;color:var(--ds-ink-faint)}",
  ".wh-wb-leaf.sel svg{color:var(--ds-accent)}",
  ".wh-wb-leaf--live{cursor:pointer;transition:background var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-leaf--live:hover{background:var(--ds-glass-strong)}",
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
  ".wh-wb-side{width:322px;flex:0 0 auto;border-left:1px solid var(--ds-glass-border);display:flex;flex-direction:column;" +
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

  // —— 批 2：主区群聊。中栏在渲染群聊时切成 flex 列布局，自己管内部滚动区（composer 常驻底部），
  // 不再吃 .wh-wb-center 默认的整体滚动+内边距。 —— //
  ".wh-wb-center.wh-wb-center--chat{padding:0;display:flex;flex-direction:column;overflow:hidden}",
  ".wh-wb-chat{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}",
  ".wh-wb-chat-banner{flex:none;padding:6px 20px;text-align:center;font:600 11.5px/1.4 var(--ds-font);" +
    "color:var(--ds-warn);background:var(--ds-warn-soft);border-bottom:1px solid var(--ds-glass-border)}",
  ".wh-wb-chat-head{flex:none;display:flex;align-items:center;gap:10px;padding:9px 20px;" +
    "border-bottom:1px solid var(--ds-glass-border);font:500 11.5px/1 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-chat-avs{display:flex}",
  ".wh-wb-chat-avatar{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;" +
    "font:700 10px/1 var(--ds-font);color:#fff;margin-right:-6px;border:1.5px solid var(--wb-bg1);flex:0 0 auto}",
  ".wh-wb-chat-avatar--cuu{background:var(--wb-cuu-soft);color:var(--wb-cuu)}",
  ".wh-wb-chat-avatar--cuu svg{width:12px;height:12px}",
  ".wh-wb-chat-head-label{margin-left:4px}",
  ".wh-wb-chat-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:16px 20px 6px}",
  ".wh-wb-chat-daysep{display:flex;align-items:center;gap:10px;color:var(--ds-ink-faint);font:600 10.5px/1 var(--ds-font);margin:6px 0 14px}",
  ".wh-wb-chat-daysep::before,.wh-wb-chat-daysep::after{content:\"\";flex:1;height:1px;background:var(--ds-glass-border)}",
  ".wh-wb-chat-msg{display:flex;gap:9px;margin:0 0 14px;align-items:flex-start}",
  ".wh-wb-chat-bub{min-width:0;max-width:min(560px,86%)}",
  ".wh-wb-chat-msg--self{flex-direction:row-reverse}",
  ".wh-wb-chat-msg--self .wh-wb-chat-bub{text-align:right}",
  ".wh-wb-chat-msg--self .wh-wb-chat-who{flex-direction:row-reverse}",
  ".wh-wb-chat-who{display:flex;align-items:baseline;gap:7px;font:600 12px/1 var(--ds-font);color:var(--ds-ink-soft);margin-bottom:4px}",
  ".wh-wb-chat-tm{font:500 10.5px/1 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-chat-txt{font:500 13px/1.55 var(--ds-font);color:var(--ds-ink);white-space:pre-wrap;word-break:break-word;" +
    "background:var(--ds-glass);border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);padding:9px 12px;display:inline-block;text-align:left}",
  ".wh-wb-chat-msg--cuu .wh-wb-chat-txt{background:var(--wb-cuu-soft);border-color:rgba(255,171,94,.28)}",
  ".wh-wb-chat-msg--self .wh-wb-chat-txt{background:var(--ds-accent-soft);border-color:rgba(122,162,255,.3)}",
  ".wh-wb-chat-mention{color:var(--ds-accent-2);font-weight:700}",
  ".wh-wb-chat-msg--pending{opacity:.72}",
  ".wh-wb-chat-pending-status{display:block;margin-top:3px;font:500 10.5px/1.4 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-chat-pending-status--error{color:var(--ds-danger)}",
  ".wh-wb-chat-pending-retry{margin-left:4px;border:0;background:transparent;color:var(--ds-accent-2);" +
    "font:700 10.5px/1 var(--ds-font);cursor:pointer;padding:0;text-decoration:underline}",
  ".wh-wb-chat-filecard{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:var(--ds-radius-md);" +
    "border:1px solid var(--ds-glass-border);background:var(--ds-glass);cursor:default;font:inherit;color:inherit;text-align:left}",
  ".wh-wb-chat-filecard svg{width:15px;height:15px;color:var(--ds-ink-muted);flex:0 0 auto}",
  ".wh-wb-chat-filecard-name{font:600 12.5px/1.3 var(--ds-font);color:var(--ds-ink)}",
  // R12 批 6：已落库消息的 file_card 可点开右栏预览——发送中的乐观渲染（无 --live 修饰符）继续
  // 保持 cursor:default，不给假点击反馈。
  ".wh-wb-chat-filecard--live{cursor:pointer;transition:background var(--ds-dur-fast) var(--ds-ease),border-color var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-chat-filecard--live:hover{background:var(--ds-glass-strong);border-color:rgba(122,162,255,.3)}",
  ".wh-wb-chat-actioncard{max-width:420px;border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);" +
    "",
  // 产出卡(批 4b,原型 .editcard):与行动卡共用骨架但必须有独立身份——决策卡问"要不要",产出卡说"做完了"。
  ".wh-wb-chat-actioncard--deliverable{border-left:3px solid var(--ds-success);background:linear-gradient(90deg,var(--ds-success-soft),transparent 42%)}",
  ".wh-wb-chat-actioncard--deliverable .wh-wb-chat-actioncard-h{color:var(--ds-ink)}" +
    "background:var(--wb-cuu-soft);padding:11px 13px}",
  ".wh-wb-chat-actioncard-h{font:700 12.5px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-chat-actioncard-list{margin:8px 0 0;padding-left:18px;font:500 12px/1.6 var(--ds-font);color:var(--ds-ink-soft)}",
  // 00 §9：撤销后该项置灰划线 +「已撤销」，不删卡——划线只落在标题上，状态标不划（划掉的「已撤销」
  // 三个字会读成双重否定）。
  ".wh-wb-chat-actioncard-item-status{margin-left:6px;font:600 10.5px/1 var(--ds-font);color:var(--ds-ink-faint);" +
    "border:1px solid var(--ds-glass-border);border-radius:999px;padding:2px 7px;white-space:nowrap}",
  ".wh-wb-chat-actioncard-item--undone{color:var(--ds-ink-faint)}",
  ".wh-wb-chat-actioncard-item--undone .wh-wb-chat-actioncard-item-title{text-decoration:line-through}",
  ".wh-wb-chat-actioncard-note{margin-top:8px;font:500 11px/1.5 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-chat-note{font:500 12px/1.5 var(--ds-font);color:var(--ds-ink-muted);font-style:italic}",
  ".wh-wb-chat-sysline{display:flex;align-items:center;justify-content:center;gap:8px;margin:8px 0;" +
    "font:500 11.5px/1.4 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-chat-sysline-tm{color:var(--ds-ink-faint)}",
  ".wh-wb-chat-empty{max-width:380px;margin:10vh auto 0;text-align:center}",
  ".wh-wb-chat-empty-icon{display:inline-flex;width:30px;height:30px;color:var(--wb-cuu)}",
  ".wh-wb-chat-empty-icon svg{width:30px;height:30px}",
  ".wh-wb-chat-empty-title{margin:12px 0 0;font:700 15.5px/1.35 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-chat-empty-body{margin:8px 0 0;font:500 12.5px/1.6 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-chat-error{padding:30px 18px;text-align:center;color:var(--ds-ink-muted);font:500 13px/1.6 var(--ds-font)}",
  // R12 批8：滚到顶「加载更早」占位——本地展开/服务端翻页共用同一套外观，loading/error 修饰符切换
  // 内容而不是重排布局，避免翻页时的视觉跳动。
  ".wh-wb-chat-load-earlier{margin:0 0 12px;padding:9px 12px;border-radius:var(--ds-radius-md);text-align:center;" +
    "font:600 11.5px/1.5 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-chat-load-earlier--loading{display:flex;align-items:center;justify-content:center;gap:7px}",
  ".wh-wb-chat-load-earlier--error{color:var(--ds-danger)}",
  ".wh-wb-chat-load-earlier button{margin-left:6px}",
  // 长文本折叠——渐隐尾巴暗示"还有更多"，展开/收起按钮复用消息气泡外的通栏小字链接样式。
  ".wh-wb-chat-txt--folded{position:relative;max-height:9.5em;overflow:hidden}",
  ".wh-wb-chat-txt-fade{position:absolute;left:0;right:0;bottom:0;height:2.4em;pointer-events:none;" +
    "background:linear-gradient(to bottom,transparent,var(--ds-glass))}",
  ".wh-wb-chat-msg--cuu .wh-wb-chat-txt-fade{background:linear-gradient(to bottom,transparent,var(--wb-cuu-soft))}",
  ".wh-wb-chat-msg--self .wh-wb-chat-txt-fade{background:linear-gradient(to bottom,transparent,var(--ds-accent-soft))}",
  ".wh-wb-chat-text-toggle{display:block;margin-top:4px;border:0;background:transparent;color:var(--ds-accent-2);" +
    "font:700 11px/1 var(--ds-font);cursor:pointer;padding:0;text-decoration:underline}",

  // —— 正在输入 —— //
  ".wh-wb-chat-typing{flex:none;padding:0 20px 4px;font:500 11px/1 var(--ds-font);color:var(--ds-ink-faint);" +
    "display:flex;align-items:center;gap:5px;min-height:15px}",
  ".wh-wb-chat-typing-dots{display:inline-flex;gap:2px}",
  ".wh-wb-chat-typing-dots i{width:3px;height:3px;border-radius:50%;background:var(--ds-ink-faint);" +
    "animation:ds-chat-typing-pulse 1.1s var(--ds-ease) infinite}",
  ".wh-wb-chat-typing-dots i:nth-child(2){animation-delay:.15s}",
  ".wh-wb-chat-typing-dots i:nth-child(3){animation-delay:.3s}",
  "@keyframes ds-chat-typing-pulse{0%,60%,100%{opacity:.25;transform:scale(.85)}30%{opacity:1;transform:scale(1)}}",

  // —— composer —— //
  ".wh-wb-chat-composer{flex:none;padding:8px 20px 16px}",
  ".wh-wb-chat-attachments{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}",
  ".wh-wb-chat-attachment-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 8px 5px 10px;" +
    "border-radius:99px;border:1px solid var(--ds-glass-border);background:var(--ds-glass);font:600 11.5px/1 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-chat-attachment-chip svg{width:12px;height:12px;color:var(--ds-ink-muted)}",
  ".wh-wb-chat-attachment-chip button{display:inline-flex;border:0;background:transparent;color:var(--ds-ink-faint);cursor:pointer;padding:0}",
  ".wh-wb-chat-attachment-chip button svg{width:11px;height:11px}",
  ".wh-wb-chat-send-error{display:flex;align-items:center;gap:10px;margin-bottom:8px;padding:8px 12px;" +
    "border-radius:var(--ds-radius-md);border:1px solid rgba(255,122,136,.3);background:var(--ds-danger-soft);" +
    "font:600 12px/1.4 var(--ds-font);color:var(--ds-danger)}",
  ".wh-wb-chat-cbox{border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-lg);background:var(--ds-glass);" +
    "padding:10px 12px 8px;position:relative}",
  ".wh-wb-chat-input{width:100%;box-sizing:border-box;resize:none;border:0;background:transparent;outline:none;" +
    "font:500 13px/1.5 var(--ds-font);color:var(--ds-ink);min-height:20px;max-height:120px}",
  ".wh-wb-chat-input::placeholder{color:var(--ds-ink-faint)}",
  ".wh-wb-chat-input:disabled{opacity:.6}",
  ".wh-wb-chat-ctools{display:flex;align-items:center;gap:6px;margin-top:8px}",
  ".wh-wb-chat-ctag{display:inline-flex;align-items:center;gap:3px;font:600 11px/1 var(--ds-font);color:var(--ds-ink-muted);" +
    "padding:4px 8px;border-radius:99px;background:var(--ds-glass-quiet);border:0;cursor:pointer}",
  ".wh-wb-chat-ctag b{color:var(--ds-accent-2)}",
  ".wh-wb-chat-ctag:hover{background:var(--ds-glass-strong)}",
  ".wh-wb-chat-ctag--soon{cursor:default;opacity:.55}",
  ".wh-wb-chat-ctag--soon:hover{background:var(--ds-glass-quiet)}",
  ".wh-wb-chat-send{margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;" +
    "border-radius:50%;border:0;background:linear-gradient(135deg,#7aa2ff,#9db8ff);color:#0b0d12;cursor:pointer}",
  ".wh-wb-chat-send svg{width:13px;height:13px}",
  ".wh-wb-chat-send:disabled{opacity:.35;cursor:default;background:var(--ds-glass)}",

  // —— @ picker / 「即将可用」占位 picker —— //
  ".wh-wb-chat-picker{position:absolute;left:12px;right:12px;bottom:calc(100% + 8px);max-height:220px;overflow-y:auto;" +
    "border-radius:var(--ds-radius-md);border:1px solid var(--ds-glass-border);" +
    "background:linear-gradient(180deg,rgba(44,49,64,.98),rgba(28,32,43,.99));box-shadow:0 24px 60px rgba(0,0,0,.4);padding:6px}",
  ".wh-wb-chat-picker-section-title{padding:6px 8px 3px;font:700 10px/1 var(--ds-font);letter-spacing:.08em;" +
    "text-transform:uppercase;color:var(--ds-ink-faint)}",
  ".wh-wb-chat-picker-row{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:6px 8px;" +
    "border:0;border-radius:8px;background:transparent;color:var(--ds-ink);font:500 12.5px/1.3 var(--ds-font);text-align:left;cursor:pointer}",
  ".wh-wb-chat-picker-row:hover{background:var(--ds-glass-strong)}",
  ".wh-wb-chat-picker-row svg{width:14px;height:14px;color:var(--ds-ink-muted);flex:0 0 auto}",
  ".wh-wb-chat-picker-loading,.wh-wb-chat-picker-empty{padding:8px;font:500 12px/1.4 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-chat-picker--soon{padding:12px}",
  ".wh-wb-chat-picker-title{font:700 12.5px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-chat-picker-soon-note{margin-top:4px;font:500 11.5px/1.5 var(--ds-font);color:var(--ds-ink-faint)}",

  // —— 网盘标签页 + 侧栏预览/版本历史（批 6）——视觉复审逮到的硬伤:这套类名此前一条规则都没有,
  // 真机裸奔成浏览器默认排版。观感对齐 prototype 的 .file-row/.side 系(玻璃底/hairline/圆角 token)。
  ".wh-wb-drive{display:flex;flex-direction:column;height:100%;min-height:0}",
  ".wh-wb-drive-bar{display:flex;align-items:center;gap:8px;padding:12px 18px;border-bottom:1px solid var(--ds-glass-border);flex:0 0 auto}",
  ".wh-wb-drive-path{display:flex;align-items:center;gap:4px;font:600 12.5px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-drive-crumb-link{background:transparent;border:0;padding:2px 4px;border-radius:6px;color:var(--ds-accent);font:600 12.5px/1.3 var(--ds-font);cursor:pointer}",
  ".wh-wb-drive-crumb-link:hover{background:var(--ds-accent-soft)}",
  ".wh-wb-drive-crumb-sep{color:var(--ds-ink-faint)}",
  ".wh-wb-drive-note{font:500 11px/1.4 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-drive-bar-spacer{flex:1}",
  ".wh-wb-drive-upload-label{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:9px;" +
    "background:var(--ds-glass-strong);border:1px solid var(--ds-glass-border);color:var(--ds-ink);" +
    "font:600 12px/1.2 var(--ds-font);cursor:pointer}",
  ".wh-wb-drive-upload-label:hover{background:var(--ds-accent-soft);border-color:rgba(122,162,255,.3)}",
  ".wh-wb-drive-upload-input{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0 0 0 0)}",
  ".wh-wb-drive-list{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:2px;min-height:0}",
  ".wh-wb-drive-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:var(--ds-radius-sm);cursor:default}",
  ".wh-wb-drive-row[data-wb-drive-open],.wh-wb-drive-row[data-wb-drive-preview]{cursor:pointer}",
  ".wh-wb-drive-row:hover{background:var(--ds-glass)}",
  ".wh-wb-drive-row-icon{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;" +
    "background:var(--ds-accent-soft);color:var(--ds-accent);flex:0 0 auto}",
  ".wh-wb-drive-row-icon svg{width:15px;height:15px}",
  ".wh-wb-drive-row-main{flex:1;min-width:0}",
  ".wh-wb-drive-row-name{font:600 13px/1.3 var(--ds-font);color:var(--ds-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".wh-wb-drive-row-meta{font:500 11px/1.4 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-drive-row-actions{display:flex;align-items:center;gap:4px;flex:0 0 auto}",
  ".wh-wb-act{background:transparent;border:1px solid var(--ds-glass-border);border-radius:8px;padding:4px 10px;" +
    "color:var(--ds-ink-muted);font:600 11.5px/1.2 var(--ds-font);cursor:pointer}",
  ".wh-wb-act:hover{background:var(--ds-glass-strong);color:var(--ds-ink)}",
  ".wh-wb-act--danger:hover{background:var(--ds-danger-soft);border-color:rgba(255,122,136,.35);color:var(--ds-danger)}",
  ".wh-wb-drive-empty{padding:36px 20px;text-align:center;font:500 12.5px/1.6 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-drive-action-error{margin:6px 18px;padding:8px 12px;border-radius:var(--ds-radius-sm);" +
    "background:var(--ds-danger-soft);border:1px solid rgba(255,122,136,.3);color:var(--ds-danger);font:500 12px/1.4 var(--ds-font)}",
  ".wh-wb-drive-side-head{display:flex;align-items:center;gap:8px;padding:0 0 8px;border-bottom:1px solid var(--ds-glass-border);margin-bottom:10px}",
  ".wh-wb-drive-side-title{font:700 12.5px/1.3 var(--ds-font);color:var(--ds-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".wh-wb-drive-side-note{font:500 11px/1.5 var(--ds-font);color:var(--ds-ink-faint);margin:4px 0 8px}",
  ".wh-wb-drive-side-idle{padding:22px 6px;font:500 12px/1.6 var(--ds-font);color:var(--ds-ink-faint);text-align:center}",
  ".wh-wb-drive-side-item{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:var(--ds-radius-sm);" +
    "background:var(--ds-glass);border:1px solid var(--ds-glass-border);margin-bottom:8px;font:500 12px/1.5 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-drive-side-error{padding:8px 10px;border-radius:var(--ds-radius-sm);background:var(--ds-danger-soft);" +
    "border:1px solid rgba(255,122,136,.3);color:var(--ds-danger);font:500 12px/1.5 var(--ds-font)}",
  ".wh-wb-drive-preview-text{white-space:pre-wrap;font:500 12px/1.65 var(--ds-font);color:var(--ds-ink-muted);" +
    "background:var(--ds-glass);border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-sm);padding:10px 12px;" +
    "max-height:320px;overflow-y:auto}",
  ".wh-wb-drive-version-list{display:flex;flex-direction:column;gap:6px;margin-top:8px}",
  ".wh-wb-drive-version-row{display:flex;flex-direction:column;gap:3px;padding:8px 10px;border-radius:var(--ds-radius-sm);" +
    "background:var(--ds-glass);border:1px solid var(--ds-glass-border)}",
  ".wh-wb-drive-version-top{display:flex;align-items:center;gap:8px}",
  ".wh-wb-drive-version-no{font:700 12px/1.2 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-drive-version-current{font:600 10px/1.2 var(--ds-font);color:var(--ds-success);background:var(--ds-success-soft);" +
    "padding:2px 7px;border-radius:99px}",
  ".wh-wb-drive-version-meta{font:500 11px/1.4 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-drive-restore-btn{align-self:flex-start;margin-top:3px;background:transparent;border:1px solid var(--ds-glass-border);" +
    "border-radius:8px;padding:4px 10px;color:var(--ds-accent);font:600 11.5px/1.2 var(--ds-font);cursor:pointer}",
  ".wh-wb-drive-restore-btn:hover{background:var(--ds-accent-soft);border-color:rgba(122,162,255,.3)}",
  ".wh-wb-drive-version-confirm{display:flex;align-items:center;gap:6px;margin-top:4px;font:500 11.5px/1.4 var(--ds-font);color:var(--ds-warn)}",
  ".wh-wb-drive-version-error{margin-top:4px;font:500 11.5px/1.4 var(--ds-font);color:var(--ds-danger)}",

  // —— R12（模式五档弹层，仅协同会话 composer）：照 prototype 的 .power chip / #powerPop 弹层观感——
  // 玻璃底/圆角/选中态复用既有 --ds-glass*/--ds-radius-*/--wb-cuu* token，第 5 档警示变体复用
  // --ds-warn*，不写死不透明白底（04 §4-2 铁律：透明 Tauri 窗里 backdrop-filter 是空操作，这里的
  // linear-gradient 深色底同 .wh-wb-chat-picker/.wh-wb-modal 的既有做法一致，是真正的不透明兜底，
  // 不是"看起来透明实际乳白"）。 —— //
  ".wh-wb-mode-chip{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font:600 11px/1 var(--ds-font);" +
    "color:var(--ds-ink-muted);padding:4px 10px;border-radius:var(--ds-radius-pill);border:1px solid var(--ds-glass-border);" +
    "background:transparent;cursor:pointer;white-space:nowrap;transition:background var(--ds-dur-fast) var(--ds-ease)," +
    "color var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-mode-chip:hover{color:var(--ds-ink);background:var(--ds-glass)}",
  ".wh-wb-mode-chip-lv{color:var(--wb-cuu)}",
  ".wh-wb-mode-chip--warn{color:var(--ds-warn);border-color:rgba(246,198,107,.45);background:var(--ds-warn-soft)}",
  ".wh-wb-mode-chip--warn .wh-wb-mode-chip-lv{color:var(--ds-warn)}",
  ".wh-wb-mode-pop{position:absolute;right:0;bottom:calc(100% + 8px);width:280px;z-index:6;box-sizing:border-box;" +
    "background:linear-gradient(180deg,rgba(44,49,64,.97),rgba(28,32,43,.98));border:1px solid var(--ds-glass-border);" +
    "border-radius:var(--ds-radius-lg);padding:14px;box-shadow:0 24px 80px rgba(0,0,0,.5)}",
  ".wh-wb-mode-pop-title{font:700 12.5px/1.3 var(--ds-font);color:var(--ds-ink);margin-bottom:3px}",
  ".wh-wb-mode-pop-sub{font:500 11px/1.5 var(--ds-font);color:var(--ds-ink-muted);margin-bottom:11px}",
  ".wh-wb-mode-lvl{display:flex;align-items:flex-start;gap:9px;padding:8px 9px;border-radius:var(--ds-radius-sm);" +
    "cursor:pointer;border:1px solid transparent;transition:background var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-mode-lvl:hover{background:var(--ds-glass)}",
  ".wh-wb-mode-lvl--on{background:var(--wb-cuu-soft);border-color:rgba(255,171,94,.3)}",
  ".wh-wb-mode-lvl-r{width:14px;height:14px;border-radius:50%;border:1.5px solid var(--ds-ink-faint);margin-top:2px;flex:0 0 auto}",
  ".wh-wb-mode-lvl--on .wh-wb-mode-lvl-r{border-color:var(--wb-cuu);" +
    "background:radial-gradient(circle at center,var(--wb-cuu) 45%,transparent 50%)}",
  ".wh-wb-mode-lvl-body{flex:1 1 auto;min-width:0}",
  ".wh-wb-mode-lvl-title{display:block;font:600 12.5px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-mode-lvl-desc{display:block;font:500 11px/1.5 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-mode-lvl-num{font:500 11px/1 var(--ds-font);color:var(--ds-ink-faint);align-self:center}",
  // 第 5 档「全托管 · AI 审」——选中时才切到警示色（未选中只是普通行，同 prototype 的 .lvl.warn 只在
  // 叠加 .on 才真正变色），照原型 .lvl.warn.on 的取舍。
  ".wh-wb-mode-lvl--warn.wh-wb-mode-lvl--on{background:var(--ds-warn-soft);border-color:rgba(246,198,107,.35)}",
  ".wh-wb-mode-lvl--warn.wh-wb-mode-lvl--on .wh-wb-mode-lvl-r{border-color:var(--ds-warn);" +
    "background:radial-gradient(circle at center,var(--ds-warn) 45%,transparent 50%)}",
  // 「按能力细分」纯说明文字——没有 cursor:pointer（不是按钮，见 render.ts renderModePopoverHtml 顶部
  // 注释，04 §4 铁律 3：没有真接线就不能看起来能点）。
  ".wh-wb-mode-gran{font:500 11px/1.5 var(--ds-font);color:var(--ds-ink-faint);margin-top:9px}",
  ".wh-wb-mode-srv{display:flex;gap:7px;margin-top:11px;padding-top:10px;border-top:1px solid var(--ds-glass-border);" +
    "font:500 11px/1.7 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-mode-srv svg{width:13px;height:13px;margin-top:2px;color:var(--ds-ink-muted);flex:0 0 auto}",
  ".wh-wb-mode-srv b{color:var(--ds-ink-soft);font-weight:600}",
  // composer 旁的模式提示行——只观察档预告用中性灰字，PATCH 失败用 --error 修饰符换成 danger 色。
  ".wh-wb-mode-hint{flex:none;padding:0 20px 4px;font:500 11px/1.4 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-mode-hint--error{color:var(--ds-danger)}",

  "@media (prefers-reduced-motion:reduce){.wh-wb-side,.wh-wb-winbtn,.wh-wb-project-row,.wh-wb-leaf,.wh-wb-btn," +
    ".wh-wb-chat-ctag,.wh-wb-chat-typing-dots i{transition-duration:.01ms!important;animation-duration:.01ms!important}}",
  // 独立追加一条规则，而不是塞进上面那条既有选择器列表——那条字符串被 css.test.ts 的既有测试按
  // 精确子串匹配锁死（04 §4 铁律 1：不许为了迁就实现去改断言），追加新选择器会破坏它的匹配。
  "@media (prefers-reduced-motion:reduce){.wh-wb-mode-chip,.wh-wb-mode-lvl{transition-duration:.01ms!important;animation-duration:.01ms!important}}"
].join("");
