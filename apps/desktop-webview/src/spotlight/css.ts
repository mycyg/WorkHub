// WorkHub 桌面 · Spotlight 盒子样式（统一玻璃风，依赖 design-system 的 --ds-* token）。
// 一个会生长的玻璃盒：顶部搜索/面包屑 + 内容区（能力网格 ↔ 能力内联页）。原生窗口随内容缩放，
// 故盒子本身不滚动到固定高——内容自然撑高，JS 测高后缩放窗口。盒外/顶栏可拖动 frameless 窗。

import { liquidGlassFilterCss } from "../liquid-glass-filter.js";

export const spotlightCss = [
  liquidGlassFilterCss,
  // 透明窗：webview 背景清零，让 Rust 侧 apply_vibrancy 贴的原生材质（main.rs，R14 起为
  // UnderWindowBackground）透出来；盒子自己的 SVG displacement + backdrop/filter 层叠在原生材质之上。
  "html,body,#root{margin:0;background:rgba(0,0,0,0)!important}",
  "html,body,#root{width:100%;height:100%}",
  "body{overflow:hidden}",
  // 舞台：填满（小）窗口，盒子顶部对齐；四周留白 + 顶栏可拖动整窗。
  // 盒子直接铺满透明窗(padding:0)，由自身圆角/边缘折射收边，不再留 12px 的方角玻璃"垫边"。
  ".wh-spot-stage{position:relative;min-height:100vh;box-sizing:border-box;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;padding:0;gap:0;-webkit-app-region:no-drag}",
  // 盒子=真·液态玻璃：半透白渐变 + backdrop blur（窗后有原生 vibrancy，可压低不透明度让磨砂桌面透出来），
  // 配亮玻璃描边 + 顶部内高光；柔投影交给原生 NSWindow shadow（见下方 R13 V2 注释），CSS 不再自画。
  // 和 Cuu 气泡(.wh-pet-bubble)同一套玻璃语言，只是盒子更通透（它有 vibrancy 兜底）。
  // R14 真机反馈：肉眼看太透（背景穿透强，screencapture 截不出这个差异——vibrancy 是原生合成，截图工具本就看不到，
  // 只有肉眼能看出真实观感）。把底色从 .52/.36 提到 .78/.6，内容在原生 vibrancy 模糊之上更立得住，不靠肉眼碰运气。
  // R13 V2（工作台窗同款玻璃盒踩过的坑，见 r13-v2-window-craft.md）：外层 box-shadow 是矩形投影，会画到原生裁剪出的
  // 圆角外面，在真机截图上留下一截直角残影（用户描述"上面圆角正常，下面有一个直角阴影边缘"就是这个）。阴影交给原生
  // NSWindow 的 shadow（tauri.conf.json 主窗 `shadow:true`），这里只留顶部内高光（inset，天然被圆角裁得干净）。
  ".wh-spot{position:relative;display:flex;flex-direction:column;border-radius:var(--ds-radius-xl);overflow:hidden;-webkit-app-region:no-drag;background:linear-gradient(135deg,rgba(255,255,255,.78),rgba(255,255,255,.6));border:1px solid rgba(255,255,255,.7);box-shadow:inset 0 1px 0 rgba(255,255,255,.75);backdrop-filter:blur(40px) saturate(185%);-webkit-backdrop-filter:blur(40px) saturate(185%)}",
  ".wh-spot>.wh-liquid-glass-content{display:flex;flex-direction:column;min-width:0;min-height:0}",
  // 真毛玻璃由盒子的 ds-glass-strong 工具类(半透白底 + backdrop blur)+ 原生 vibrancy 提供；
  // 关掉冗余的 SVG warp/haze 折射层与 rim 描边——rim 的 1px 边叠在盒 border 上正是搜索条上那"两道横杠"，
  // 且 haze 的 44% 白幕会把已磨砂的盒子糊成奶白。内容层(wh-liquid-glass-content, z2)照常显示。
  ".wh-spot>.wh-liquid-glass-warp,.wh-spot>.wh-liquid-glass-rim{display:none}",
  // 收起态(未点击)：只露搜索框,隐藏能力网格区与其下边线,盒子缩成一条搜索条。
  // SM-1：限定到 launcher 模式——收起态只属于「idle 细搜索条」；能力态(data-mode=capability)绝不应被
  // collapsed 隐藏内容,即使 dataset 残留 collapsed=true 也不藏(与 controller 显式复位互为兜底)。
  ".wh-spot[data-mode=\"launcher\"][data-collapsed=\"true\"] .wh-spot-body{display:none}",
  ".wh-spot[data-mode=\"launcher\"][data-collapsed=\"true\"] .wh-spot-top{border-bottom:0}",
  ".wh-spot[data-mode=\"launcher\"][data-collapsed=\"true\"]{height:auto;min-height:0}",
  // 顶栏：搜索/标题 + 面包屑返回。搜索条本身也是原生 drag region；只有真实按钮/表单控件退出拖动。
  ".wh-spot-top{position:relative;display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--ds-glass-hairline);-webkit-app-region:no-drag;cursor:grab}",
  ".wh-spot-top:active{cursor:grabbing}",
  ".wh-spot-back,.wh-spot button,.wh-spot a,.wh-spot select,.wh-spot textarea,.wh-spot [contenteditable=true]{-webkit-app-region:no-drag}",
  ".wh-spot-drag-sheet{position:absolute;inset:0;display:none;z-index:3;border:0;background:transparent;cursor:grab;padding:0;-webkit-app-region:no-drag}",
  ".wh-spot[data-mode=\"launcher\"][data-collapsed=\"true\"] .wh-spot-drag-sheet{display:block}",
  ".wh-spot-drag-sheet:active{cursor:grabbing}",
  ".wh-spot-back{display:none;align-items:center;justify-content:center;width:30px;height:30px;flex:0 0 auto;border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-pill);background:transparent;color:var(--ds-ink-muted);cursor:pointer;transition:transform var(--ds-dur-fast) var(--ds-spring),color var(--ds-dur-fast) var(--ds-ease),background var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-spot-back:hover{color:var(--ds-ink);background:transparent}.wh-spot-back:active{transform:scale(.9)}.wh-spot-back svg{width:17px;height:17px}",
  ".wh-spot[data-mode=\"capability\"] .wh-spot-back{display:inline-flex}",
  // 搜索框（launcher 屏）。
  ".wh-spot-field-wrap{display:flex;align-items:center;gap:10px;flex:1 1 auto;min-width:0}",
  ".wh-spot-field-icon{display:inline-flex;width:18px;height:18px;flex:0 0 auto;color:var(--ds-ink-muted)}.wh-spot-field-icon svg{width:18px;height:18px}",
  ".wh-spot-field{flex:1 1 auto;min-width:0;border:0;background:transparent;outline:none;box-shadow:none;-webkit-appearance:none;appearance:none;font:500 16px/1.3 var(--ds-font);color:var(--ds-ink)}",
  "input.wh-spot-field:focus{outline:0!important;box-shadow:none!important}",
  // UX-M6：sync_conflict 卡的合并草稿编辑框（桌面玻璃上要实底可读，禁 transparent+backdrop-filter）。
  ".wh-spot-merge-draft{width:100%;box-sizing:border-box;border:1px solid rgba(60,60,67,.18);border-radius:10px;background:rgba(255,255,255,.92);color:#1a1d26;padding:8px 10px;font:600 12.5px/1.5 \"Aptos\",\"Segoe UI\",\"Microsoft YaHei\",\"PingFang SC\",sans-serif;resize:vertical}",
  ".wh-spot-field::placeholder{color:var(--ds-ink-faint)}",
  // 能力标题（capability 屏）。
  ".wh-spot-titlewrap{display:none;flex-direction:column;gap:1px;min-width:0;flex:1 1 auto}",
  ".wh-spot[data-mode=\"capability\"] .wh-spot-titlewrap{display:flex}",
  ".wh-spot[data-mode=\"capability\"] .wh-spot-field-wrap{display:none}",
  ".wh-spot-title{font:650 16px/1.25 var(--ds-font);color:var(--ds-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-spot-subtitle{font:500 12px/1.2 var(--ds-font);color:var(--ds-ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-spot-kbd{margin-left:auto;flex:0 0 auto;font:700 11px/1 var(--ds-font);color:var(--ds-accent);background:transparent;border:1px solid rgba(10,132,255,.18);border-radius:6px;padding:4px 7px}",
  ".wh-spot[data-mode=\"capability\"] .wh-spot-kbd{display:none}",
  // 内容区。
  ".wh-spot-body{padding:12px;max-height:min(560px,calc(100vh - 96px));overflow-y:auto;overscroll-behavior:contain}",
  // 能力网格（launcher）。
  ".wh-spot-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}",
  ".wh-spot-cap{display:flex;align-items:center;gap:11px;text-align:left;border:1px solid transparent;background:transparent;border-radius:var(--ds-radius-md);padding:11px 12px;cursor:pointer;color:var(--ds-ink);transition:transform var(--ds-dur-fast) var(--ds-ease-out),background var(--ds-dur-fast) var(--ds-ease),border-color var(--ds-dur-fast) var(--ds-ease),box-shadow var(--ds-dur-fast) var(--ds-ease);will-change:transform}",
  ".wh-spot-cap:hover{background:transparent;border-color:rgba(255,255,255,.32)}",
  ".wh-spot-cap:hover{transform:translateY(-1px);box-shadow:var(--ds-shadow-1)}",
  ".wh-spot-cap:active{transform:translateY(0) scale(.975)}",
  ".wh-spot[data-mode=\"launcher\"] .wh-spot-cap{background:transparent;border-color:rgba(255,255,255,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.22)}",
  ".wh-spot[data-mode=\"launcher\"] .wh-spot-cap:hover{background:transparent;border-color:rgba(255,255,255,.32);box-shadow:0 12px 30px -22px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.34)}",
  // L5：默认高亮(首项 data-active)只在键盘导航(box[data-kbd])下才显 accent 环+底色——否则鼠标打开时首卡
  // 永远顶着选中环、再 hover 另一张就「两张都像被选中」,读起来像卡死的 hover。鼠标模式下只有 :hover 高亮。
  ".wh-spot[data-kbd=\"true\"] .wh-spot-cap[data-active=\"true\"]{background:transparent;border-color:rgba(10,132,255,.36);box-shadow:inset 0 0 0 2px var(--ds-accent)}",
  // rank17：键盘用户可见焦点环——Tab/聚焦任意盒内可交互元素都给清晰的 accent outline(鼠标点击不触发)。
  "html:focus,body:focus,#root:focus,.wh-spot-stage:focus,.wh-spot:focus,.wh-spot-body:focus{outline:none!important}",
  ".wh-spot,.wh-spot-body,[data-spot-box],[data-spot-body]{outline:none!important}",
  ".wh-spot *:focus{outline:none}",
  ".wh-spot *:focus:not(:focus-visible){outline:none}",
  ".wh-spot :where(button,a,input,textarea,select,[role=\"option\"]):focus-visible{outline:2px solid var(--ds-accent);outline-offset:2px;border-radius:var(--ds-radius-sm)}",
  ".wh-spot-cap-icon{display:inline-flex;width:24px;height:24px;flex:0 0 auto;color:var(--ds-accent)}.wh-spot-cap-icon svg{width:24px;height:24px}",
  ".wh-spot-cap-text{display:flex;flex-direction:column;gap:1px;min-width:0}",
  ".wh-spot-cap-label{font:600 13.5px/1.25 var(--ds-font);color:var(--ds-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-spot-cap-hint{font:500 11px/1.25 var(--ds-font);color:var(--ds-ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-spot-cap-badge{margin-left:auto;flex:0 0 auto;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--ds-danger);color:#fff;font:700 11px/18px var(--ds-font);text-align:center}",
  ".wh-spot-empty-grid{padding:20px 8px;text-align:center;color:var(--ds-ink-muted);font:500 13px/1.5 var(--ds-font);grid-column:1 / -1}",
  ".wh-spot-hello{padding:0 2px 11px;font:500 12.5px/1.5 var(--ds-font);color:var(--ds-ink-muted);text-align:center}",
  // 决策卡（审批）。
  ".wh-spot-cards{display:flex;flex-direction:column;gap:10px}",
  ".wh-spot-card{position:relative;display:flex;gap:0;border-radius:var(--ds-radius-lg);overflow:hidden}",
  ".wh-spot-card-bar{flex:0 0 4px;align-self:stretch}",
  ".wh-spot-card-bar--approval{background:linear-gradient(180deg,#0a84ff,#64d2ff)}",
  ".wh-spot-card-bar--choice{background:linear-gradient(180deg,#0a84ff,#30d158)}",
  ".wh-spot-card-bar--permission{background:linear-gradient(180deg,#30d158,#64d2ff)}",
  ".wh-spot-card-bar--handoff{background:linear-gradient(180deg,#ff453a,#ff9f0a)}",
  ".wh-spot-card-bar--info{background:linear-gradient(180deg,#8e8e93,#d1d1d6)}",
  ".wh-spot-card-main{flex:1 1 auto;min-width:0;padding:13px 15px 14px}",
  ".wh-spot-card-head{display:flex;align-items:center;gap:8px}",
  ".wh-spot-chip{font:700 11px/1 var(--ds-font);color:var(--ds-accent);background:transparent;border:1px solid rgba(10,132,255,.18);border-radius:7px;padding:4px 8px}",
  ".wh-spot-chip--permission{color:var(--ds-success);border-color:rgba(52,199,89,.22)}",
  ".wh-spot-chip--handoff{color:var(--ds-danger);border-color:rgba(255,69,58,.22)}",
  ".wh-spot-chip--info{color:var(--ds-ink-muted);background:transparent}",
  ".wh-spot-card-title{margin:10px 0 0;font:700 15px/1.4 var(--ds-font);color:var(--ds-ink);overflow-wrap:anywhere}",
  ".wh-spot-card-desc{margin:7px 0 0;font:500 13px/1.55 var(--ds-font);color:var(--ds-ink-soft);overflow-wrap:anywhere}",
  ".wh-spot-card-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}",
  ".wh-spot-action-note{flex:1 0 100%;margin:0;color:var(--ds-ink-muted);font:600 12px/1.4 var(--ds-font);overflow-wrap:anywhere}",
  ".wh-spot-act{border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);background:transparent;color:var(--ds-ink-soft);font:700 13px/1 var(--ds-font);padding:10px 14px;cursor:pointer;transition:transform var(--ds-dur-fast) var(--ds-spring),filter var(--ds-dur-fast) var(--ds-ease),background var(--ds-dur-fast) var(--ds-ease);will-change:transform}",
  ".wh-spot-upload-label{position:relative;display:inline-flex;align-items:center;justify-content:center}.wh-spot-file-input{position:absolute;inline-size:1px;block-size:1px;opacity:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}",
  ".wh-spot-act:hover{filter:brightness(1.04)}",
  ".wh-spot-act:active{transform:scale(.96)}",
  ".wh-spot-act--primary{flex:1;min-width:110px;border:0;color:#fff;background:linear-gradient(135deg,#0a84ff,#64d2ff);box-shadow:var(--ds-shadow-glow)}",
  ".wh-spot-act--danger{color:var(--ds-danger);border-color:var(--ds-danger-soft)}",
  // F-06：回放快照区「撤销此次改动」按钮的二次确认武装态/处理中态——同 .wh-spot-reason[data-sel] 的
  // 「选中即加重警示色」语言，[aria-disabled] 覆盖 binder 用在 <button> 上的禁用标记（不是原生 disabled）。
  ".wh-spot-act--danger[data-replay-revert-armed=\"true\"]{border-color:var(--ds-danger);color:#fff;background:var(--ds-danger)}",
  ".wh-spot-act--danger[aria-disabled=\"true\"]{opacity:.6;pointer-events:none}",
  ".wh-spot-act--quiet{background:transparent;color:var(--ds-ink-muted)}",
  // 打回理由小层。
  ".wh-spot-reasons{margin-top:10px;border-top:1px dashed var(--ds-glass-hairline);padding-top:11px}",
  ".wh-spot-reasons-q{margin:0 0 8px;font:600 12px/1 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-spot-reasons-row{display:flex;gap:7px;flex-wrap:wrap}",
  ".wh-spot-reason{border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-pill);background:transparent;color:var(--ds-ink-soft);font:600 12px/1 var(--ds-font);padding:8px 12px;cursor:pointer;transition:transform var(--ds-dur-fast) var(--ds-spring),border-color var(--ds-dur-fast) var(--ds-ease),color var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-spot-reason[data-sel=\"true\"]{border-color:var(--ds-danger);color:var(--ds-danger);background:transparent;box-shadow:inset 0 0 0 1px rgba(255,69,58,.22)}",
  ".wh-spot-reason:hover{border-color:var(--ds-danger);color:var(--ds-danger)}.wh-spot-reason:active{transform:scale(.95)}",
  ".wh-spot-reason-text{box-sizing:border-box;width:100%;min-height:72px;margin-top:10px;resize:vertical;border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);background:transparent;color:var(--ds-ink);font:500 13px/1.5 var(--ds-font);padding:10px 12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.34)}",
  ".wh-spot-reason-text::placeholder{color:var(--ds-ink-faint)}.wh-spot-reason-text:focus{outline:none;border-color:var(--ds-danger);box-shadow:0 0 0 3px var(--ds-danger-soft),inset 0 1px 0 rgba(255,255,255,.65)}",
  ".wh-spot-reason-actions{display:flex;justify-content:flex-end;margin-top:9px}",
  // R23 F-04：转交选人层里的成员下拉（与打回理由的文本框同款玻璃字段样式，只是换成 select）。
  ".wh-spot-delegate-select{box-sizing:border-box;width:100%;margin-bottom:9px;border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);background:transparent;color:var(--ds-ink);font:600 12.5px/1.5 var(--ds-font);padding:9px 11px}",
  ".wh-spot-delegate-select:focus{outline:none;border-color:var(--ds-accent);box-shadow:0 0 0 3px rgba(10,132,255,.18)}",
  // R23 F-04：外部入口（桌宠「转交他人」）指名进来的那张卡——一圈强调色描边，让人一眼认出是哪条。
  ".wh-spot-card[data-att-focus=\"true\"]{box-shadow:inset 0 0 0 2px var(--ds-accent),0 16px 34px rgba(10,132,255,.14)}",
  // 空/加载/错误/占位。
  ".wh-spot-empty{text-align:center;padding:34px 18px}",
  ".wh-spot-empty-face{font:700 30px/1 var(--ds-font);color:var(--ds-accent)}",
  // L-01（R24 S3 走查）：空态"脸"此前部分用 emoji（drive/notifications/team/knowledge 等）——
  // 换成内联 SVG 后，用 currentColor 继承 .wh-spot-empty-face 的强调色；尺寸单独钳制
  // （父级 font-size 是给文字排版用的，SVG 不会跟着字号走）。
  ".wh-spot-empty-face svg{width:32px;height:32px;vertical-align:middle}",
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
  // 派活 / 澄清问答（intake）。
  ".wh-spot-intake{display:flex;flex-direction:column;gap:12px}",
  ".wh-spot-steps{display:flex;flex-wrap:wrap;gap:8px}",
  ".wh-spot-step{display:inline-flex;align-items:center;gap:6px;font:600 11.5px/1 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-spot-step-dot{width:7px;height:7px;border-radius:50%;background:var(--ds-glass-border);box-shadow:inset 0 0 0 1px var(--ds-glass-hairline)}",
  ".wh-spot-step--active{color:var(--ds-accent)}.wh-spot-step--active .wh-spot-step-dot{background:var(--ds-accent);box-shadow:0 0 0 3px var(--ds-accent-soft)}",
  ".wh-spot-step--done{color:var(--ds-success)}.wh-spot-step--done .wh-spot-step-dot{background:var(--ds-success)}",
  ".wh-spot-intake-title{margin:0;font:700 17px/1.4 var(--ds-font);color:var(--ds-ink);overflow-wrap:anywhere}",
  ".wh-spot-intake-body{margin:0;font:500 13px/1.6 var(--ds-font);color:var(--ds-ink-soft);overflow-wrap:anywhere}",
  ".wh-spot-opts{display:flex;flex-direction:column;gap:8px}",
  ".wh-spot-opt{display:flex;align-items:flex-start;gap:11px;text-align:left;border:1px solid var(--ds-glass-border);background:transparent;border-radius:var(--ds-radius-md);padding:12px 13px;cursor:pointer;color:var(--ds-ink);transition:transform var(--ds-dur-fast) var(--ds-ease-out),background var(--ds-dur-fast) var(--ds-ease),border-color var(--ds-dur-fast) var(--ds-ease),box-shadow var(--ds-dur-fast) var(--ds-ease);will-change:transform}",
  ".wh-spot-opt:hover{background:transparent;transform:translateY(-1px);box-shadow:var(--ds-shadow-1)}",
  ".wh-spot-opt:active{transform:translateY(0) scale(.985)}",
  ".wh-spot-opt[data-sel=\"true\"]{border-color:var(--ds-accent);background:transparent;box-shadow:inset 0 0 0 1px rgba(10,132,255,.18)}",
  ".wh-spot-opt-check{flex:0 0 auto;width:18px;height:18px;margin-top:1px;border-radius:50%;border:2px solid var(--ds-glass-border);transition:all var(--ds-dur-fast)}",
  ".wh-spot-opt[data-sel=\"true\"] .wh-spot-opt-check{border-color:var(--ds-accent);background:var(--ds-accent);box-shadow:inset 0 0 0 3px #fff}",
  ".wh-spot-opt-text{display:flex;flex-direction:column;gap:3px;min-width:0}",
  ".wh-spot-opt-label{display:flex;align-items:center;gap:8px;font:600 13.5px/1.35 var(--ds-font);color:var(--ds-ink);flex-wrap:wrap}",
  ".wh-spot-opt-tag{font:700 10px/1 var(--ds-font);color:var(--ds-accent);background:transparent;border:1px solid rgba(10,132,255,.18);border-radius:6px;padding:3px 6px}",
  ".wh-spot-opt-desc{font:500 12px/1.5 var(--ds-font);color:var(--ds-ink-muted);overflow-wrap:anywhere}",
  ".wh-spot-freetext{width:100%;box-sizing:border-box;min-height:64px;resize:vertical;border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);background:transparent;color:var(--ds-ink);font:500 13.5px/1.5 var(--ds-font);padding:11px 13px}",
  ".wh-spot-freetext:focus{outline:none;border-color:var(--ds-accent);box-shadow:0 0 0 3px var(--ds-accent-soft)}",
  // R13 批 A2（派人推荐 v2）：单行变体——复用 .wh-spot-freetext 的边框/字体，去掉 textarea 专属的
  // min-height/resize，给「我的资料」区的职位头衔/技能标签这类单行输入用。
  ".wh-spot-freetext--line{min-height:0;resize:none}",
  ".wh-spot-intake-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:2px}",
  ".wh-spot-act:disabled{opacity:.6;cursor:default}",
  // 只读/检索类（项目·成本·日历·知识）。
  ".wh-spot-list{display:flex;flex-direction:column;gap:7px}",
  ".wh-spot-row{display:flex;align-items:center;gap:11px;text-decoration:none;border:1px solid var(--ds-glass-border);background:transparent;border-radius:var(--ds-radius-md);padding:11px 13px;color:var(--ds-ink)}",
  // M12/M16：可点的行（不止 <a>，也含 <button> 列表/项目/文件行）都要有玻璃悬浮 + 按压反馈，苹果级触感。
  "button.wh-spot-row{cursor:pointer;width:100%;text-align:left;font:inherit}",
  "a.wh-spot-row,button.wh-spot-row{transition:transform var(--ds-dur-fast) var(--ds-ease-out),background var(--ds-dur-fast) var(--ds-ease),box-shadow var(--ds-dur-fast) var(--ds-ease);will-change:transform}",
  "a.wh-spot-row:hover,button.wh-spot-row:hover{background:transparent;transform:translateY(-1px);box-shadow:var(--ds-shadow-1)}",
  "a.wh-spot-row:active,button.wh-spot-row:active{transform:translateY(0) scale(.985)}",
  ".wh-spot-row-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}",
  ".wh-spot-row-title{display:flex;align-items:center;gap:8px;font:600 13.5px/1.3 var(--ds-font);color:var(--ds-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-spot-row-sub{font:500 12px/1.45 var(--ds-font);color:var(--ds-ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  // L-04（R24 S3 走查）：.wh-spot-row-sub 默认单行截断——适合真正的"行副标题"，但被借去放多句
  // 说明文字（如设备列表的解释段）时，长句会被 nowrap+ellipsis 掐成一行省略号。这个修饰类让文字
  // 正常换行，专给"说明段"用；短行副标题继续用不带这个类的默认单行截断。
  ".wh-spot-row-sub--wrap{overflow:visible;text-overflow:clip;white-space:normal;overflow-wrap:anywhere}",
  // M-06：设置页「查看部署说明」这类行内文字链接——之前没有通用的内联链接样式。
  ".wh-spot-inline-link{color:var(--ds-accent);font-weight:600;text-decoration:underline;cursor:pointer;background:none;border:none;padding:0;font-size:inherit;font-family:inherit}",
  ".wh-spot-row-tag{font:700 10px/1 var(--ds-font);color:var(--ds-ink-muted);background:transparent;border-radius:6px;padding:3px 6px}",
  ".wh-spot-row[data-drive-item-selected=true]{border-color:rgba(10,132,255,.42);background:transparent;box-shadow:inset 3px 0 0 var(--ds-accent),0 14px 30px rgba(10,132,255,.12)}",
  ".wh-spot-row-current{flex:0 0 auto;font:800 10px/1 var(--ds-font);letter-spacing:0;color:var(--ds-accent);background:transparent;border:1px solid rgba(10,132,255,.22);border-radius:999px;padding:5px 7px}",
  ".wh-spot-row-meta{flex:0 0 auto;display:flex;align-items:center;gap:6px;font:700 13px/1 var(--ds-font);color:var(--ds-ink-soft)}",
  ".wh-spot-row-metalabel{font:600 11px/1 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-spot-row-badge{min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--ds-accent);color:#fff;font:700 11px/18px var(--ds-font);text-align:center}",
  ".wh-spot-conf{width:7px;height:7px;border-radius:50%;flex:0 0 auto}",
  ".wh-spot-conf--ok{background:var(--ds-success)}.wh-spot-conf--warn{background:var(--ds-warn)}.wh-spot-conf--muted{background:var(--ds-ink-faint)}",
  ".wh-spot-dash{display:flex;flex-direction:column;gap:14px}",
  ".wh-spot-metrics{display:flex;flex-wrap:wrap;gap:10px}",
  ".wh-spot-metric{flex:1 1 100px;border:1px solid var(--ds-glass-border);background:transparent;border-radius:var(--ds-radius-md);padding:11px 13px;display:flex;flex-direction:column;gap:4px}",
  ".wh-spot-metric-k{font:600 11px/1 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-spot-metric-v{font:800 16px/1 var(--ds-font);color:var(--ds-ink)}",
  ".wh-spot-metric-v--big{font-size:22px;color:var(--ds-accent)}",
  ".wh-spot-bars{display:flex;align-items:flex-end;gap:4px;height:48px;padding:4px 2px;border-radius:var(--ds-radius-md);background:transparent}",
  ".wh-spot-bar{flex:1 1 auto;min-width:3px;border-radius:3px 3px 0 0;background:linear-gradient(180deg,#0a84ff,#64d2ff)}",
  // L16：成本柱组下的可见说明(起–止日期 · 峰值),把数据从只在 title tooltip 里搬到可见+可读屏。
  ".wh-spot-bars-cap{display:flex;justify-content:space-between;gap:8px;margin-top:5px;font:600 11px/1 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-spot-bubble{display:flex;flex-direction:column;gap:12px}",
  ".wh-spot-bubble-summary{margin:0;font:500 14px/1.6 var(--ds-font);color:var(--ds-ink);overflow-wrap:anywhere}",
  ".wh-spot-bubble-note{margin:0;font:500 12px/1.5 var(--ds-font);color:var(--ds-warn)}",
  ".wh-spot-know{display:flex;flex-direction:column;gap:12px}",
  ".wh-spot-know-bar{display:flex;gap:8px;align-items:center}",
  ".wh-spot-know-bar .wh-spot-freetext{flex:1 1 auto}",
  ".wh-spot-know-projects{display:flex;flex-wrap:wrap;gap:7px}",
  ".wh-spot-know-projects .wh-spot-reason[data-sel=\"true\"]{border-color:var(--ds-accent);color:var(--ds-accent);background:transparent;box-shadow:inset 0 0 0 1px rgba(10,132,255,.18)}",
  // R14 批 SEARCH：全局搜索——按 scope 分组的结果区 + 键盘上下移动的高亮行（与 drive 已选中项同一套
  // accent 描边语言）+ snippet 里的命中词高亮（<mark>，用 accent-soft 底色而非刺眼黄，贴合玻璃配色）。
  ".wh-spot-search-groups{display:flex;flex-direction:column;gap:14px}",
  ".wh-spot-row[data-search-active=\"true\"]{border-color:rgba(10,132,255,.42);background:transparent;box-shadow:inset 3px 0 0 var(--ds-accent),0 14px 30px rgba(10,132,255,.12)}",
  ".wh-spot-row-sub mark{background:var(--ds-accent-soft);color:inherit;border-radius:3px;padding:0 1px}",
  // 网盘 / 回放。
  ".wh-spot-file-icon{display:inline-flex;width:22px;height:22px;flex:0 0 auto;color:var(--ds-accent)}.wh-spot-file-icon svg{width:22px;height:22px}",
  ".wh-spot-drive-section{margin-top:6px}",
  ".wh-spot-drive-preview-text{white-space:pre-wrap;max-height:260px;overflow:auto;margin:10px 0 0;padding:12px;border-radius:14px;background:transparent;border:1px solid rgba(255,255,255,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.24);color:var(--ds-ink-muted);font:500 12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}",
  ".wh-spot-run-dot{flex:0 0 auto;width:9px;height:9px;border-radius:50%;background:var(--ds-ink-faint)}",
  ".wh-spot-run-dot--running{background:var(--ds-success);box-shadow:0 0 0 3px var(--ds-success-soft);animation:ds-float 1.6s var(--ds-ease) infinite}",
  ".wh-spot-run-dot--queued{background:var(--ds-info)}",
  ".wh-spot-run-dot--waiting_for_user{background:var(--ds-warn);box-shadow:0 0 0 3px var(--ds-warn-soft)}",
  ".wh-spot-run-dot--failed{background:var(--ds-danger)}",
  ".wh-spot-trace{display:flex;flex-direction:column;gap:0;border-left:2px solid var(--ds-glass-border);padding-left:14px;margin-left:6px}",
  ".wh-spot-trace-step{position:relative;padding:8px 0}",
  ".wh-spot-trace-step::before{content:\"\";position:absolute;left:-19px;top:12px;width:8px;height:8px;border-radius:50%;background:var(--ds-accent)}",
  ".wh-spot-trace-phase{font:700 12.5px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-spot-trace-out{margin-top:3px;font:500 12px/1.5 var(--ds-font);color:var(--ds-ink-muted);overflow-wrap:anywhere;white-space:pre-wrap}",
  // 看改动 diff。
  ".wh-spot-changes{display:flex;flex-direction:column;gap:10px}",
  ".wh-spot-change{border:1px solid var(--ds-glass-border);background:transparent;border-radius:var(--ds-radius-md);padding:11px 13px}",
  ".wh-spot-change-head{display:flex;align-items:center;gap:8px}",
  ".wh-spot-change-path{font:600 12px/1.3 var(--ds-font);color:var(--ds-ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-spot-change-sum{margin-top:7px;font:500 13px/1.5 var(--ds-font);color:var(--ds-ink-soft);overflow-wrap:anywhere}",
  ".wh-spot-diff{margin-top:9px;border-radius:var(--ds-radius-sm);overflow:hidden;font:500 11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}",
  ".wh-spot-diff-line{padding:5px 9px;overflow-wrap:anywhere;white-space:pre-wrap}",
  ".wh-spot-diff-line--del{background:rgba(232,93,112,.12);color:#b3354a}",
  ".wh-spot-diff-line--add{background:rgba(31,175,134,.13);color:#137a5c}",
  ".wh-spot-checks{display:flex;flex-wrap:wrap;gap:7px}",
  ".wh-spot-check{font:600 11.5px/1 var(--ds-font);border:1px solid var(--ds-glass-border);border-radius:7px;padding:5px 9px;background:transparent;color:var(--ds-ink-muted)}",
  ".wh-spot-check--passed{background:transparent;border-color:rgba(52,199,89,.22);color:var(--ds-success)}",
  ".wh-spot-check--failed{background:transparent;border-color:rgba(255,69,58,.24);color:var(--ds-danger)}",
  ".wh-spot-check--warning{background:transparent;border-color:rgba(255,159,10,.24);color:var(--ds-warn)}",
  ".wh-spot-check--skipped{background:transparent;border-color:rgba(142,142,147,.18);color:var(--ds-ink-muted)}",
  ".wh-spot .wh-conflict-list{display:flex;flex-direction:column;gap:10px;margin:0;min-width:0}",
  ".wh-spot .wh-conflict-head,.wh-spot .wh-conflict-card,.wh-spot .wh-conflict-workbench{border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);background:transparent;padding:12px 13px}",
  ".wh-spot .wh-conflict-head{background:transparent;border-color:rgba(255,69,58,.20)}",
  ".wh-spot .wh-conflict-head .wh-kicker,.wh-spot .wh-conflict-card>strong{display:block;font:800 14px/1.35 var(--ds-font);color:var(--ds-ink);overflow-wrap:anywhere}",
  ".wh-spot .wh-conflict-head .wh-subtle,.wh-spot .wh-conflict-summary,.wh-spot .wh-conflict-workbench-body{margin:5px 0 0;font:600 12.5px/1.5 var(--ds-font);color:var(--ds-ink-muted);overflow-wrap:anywhere}",
  ".wh-spot .wh-conflict-meta,.wh-spot .wh-conflict-options,.wh-spot .wh-conflict-workbench-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;margin-top:8px}",
  ".wh-spot .wh-pill{display:inline-flex;max-width:100%;border-radius:8px;background:transparent;padding:5px 8px;color:var(--ds-ink-muted);font:700 11px/1.25 var(--ds-font);overflow-wrap:anywhere}",
  ".wh-spot .wh-btn{display:inline-flex;align-items:center;justify-content:center;min-height:32px;max-width:100%;border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);background:transparent;padding:8px 11px;color:var(--ds-ink-soft);font:800 12.5px/1.15 var(--ds-font);text-align:center;text-decoration:none;white-space:normal;overflow-wrap:anywhere;word-break:break-word;box-shadow:inset 0 1px 0 rgba(255,255,255,.34);transition:transform var(--ds-dur-fast) var(--ds-spring),filter var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-spot .wh-btn:hover{filter:brightness(1.04)}.wh-spot .wh-btn:active{transform:scale(.96)}",
  ".wh-spot .wh-btn-primary{border:0;color:#fff;background:linear-gradient(135deg,#0a84ff,#64d2ff);box-shadow:var(--ds-shadow-glow)}",
  ".wh-spot .wh-btn-danger{color:var(--ds-danger);border-color:rgba(255,69,58,.24);background:transparent}",
  ".wh-spot .wh-recommended{margin-left:6px;border-radius:999px;background:transparent;border:1px solid rgba(10,132,255,.18);padding:3px 6px;color:var(--ds-accent);font:800 10px/1 var(--ds-font)}",
  // 设置。
  ".wh-spot-set-group{display:flex;flex-direction:column;gap:8px}",
  ".wh-spot-set-label{font:600 12px/1 var(--ds-font);color:var(--ds-ink-muted)}",
  // L-05（R24 S3 走查）：设置页最后一行（账户/登出）滚到底后仍贴着窗口下边缘——.wh-spot-body 的
  // 12px 内边距在实测里不够，视觉上像被切了一刀。给设置页末尾单独留一段余量，别改全局 body 内边距
  // （会牵动所有能力视图的上下留白）。
  ".wh-spot-set-bottom-spacer{block-size:14px}",
  // 内联轻提示。
  ".wh-spot-toast{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);max-width:calc(100% - 28px);z-index:5;display:flex;align-items:center;gap:8px;border-radius:var(--ds-radius-pill);padding:9px 15px;font:600 12.5px/1.3 var(--ds-font);color:#fff;background:rgba(28,28,30,.92);box-shadow:var(--ds-shadow-2);animation:ds-pop var(--ds-dur) var(--ds-spring) both;-webkit-app-region:no-drag}",
  ".wh-spot-toast--ok{background:linear-gradient(135deg,#30d158,#64d2ff)}",
  ".wh-spot-toast--error{background:linear-gradient(135deg,#ff453a,#ff9f0a)}",
  // #20：toast 退场动画——移除前先播一帧缩放淡出(translateX(-50%) 居中,关键帧须带上),不再硬删。
  ".wh-spot-toast--leaving{animation:ds-spot-toast-out var(--ds-dur-fast) var(--ds-ease) both}",
  "@keyframes ds-spot-toast-out{from{transform:translateX(-50%) scale(1);opacity:1}to{transform:translateX(-50%) scale(.94);opacity:0}}",
  // R13 批 S1：「问问 Cuu」——命令面板无命中时的入口行 + 呼吸态 + 确认条 + 内联回答，全部浅色 token。
  ".wh-spot-ask-cuu-row-wrap{margin-top:12px;grid-column:1 / -1}",
  ".wh-spot-ask-cuu-row{display:flex;align-items:center;gap:11px;width:100%;box-sizing:border-box;text-align:left;border:1px solid rgba(10,132,255,.24);background:transparent;border-radius:var(--ds-radius-md);padding:11px 13px;cursor:pointer;color:var(--ds-ink);box-shadow:inset 0 0 0 1px rgba(10,132,255,.06);transition:transform var(--ds-dur-fast) var(--ds-ease-out),border-color var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-spot-ask-cuu-row:hover{border-color:rgba(10,132,255,.4);transform:translateY(-1px)}",
  ".wh-spot-ask-cuu-row:active{transform:translateY(0) scale(.98)}",
  ".wh-spot-ask-cuu-icon{display:inline-flex;width:22px;height:22px;flex:0 0 auto;color:var(--ds-accent)}.wh-spot-ask-cuu-icon svg{width:22px;height:22px}",
  ".wh-spot-ask-cuu-text{display:flex;flex-direction:column;gap:2px;min-width:0;text-align:left}",
  ".wh-spot-ask-cuu-label{font:650 13.5px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-spot-ask-cuu-hint{font:500 12px/1.4 var(--ds-font);color:var(--ds-ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-spot-ask-cuu-kbd{margin-left:auto;flex:0 0 auto;font:700 11px/1 var(--ds-font);color:var(--ds-accent);background:transparent;border:1px solid rgba(10,132,255,.18);border-radius:6px;padding:4px 7px}",
  // 呼吸态：一个柔和缩放/透明度脉动的点，配「Cuu 正在想…」文案——不是转圈的确定性 spinner，
  // 是「正在琢磨」的软反馈（与 wh-spot-spinner 的确定性加载区分开）。
  ".wh-spot-ask-cuu-asking{display:flex;align-items:center;justify-content:center;gap:10px;padding:22px 12px;color:var(--ds-ink-muted);font:600 13px/1.4 var(--ds-font);text-align:center}",
  ".wh-spot-ask-cuu-breathe{width:10px;height:10px;flex:0 0 auto;border-radius:50%;background:var(--ds-accent);animation:wh-spot-ask-cuu-breathe 1.4s ease-in-out infinite}",
  "@keyframes wh-spot-ask-cuu-breathe{0%,100%{transform:scale(.72);opacity:.55}50%{transform:scale(1);opacity:1}}",
  ".wh-spot-ask-cuu-confirm{display:flex;flex-direction:column;gap:10px;padding:12px 2px;text-align:left}",
  ".wh-spot-ask-cuu-understood{margin:0;font:600 13.5px/1.5 var(--ds-font);color:var(--ds-ink);overflow-wrap:anywhere}",
  ".wh-spot-ask-cuu-answer{display:flex;flex-direction:column;gap:8px;padding:6px 2px;text-align:left}",
  ".wh-spot-ask-cuu-answer-text{margin:0;font:500 13.5px/1.6 var(--ds-font);color:var(--ds-ink);overflow-wrap:anywhere}",
  ".wh-spot-ask-cuu-disclaimer{margin:0;font:500 11px/1.4 var(--ds-font);color:var(--ds-ink-faint)}",
  // 撤回条：壳层常驻（顶栏和内容区之间），高把握动作执行后或用户确认后亮出，「撤回」统一回到 launcher。
  ".wh-spot-ask-banner{display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--ds-glass-hairline);background:rgba(10,132,255,.07)}",
  ".wh-spot-ask-banner[hidden]{display:none}",
  ".wh-spot-ask-banner-text{flex:1 1 auto;min-width:0;font:600 12.5px/1.4 var(--ds-font);color:var(--ds-ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-spot-ask-banner-undo{flex:0 0 auto;border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-pill);background:transparent;color:var(--ds-accent);font:700 12px/1 var(--ds-font);padding:6px 11px;cursor:pointer}",
  ".wh-spot-ask-banner-undo:hover{filter:brightness(1.04)}.wh-spot-ask-banner-undo:active{transform:scale(.95)}",
  // R24 S6（E-11）：「AI 服务未配置」横幅——同工作台聊天区 wh-wb-chat-banner 共用 --ds-warn 语义色，
  // 只用聚焦盒的人也能看到同一个事实（此前只有工作台聊天区才有这条提示）。
  ".wh-spot-ai-banner{padding:8px 14px;text-align:center;font:600 12px/1.5 var(--ds-font);color:var(--ds-warn);background:var(--ds-warn-soft);border-bottom:1px solid var(--ds-glass-hairline);overflow-wrap:anywhere}",
  ".wh-spot-ai-banner[hidden]{display:none}",
  // R24 S6（E-10）：首启引导卡复用 .wh-spot-intake（intake.ts 的能力内联卡同款壳），但这里是直接塞进
  // launcher 的两列 .wh-spot-grid（renderLauncherGrid），不像 .wh-spot-empty-grid 那样自带跨列——
  // 补一条跨列规则，否则卡片会被挤成半宽（.wh-spot-intake 的其它既有用法都不在 grid 容器内，不受影响）。
  ".wh-spot-grid>.wh-spot-intake{grid-column:1 / -1}",
  // 内层控件只保留透明边线和高光；折射统一交给外层 liquid-glass warp，避免多层 backing 叠出可变底色。
  // 尊重「减少动态效果」系统偏好：去掉装饰性位移/缩放，保留颜色提示（苹果级无障碍）。
  "@media (prefers-reduced-motion:reduce){.wh-spot-cap,.wh-spot-act,.wh-spot-back,.wh-spot-opt,.wh-spot-reason,a.wh-spot-row,button.wh-spot-row,.wh-spot-ask-cuu-row{transition-duration:.01ms!important}.wh-spot-cap:hover,.wh-spot-cap:active,.wh-spot-act:active,.wh-spot-back:active,.wh-spot-opt:hover,.wh-spot-opt:active,.wh-spot-reason:active,a.wh-spot-row:hover,a.wh-spot-row:active,button.wh-spot-row:hover,button.wh-spot-row:active,.wh-spot-ask-cuu-row:hover,.wh-spot-ask-cuu-row:active{transform:none}.wh-spot-ask-cuu-breathe{animation:none;opacity:1}}"
].join("");
