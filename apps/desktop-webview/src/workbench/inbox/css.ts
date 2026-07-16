// WorkHub 桌面 · 工作台「决策收件箱」中栏样式（R15 批 I1）。
// 收件箱复用 spotlight/views/attention.ts 抽出的共用渲染，它吐的是 .wh-spot-* 卡片结构。这里把这套卡片
// 家族的视觉规则「随工作台玻璃体系」重述一遍——全部走共享的 --ds-* 设计 token（工作台文档已注入
// appleGlassDesignSystemCss），所以与聚焦盒观感一致，同时又是工作台自己拥有的一份、不跨窗口 import
// 聚焦盒那份带透明窗/拖拽区全局副作用的 spotlightCss（那份含 html,body,#root/body{overflow} 全局规则，
// 灌进工作台会把整窗背景清透明+锁滚动）。所有规则用 .wh-wb-inbox 作用域前缀，绝不外溢到工作台其它区域。
export const workbenchInboxCss = [
  // 中栏容器：默认 .wh-wb-center 已给滚动 + 内边距，这里只补一列卡片的最大宽度与标题区。
  ".wh-wb-inbox{display:flex;flex-direction:column;gap:14px;max-width:720px;margin:0 auto}",
  ".wh-wb-inbox-head{display:flex;flex-direction:column;gap:3px}",
  ".wh-wb-inbox-title{margin:0;font:800 19px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-inbox-sub{margin:0;font:600 12.5px/1.4 var(--ds-font);color:var(--ds-ink-muted)}",
  // 内联提示（动作回执/错误）——工作台没有聚焦盒那种浮层 toast，这里给一条贴顶的轻提示条。
  ".wh-wb-inbox-toast{position:sticky;top:0;z-index:5;border-radius:var(--ds-radius-md);padding:9px 13px;font:600 12.5px/1.4 var(--ds-font);border:1px solid var(--ds-glass-border);background:var(--ds-glass-strong);color:var(--ds-ink-soft)}",
  ".wh-wb-inbox-toast--ok{border-color:rgba(52,199,89,.28);color:var(--ds-success)}",
  ".wh-wb-inbox-toast--error{border-color:rgba(255,69,58,.28);color:var(--ds-danger)}",
  ".wh-wb-inbox-toast[hidden]{display:none}",
  // R17-G5 #29：按 kind 筛选 chips + 批量通过控件（壳层，不进共享卡片结构）。
  ".wh-wb-inbox-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
  ".wh-wb-inbox-controls[hidden]{display:none}",
  ".wh-wb-inbox-chips{display:flex;gap:6px;flex-wrap:wrap;flex:1 1 auto;min-width:0}",
  ".wh-wb-inbox-chip{display:inline-flex;align-items:center;gap:6px;font:600 12px/1 var(--ds-font);color:var(--ds-ink-muted);" +
    "background:transparent;border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-pill);padding:6px 11px;cursor:pointer}",
  ".wh-wb-inbox-chip:hover{background:var(--ds-glass)}",
  ".wh-wb-inbox-chip--active{color:var(--ds-accent);border-color:rgba(10,132,255,.32);background:var(--ds-accent-soft)}",
  ".wh-wb-inbox-chip-n{font:700 10px/1 var(--ds-font);color:var(--ds-ink-faint);background:var(--ds-glass);border-radius:99px;min-width:16px;height:15px;padding:0 5px;display:inline-flex;align-items:center;justify-content:center}",
  ".wh-wb-inbox-chip--active .wh-wb-inbox-chip-n{color:var(--ds-accent);background:transparent}",
  ".wh-wb-inbox-batch{display:flex;align-items:center;gap:7px;flex:none}",
  ".wh-wb-inbox-batch-q{font:600 11.5px/1.3 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-inbox-batchbtn{font:700 12px/1 var(--ds-font);color:var(--ds-ink-soft);background:transparent;border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);padding:8px 13px;cursor:pointer}",
  ".wh-wb-inbox-batchbtn:hover:not(:disabled){background:var(--ds-glass-strong)}",
  ".wh-wb-inbox-batchbtn:disabled{opacity:.6;cursor:default}",
  ".wh-wb-inbox-batchbtn--go{color:#fff;border:0;background:linear-gradient(135deg,#0a84ff,#64d2ff);box-shadow:var(--ds-shadow-glow)}",
  ".wh-wb-inbox-filternote{margin:0;font:500 12.5px/1.5 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-inbox-filternote[hidden]{display:none}",
  ".wh-wb-inbox-cardhidden{display:none!important}",
  ".wh-wb-inbox-failmark{margin:9px 0 0;font:600 12px/1.5 var(--ds-font);color:var(--ds-danger);background:var(--ds-danger-soft);border-radius:var(--ds-radius-sm);padding:6px 10px}",
  // —— 决策卡家族（与聚焦盒 css.ts 同款规则，只加 .wh-wb-inbox 作用域）—— //
  ".wh-wb-inbox .wh-spot-cards{display:flex;flex-direction:column;gap:10px}",
  ".wh-wb-inbox .wh-spot-card{position:relative;display:flex;gap:0;border-radius:var(--ds-radius-lg);overflow:hidden}",
  ".wh-wb-inbox .wh-spot-card-bar{flex:0 0 4px;align-self:stretch}",
  ".wh-wb-inbox .wh-spot-card-bar--approval{background:linear-gradient(180deg,#0a84ff,#64d2ff)}",
  ".wh-wb-inbox .wh-spot-card-bar--choice{background:linear-gradient(180deg,#0a84ff,#30d158)}",
  ".wh-wb-inbox .wh-spot-card-bar--permission{background:linear-gradient(180deg,#30d158,#64d2ff)}",
  ".wh-wb-inbox .wh-spot-card-bar--handoff{background:linear-gradient(180deg,#ff453a,#ff9f0a)}",
  ".wh-wb-inbox .wh-spot-card-bar--info{background:linear-gradient(180deg,#8e8e93,#d1d1d6)}",
  ".wh-wb-inbox .wh-spot-card-main{flex:1 1 auto;min-width:0;padding:13px 15px 14px}",
  ".wh-wb-inbox .wh-spot-card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
  ".wh-wb-inbox .wh-spot-chip{font:700 11px/1 var(--ds-font);color:var(--ds-accent);background:transparent;border:1px solid rgba(10,132,255,.18);border-radius:7px;padding:4px 8px}",
  ".wh-wb-inbox .wh-spot-chip--permission{color:var(--ds-success);border-color:rgba(52,199,89,.22)}",
  ".wh-wb-inbox .wh-spot-chip--handoff{color:var(--ds-danger);border-color:rgba(255,69,58,.22)}",
  ".wh-wb-inbox .wh-spot-chip--info{color:var(--ds-ink-muted);background:transparent}",
  ".wh-wb-inbox .wh-spot-card-title{margin:10px 0 0;font:700 15px/1.4 var(--ds-font);color:var(--ds-ink);overflow-wrap:anywhere}",
  ".wh-wb-inbox .wh-spot-card-desc{margin:7px 0 0;font:500 13px/1.55 var(--ds-font);color:var(--ds-ink-soft);overflow-wrap:anywhere}",
  ".wh-wb-inbox .wh-spot-card-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}",
  ".wh-wb-inbox .wh-spot-action-note{flex:1 0 100%;margin:0;color:var(--ds-ink-muted);font:600 12px/1.4 var(--ds-font);overflow-wrap:anywhere}",
  // 动作按钮。
  ".wh-wb-inbox .wh-spot-act{border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);background:transparent;color:var(--ds-ink-soft);font:700 13px/1 var(--ds-font);padding:10px 14px;cursor:pointer;transition:transform var(--ds-dur-fast) var(--ds-spring),filter var(--ds-dur-fast) var(--ds-ease),background var(--ds-dur-fast) var(--ds-ease);will-change:transform}",
  ".wh-wb-inbox .wh-spot-act:hover{filter:brightness(1.04)}",
  ".wh-wb-inbox .wh-spot-act:active{transform:scale(.96)}",
  ".wh-wb-inbox .wh-spot-act:disabled{opacity:.6;cursor:default}",
  ".wh-wb-inbox .wh-spot-act--primary{flex:1;min-width:110px;border:0;color:#fff;background:linear-gradient(135deg,#0a84ff,#64d2ff);box-shadow:var(--ds-shadow-glow)}",
  ".wh-wb-inbox .wh-spot-act--danger{color:var(--ds-danger);border-color:var(--ds-danger-soft)}",
  ".wh-wb-inbox .wh-spot-act--quiet{background:transparent;color:var(--ds-ink-muted)}",
  // 打回理由小层。
  ".wh-wb-inbox .wh-spot-reasons{margin-top:10px;border-top:1px dashed var(--ds-glass-hairline);padding-top:11px}",
  ".wh-wb-inbox .wh-spot-reasons-q{margin:0 0 8px;font:600 12px/1 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-inbox .wh-spot-reasons-row{display:flex;gap:7px;flex-wrap:wrap;align-items:center}",
  ".wh-wb-inbox .wh-spot-reason{border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-pill);background:transparent;color:var(--ds-ink-soft);font:600 12px/1 var(--ds-font);padding:8px 12px;cursor:pointer;transition:transform var(--ds-dur-fast) var(--ds-spring),border-color var(--ds-dur-fast) var(--ds-ease),color var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-inbox .wh-spot-reason:hover{border-color:var(--ds-danger);color:var(--ds-danger)}",
  ".wh-wb-inbox .wh-spot-reason:active{transform:scale(.95)}",
  // 可编辑合并草稿 / 详情评论输入。
  ".wh-wb-inbox .wh-spot-merge-draft{width:100%;box-sizing:border-box;border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);background:var(--ds-glass-strong);color:var(--ds-ink);padding:8px 10px;font:500 13px/1.5 var(--ds-font);resize:vertical}",
  // 审批详情就地展开块。
  ".wh-wb-inbox .wh-spot-card-detail{margin-top:11px;border-top:1px dashed var(--ds-glass-hairline);padding-top:11px;display:flex;flex-direction:column;gap:2px}",
  // 冲突面板（合并冲突稀有路径）——只需容器排布，冲突卡本体走 @workhub/ui 的 wh-conflict-* 规则。
  ".wh-wb-inbox .wh-spot-dash{display:flex;flex-direction:column;gap:14px}",
  // 空 / 加载 / 错误。
  ".wh-wb-inbox .wh-spot-empty{text-align:center;padding:34px 18px}",
  ".wh-wb-inbox .wh-spot-empty-face{font:700 30px/1 var(--ds-font);color:var(--ds-accent)}",
  ".wh-wb-inbox .wh-spot-empty-title{margin:14px 0 0;font:800 18px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-inbox .wh-spot-empty-sub{margin:8px 0 0;font:500 13px/1.5 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-inbox .wh-spot-loading{display:flex;align-items:center;justify-content:center;gap:10px;padding:34px 18px;color:var(--ds-ink-muted);font:600 13px/1 var(--ds-font)}",
  ".wh-wb-inbox .wh-spot-spinner{width:16px;height:16px;border-radius:50%;border:2px solid var(--ds-accent-soft);border-top-color:var(--ds-accent);animation:wh-wb-inbox-spin .7s linear infinite}",
  "@keyframes wh-wb-inbox-spin{to{transform:rotate(360deg)}}",
  ".wh-wb-inbox .wh-spot-error{padding:24px 18px;text-align:center;color:var(--ds-ink-muted);font:500 13px/1.5 var(--ds-font)}",
  // 决策来源部分加载警告 + 冲突面板返回等复用的只读行。
  ".wh-wb-inbox .wh-spot-list{display:flex;flex-direction:column;gap:7px}",
  ".wh-wb-inbox .wh-spot-row{display:flex;align-items:center;gap:11px;border:1px solid var(--ds-glass-border);background:transparent;border-radius:var(--ds-radius-md);padding:11px 13px;color:var(--ds-ink)}",
  ".wh-wb-inbox .wh-spot-row-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}",
  ".wh-wb-inbox .wh-spot-row-title{font:600 13.5px/1.3 var(--ds-font);color:var(--ds-ink);overflow-wrap:anywhere}",
  ".wh-wb-inbox .wh-spot-row-sub{font:500 12px/1.45 var(--ds-font);color:var(--ds-ink-muted);overflow-wrap:anywhere}"
].join("");
