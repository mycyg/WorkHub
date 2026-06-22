// WorkHub 桌面 · Spotlight 盒子样式（统一玻璃风，依赖 design-system 的 --ds-* token）。
// 一个会生长的玻璃盒：顶部搜索/面包屑 + 内容区（能力网格 ↔ 能力内联页）。原生窗口随内容缩放，
// 故盒子本身不滚动到固定高——内容自然撑高，JS 测高后缩放窗口。盒外/顶栏可拖动 frameless 窗。

export const spotlightCss = [
  // 透明窗：让 OS 毛玻璃(vibrancy/acrylic)透出，盒子是唯一可见玻璃表面。
  "html,body{margin:0;background:transparent!important}",
  "body{overflow:hidden}",
  // 舞台：填满（小）窗口，盒子顶部对齐；四周留白 + 顶栏可拖动整窗。
  ".wh-spot-stage{position:relative;min-height:100vh;box-sizing:border-box;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;padding:12px;gap:0;-webkit-app-region:drag}",
  ".wh-spot{position:relative;display:flex;flex-direction:column;border-radius:var(--ds-radius-xl);overflow:hidden;-webkit-app-region:no-drag}",
  // 顶栏：搜索/标题 + 面包屑返回。顶栏空白处可拖动窗（输入/按钮 no-drag）。
  ".wh-spot-top{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--ds-glass-hairline);-webkit-app-region:drag}",
  ".wh-spot-top>*{-webkit-app-region:no-drag}",
  ".wh-spot-back{display:none;align-items:center;justify-content:center;width:30px;height:30px;flex:0 0 auto;border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-pill);background:var(--ds-glass);color:var(--ds-ink-muted);cursor:pointer}",
  ".wh-spot-back:hover{color:var(--ds-ink)}.wh-spot-back svg{width:17px;height:17px}",
  ".wh-spot[data-mode=\"capability\"] .wh-spot-back{display:inline-flex}",
  // 搜索框（launcher 屏）。
  ".wh-spot-field-wrap{display:flex;align-items:center;gap:10px;flex:1 1 auto;min-width:0}",
  ".wh-spot-field-icon{display:inline-flex;width:18px;height:18px;flex:0 0 auto;color:var(--ds-ink-muted)}.wh-spot-field-icon svg{width:18px;height:18px}",
  ".wh-spot-field{flex:1 1 auto;min-width:0;border:0;background:transparent;outline:none;font:500 16px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-spot-field::placeholder{color:var(--ds-ink-faint)}",
  // 能力标题（capability 屏）。
  ".wh-spot-titlewrap{display:none;flex-direction:column;gap:1px;min-width:0;flex:1 1 auto}",
  ".wh-spot[data-mode=\"capability\"] .wh-spot-titlewrap{display:flex}",
  ".wh-spot[data-mode=\"capability\"] .wh-spot-field-wrap{display:none}",
  ".wh-spot-title{font:650 16px/1.25 var(--ds-font);color:var(--ds-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-spot-subtitle{font:500 12px/1.2 var(--ds-font);color:var(--ds-ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-spot-kbd{margin-left:auto;flex:0 0 auto;font:700 11px/1 var(--ds-font);color:var(--ds-accent);background:var(--ds-accent-soft);border-radius:6px;padding:4px 7px}",
  ".wh-spot[data-mode=\"capability\"] .wh-spot-kbd{display:none}",
  // 内容区。
  ".wh-spot-body{padding:12px;max-height:min(560px,calc(100vh - 96px));overflow-y:auto;overscroll-behavior:contain}",
  // 能力网格（launcher）。
  ".wh-spot-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}",
  ".wh-spot-cap{display:flex;align-items:center;gap:11px;text-align:left;border:1px solid transparent;background:rgba(255,255,255,.42);border-radius:var(--ds-radius-md);padding:11px 12px;cursor:pointer;color:var(--ds-ink)}",
  ".wh-spot-cap:hover,.wh-spot-cap[data-active=\"true\"]{background:rgba(255,255,255,.72);border-color:var(--ds-glass-border)}",
  ".wh-spot-cap[data-active=\"true\"]{box-shadow:inset 0 0 0 1px var(--ds-accent-soft)}",
  ".wh-spot-cap-icon{display:inline-flex;width:24px;height:24px;flex:0 0 auto;color:var(--ds-accent)}.wh-spot-cap-icon svg{width:24px;height:24px}",
  ".wh-spot-cap-text{display:flex;flex-direction:column;gap:1px;min-width:0}",
  ".wh-spot-cap-label{font:600 13.5px/1.25 var(--ds-font);color:var(--ds-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-spot-cap-hint{font:500 11px/1.25 var(--ds-font);color:var(--ds-ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-spot-cap-badge{margin-left:auto;flex:0 0 auto;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--ds-danger);color:#fff;font:700 11px/18px var(--ds-font);text-align:center}",
  ".wh-spot-empty-grid{padding:20px 8px;text-align:center;color:var(--ds-ink-muted);font:500 13px/1.5 var(--ds-font);grid-column:1 / -1}",
  // 决策卡（审批）。
  ".wh-spot-cards{display:flex;flex-direction:column;gap:10px}",
  ".wh-spot-card{position:relative;display:flex;gap:0;border-radius:var(--ds-radius-lg);overflow:hidden}",
  ".wh-spot-card-bar{flex:0 0 4px;align-self:stretch}",
  ".wh-spot-card-bar--approval{background:linear-gradient(180deg,#7c83ff,#b57bff)}",
  ".wh-spot-card-bar--choice{background:linear-gradient(180deg,#7c83ff,#34c79a)}",
  ".wh-spot-card-bar--permission{background:linear-gradient(180deg,#34c79a,#5fd6a8)}",
  ".wh-spot-card-bar--handoff{background:linear-gradient(180deg,#ff9bb0,#b57bff)}",
  ".wh-spot-card-bar--info{background:linear-gradient(180deg,#b3abce,#c3bce0)}",
  ".wh-spot-card-main{flex:1 1 auto;min-width:0;padding:13px 15px 14px}",
  ".wh-spot-card-head{display:flex;align-items:center;gap:8px}",
  ".wh-spot-chip{font:700 11px/1 var(--ds-font);color:var(--ds-accent);background:var(--ds-accent-soft);border-radius:7px;padding:4px 8px}",
  ".wh-spot-chip--permission{color:var(--ds-success);background:var(--ds-success-soft)}",
  ".wh-spot-chip--handoff{color:var(--ds-danger);background:var(--ds-danger-soft)}",
  ".wh-spot-chip--info{color:var(--ds-ink-muted);background:rgba(255,255,255,.6)}",
  ".wh-spot-card-title{margin:10px 0 0;font:700 15px/1.4 var(--ds-font);color:var(--ds-ink);overflow-wrap:anywhere}",
  ".wh-spot-card-desc{margin:7px 0 0;font:500 13px/1.55 var(--ds-font);color:var(--ds-ink-soft);overflow-wrap:anywhere}",
  ".wh-spot-card-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}",
  ".wh-spot-act{border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);background:rgba(255,255,255,.55);color:var(--ds-ink-soft);font:700 13px/1 var(--ds-font);padding:10px 14px;cursor:pointer}",
  ".wh-spot-act--primary{flex:1;min-width:110px;border:0;color:#fff;background:linear-gradient(135deg,#7c83ff,#b57bff);box-shadow:var(--ds-shadow-glow)}",
  ".wh-spot-act--danger{color:var(--ds-danger);border-color:var(--ds-danger-soft)}",
  ".wh-spot-act--quiet{background:rgba(255,255,255,.4);color:var(--ds-ink-muted)}",
  // 打回理由小层。
  ".wh-spot-reasons{margin-top:10px;border-top:1px dashed var(--ds-glass-hairline);padding-top:11px}",
  ".wh-spot-reasons-q{margin:0 0 8px;font:600 12px/1 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-spot-reasons-row{display:flex;gap:7px;flex-wrap:wrap}",
  ".wh-spot-reason{border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-pill);background:rgba(255,255,255,.55);color:var(--ds-ink-soft);font:600 12px/1 var(--ds-font);padding:8px 12px;cursor:pointer}",
  ".wh-spot-reason:hover{border-color:var(--ds-danger);color:var(--ds-danger)}",
  // 空/加载/错误/占位。
  ".wh-spot-empty{text-align:center;padding:34px 18px}",
  ".wh-spot-empty-face{font:700 30px/1 var(--ds-font);color:var(--ds-accent)}",
  ".wh-spot-empty-title{margin:14px 0 0;font:800 18px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-spot-empty-sub{margin:8px 0 0;font:500 13px/1.5 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-spot-loading{display:flex;align-items:center;justify-content:center;gap:10px;padding:34px 18px;color:var(--ds-ink-muted);font:600 13px/1 var(--ds-font)}",
  ".wh-spot-spinner{width:16px;height:16px;border-radius:50%;border:2px solid var(--ds-accent-soft);border-top-color:var(--ds-accent);animation:ds-spin .7s linear infinite}",
  "@keyframes ds-spin{to{transform:rotate(360deg)}}",
  ".wh-spot-error{padding:24px 18px;text-align:center;color:var(--ds-ink-muted);font:500 13px/1.5 var(--ds-font)}",
  ".wh-spot-placeholder{text-align:center;padding:30px 20px}",
  ".wh-spot-placeholder-icon{display:inline-flex;width:38px;height:38px;color:var(--ds-accent)}.wh-spot-placeholder-icon svg{width:38px;height:38px}",
  ".wh-spot-placeholder-title{margin:12px 0 0;font:800 18px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-spot-placeholder-sub{margin:6px 0 0;font:500 13px/1.5 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-spot-placeholder-note{margin:14px 0 0;font:500 12.5px/1.6 var(--ds-font);color:var(--ds-ink-faint)}",
  // 内联轻提示。
  ".wh-spot-toast{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);max-width:calc(100% - 28px);z-index:5;display:flex;align-items:center;gap:8px;border-radius:var(--ds-radius-pill);padding:9px 15px;font:600 12.5px/1.3 var(--ds-font);color:#fff;background:rgba(40,32,70,.92);box-shadow:var(--ds-shadow-2);animation:ds-pop var(--ds-dur) var(--ds-spring) both;-webkit-app-region:no-drag}",
  ".wh-spot-toast--ok{background:linear-gradient(135deg,#1faf86,#34c79a)}",
  ".wh-spot-toast--error{background:linear-gradient(135deg,#e85d70,#ff9bb0)}"
].join("");
