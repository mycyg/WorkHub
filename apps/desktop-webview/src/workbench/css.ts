// WorkHub 桌面 · 工作台样式（照 src/spotlight/css.ts 的注入模式：一批 rule 字符串，join 后整块 <style>）。
// R13 批 V1：工作台从深色玻璃改为固定浅色玻璃，与 Spotlight 聚焦盒同一视觉语言（用户拍板：固定浅色，
// 不做跟随系统）。token 全部复用 design-system.ts 的 --ds-* 浅色基线（间距/圆角/时长/缓动/字体本就不变，
// 现在颜色/玻璃相关 token 也不再本地覆盖）——.wh-ds.wh-wb 这个作用域现在只保留 Cuu 品牌橙
// （--wb-cuu/--wb-cuu-soft），其余全部级联自 design-system 的浅色 .wh-ds 根。--wb-bg0/--wb-bg1
// 这两个纯深色背景 token（连同引用它们的规则）已废弃移除。
//
// 透明 Tauri 窗口里 backdrop-filter 是空操作（本仓库踩过的坑，见 04 §4-2 与 02 §0）：玻璃质感真正来源是
// window_controls.rs 里的原生 vibrancy（macOS HudWindow material，由集成者切换成浅色 vibrancy）；这里的
// backdrop-filter 只是「有 vibrancy 时锦上添花、没有时也不出错」的渐进增强，不透明兜底换成浅色薄透明底
// （rgba(250,251,253,...)系——浏览器 dev 预览/vibrancy 失败都落到这层，同样要读得清）。

export const workbenchCss = [
  // —— 品牌色 token（作用域 .wh-ds.wh-wb，选择器特异性天然高于 .wh-ds 本身）——只保留 Cuu 橙，
  // 其它颜色 token 不再本地覆盖，级联自 design-system.ts 的浅色 .wh-ds 根。 —— //
  ".wh-ds.wh-wb{--wb-cuu:#ffab5e;--wb-cuu-soft:rgba(255,171,94,.14)}",

  // —— 窗口外壳：macOS 用原生红绿灯（decorations:true + titleBarStyle Overlay，Rust 侧
  // create_workbench_window_if_missing 的平台分支），非 macOS 仍无边框靠自绘拖拽区 + 关闭/最小化控件。
  // R13 批 V2：圆角工艺三层打架修复——原生 vibrancy 圆角(24) 已经在裁剪窗口的可见形状，这里的
  // border-radius 只做内容裁剪（overflow:hidden 配合 CSS 圆角，避免方形内容溢出圆角外），不再画
  // box-shadow：矩形投影会在原生裁剪出的圆角外画出残角（04 §4 铁律：真机截图实锤的 bug，不是审美
  // 偏好）。阴影交给原生 NSWindow.hasShadow（Rust 侧显式 .shadow(true)）。 —— //
  "html,body,#root{margin:0;height:100%;background:transparent}",
  ".wh-wb-window{position:relative;height:100vh;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;" +
    "border-radius:24px;border:1px solid rgba(255,255,255,.7);" +
    "background:linear-gradient(180deg,rgba(250,251,253,.88),rgba(242,245,250,.92))}",
  ".wh-wb-titlebar{flex:0 0 auto;height:44px;display:flex;align-items:center;gap:10px;padding:0 8px 0 16px;" +
    "border-bottom:1px solid var(--ds-glass-border);-webkit-app-region:drag}",
  // macOS 原生红绿灯接管（titleBarStyle:Overlay + hiddenTitle + trafficLightPosition，见 main.rs
  // create_workbench_window_if_missing）：自绘的 min/close 按钮整个不渲染（shell.ts renderWorkbenchShellHtml
  // 的 nativeWindowChrome 分支），左侧让出空间别被红绿灯压住面包屑文字——78px 覆盖三个原生按钮的可点范围
  // (~18px 起、每个直径 12px + 间距 8px)再留一点呼吸空间，具体像素值待真机核对（见集成者验收清单）。
  ".wh-wb-titlebar--native{padding-left:78px}",
  ".wh-wb-crumb{font:600 13px/1 var(--ds-font);color:var(--ds-ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-wb-crumb b{color:var(--ds-ink);font-weight:700}",
  ".wh-wb-titlebar-spacer{flex:1 1 auto}",
  ".wh-wb-titlebar-controls{display:flex;align-items:center;gap:4px;-webkit-app-region:no-drag}",
  ".wh-wb-winbtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;" +
    "border:0;background:transparent;color:var(--ds-ink-muted);cursor:pointer;transition:background var(--ds-dur-fast) var(--ds-ease),color var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-winbtn svg{width:14px;height:14px}",
  // 浅底上白色半透明 hover 不可见——换深色低透明度（rank：hover 反馈普适规则，见批次说明）。
  ".wh-wb-winbtn:hover{background:rgba(20,30,50,.06);color:var(--ds-ink)}",
  ".wh-wb-winbtn--close:hover{background:var(--ds-danger-soft);color:var(--ds-danger)}",

  // —— 三栏骨架 —— //
  ".wh-wb-body{flex:1 1 auto;min-height:0;display:flex}",
  ".wh-wb-rail{width:242px;flex:0 0 auto;border-right:1px solid var(--ds-glass-border);display:flex;flex-direction:column;" +
    "background:var(--ds-glass-quiet);overflow-y:auto}",
  ".wh-wb-rail-head{padding:14px 14px 8px;font:700 11px/1 var(--ds-font);letter-spacing:.12em;color:var(--ds-ink-faint);text-transform:uppercase}",
  ".wh-wb-project{margin:2px 8px;border-radius:var(--ds-radius-md)}",
  ".wh-wb-project-row{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;padding:8px 10px;" +
    "border:0;border-radius:var(--ds-radius-md);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}",
  ".wh-wb-project-row:hover{background:rgba(20,30,50,.05)}",
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
  // R13 批 P3：项目行 + 项目设置齿轮的水平容器（齿轮是 .wh-wb-project-row 的兄弟节点——按钮里不能套
  // 按钮，见 rail.ts renderProjectTreeHtml 的注释）。齿轮只在选中项目且 viewer 是项目负责人时渲染。
  ".wh-wb-project-head{display:flex;align-items:center;gap:2px}",
  ".wh-wb-project-head .wh-wb-project-row{flex:1 1 auto;min-width:0}",
  ".wh-wb-project-gear{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex:0 0 auto;" +
    "border:0;border-radius:8px;background:transparent;color:var(--ds-ink-faint);cursor:pointer;" +
    "transition:background var(--ds-dur-fast) var(--ds-ease),color var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-project-gear svg{width:14px;height:14px}",
  ".wh-wb-project-gear:hover{background:rgba(20,30,50,.06);color:var(--ds-ink)}",
  ".wh-wb-project-gear.sel{background:var(--ds-accent-soft);color:var(--ds-accent)}",
  ".wh-wb-tree{padding:2px 0 6px 22px}",
  // 批 1 的树叶行是只读信息(真会话标题/真文件数)——网盘视图还没接进这个窗口(批 6)，不给
  // cursor:pointer/hover 反馈,免得看起来能点却什么都不做（04 §4-3 铁律）。批 2 把主区群聊接进这个
  // 窗口后，「主区」升级成 .wh-wb-leaf--live（真 <button>，会话点击路由）；「网盘」仍是这条规则。
  ".wh-wb-leaf{display:flex;align-items:center;gap:8px;width:calc(100% - 8px);box-sizing:border-box;font:500 13px/1.3 var(--ds-font);" +
    "text-align:left;color:var(--ds-ink-muted);padding:6px 10px;margin:1px 8px 1px 0;border-radius:9px;border:1px solid transparent;" +
    "background:transparent;cursor:default}",
  ".wh-wb-leaf.sel{background:var(--ds-accent-soft);color:var(--ds-ink);border-color:rgba(10,132,255,.25)}",
  ".wh-wb-leaf svg{width:13px;height:13px;flex:0 0 auto;color:var(--ds-ink-faint)}",
  ".wh-wb-leaf.sel svg{color:var(--ds-accent)}",
  ".wh-wb-leaf--live{cursor:pointer;transition:background var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-leaf--live:hover{background:var(--ds-glass-strong)}",
  ".wh-wb-leaf-count{margin-left:auto;font:700 10.5px/1 var(--ds-font);color:var(--ds-ink-faint);background:var(--ds-glass);padding:1px 6px;border-radius:99px}",
  // R15 批 A6：未读红点徽标——数字挂在树叶/私聊行尾，红点风格（danger 底 + 白字 + 柔光），区别于上面
  // 那个浅灰的消息总数样式。跟随既有玻璃体系里 wh-wb-project-dot 的 danger 语汇。
  ".wh-wb-leaf-count--unread{color:#fff;background:var(--ds-danger);box-shadow:0 0 8px var(--ds-danger)}",
  ".wh-wb-dm-count{flex:0 0 auto;margin-left:6px;font:700 10.5px/1 var(--ds-font);color:#fff;background:var(--ds-danger);box-shadow:0 0 8px var(--ds-danger);padding:1px 6px;border-radius:99px}",
  ".wh-wb-rail-foot{margin-top:auto;border-top:1px solid var(--ds-glass-border);padding:10px 12px}",
  ".wh-wb-me{display:flex;align-items:center;gap:8px;padding:10px 10px 2px;font:500 12.5px/1.3 var(--ds-font);color:var(--ds-ink-muted)}",
  // R13 批 P1：军团总览左栏一级入口——与项目列表平级，独立分组（用户拍板 4）。真按钮，不是批 1/5
  // 那条不可点的预告条了，所以有 hover/active 反馈（同 .wh-wb-project-row 的既有手感）。
  ".wh-wb-rail-group{margin:6px 8px 2px;padding-top:8px;border-top:1px solid var(--ds-glass-border)}",
  ".wh-wb-army-nav{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;padding:8px 10px;" +
    "border:0;border-radius:var(--ds-radius-md);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;" +
    "transition:background var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-army-nav:hover{background:rgba(20,30,50,.05)}",
  ".wh-wb-army-nav.active{background:var(--ds-glass-strong)}",
  ".wh-wb-army-nav svg{width:18px;height:18px;color:var(--wb-cuu);flex:0 0 auto}",
  ".wh-wb-army-nav-label{font:600 13.5px/1.3 var(--ds-font);color:var(--ds-ink)}",
  // R15 批 I1（决策收件箱）：rail 顶部「待拍板」一级入口——与军团总览同一套一级入口手感（复用
  // .wh-wb-army-nav 的排布/hover/active），末尾一枚红色计数徽标（同未读红点视觉语言，>0 才渲）。
  ".wh-wb-inbox-nav{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;padding:8px 10px;" +
    "border:0;border-radius:var(--ds-radius-md);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;" +
    "transition:background var(--ds-dur-fast) var(--ds-ease)}",
  // 收件箱分组在 rail 最顶，去掉 .wh-wb-rail-group 默认的上边线（顶端不需要分隔线）。
  ".wh-wb-rail-group--inbox{border-top:0;padding-top:2px;margin-top:2px}",
  ".wh-wb-inbox-nav:hover{background:rgba(20,30,50,.05)}",
  ".wh-wb-inbox-nav.active{background:var(--ds-glass-strong)}",
  ".wh-wb-inbox-nav svg{width:18px;height:18px;color:var(--ds-accent);flex:0 0 auto}",
  ".wh-wb-inbox-nav-label{font:600 13.5px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-inbox-nav-count{margin-left:auto;flex:0 0 auto;min-width:18px;height:18px;padding:0 6px;box-sizing:border-box;font:700 10.5px/18px var(--ds-font);text-align:center;color:#fff;background:var(--ds-danger);box-shadow:0 0 8px var(--ds-danger);border-radius:99px}",

  // —— R15 批 B（人对人私聊）：成员 roster + 私聊分组 + 头像资料卡 —— //
  // 分组标题在 .wh-wb-rail-group 里时去掉 rail-head 默认的上/侧内边距冗余，贴合分组容器。
  ".wh-wb-rail-head--flush{padding:2px 10px 6px}",
  // roster / DM 行——同 .wh-wb-project-row 的一档密度与 hover/选中手感，左头像右昵称，昵称单行省略号。
  ".wh-wb-roster-row,.wh-wb-dm-row{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;padding:6px 10px;" +
    "background:transparent;border:0;border-radius:9px;cursor:pointer;text-align:left;transition:background var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-roster-row:hover,.wh-wb-dm-row:hover{background:rgba(20,30,50,.05)}",
  ".wh-wb-dm-row.sel{background:var(--ds-accent-soft)}",
  ".wh-wb-roster-name,.wh-wb-dm-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" +
    "font:500 13px/1.3 var(--ds-font);color:var(--ds-ink)}",
  // roster/dm 行里的头像不堆叠——抵掉 .wh-wb-chat-avatar 的 -6px 负边距。
  ".wh-wb-roster-row .wh-wb-chat-avatar,.wh-wb-dm-row .wh-wb-chat-avatar{margin-right:0}",
  ".wh-wb-dm-empty{margin:0 10px 4px;font:500 12px/1.5 var(--ds-font);color:var(--ds-ink-faint)}",
  // 头像资料卡：外壳根级绝对定位的浮层 + 内层玻璃卡。
  ".wh-wb-profile-pop{position:absolute;z-index:60;max-width:230px}",
  ".wh-wb-profile-card{border-radius:var(--ds-radius-md);padding:12px 13px;display:flex;flex-direction:column;gap:10px}",
  ".wh-wb-profile-head{display:flex;align-items:center;gap:10px}",
  ".wh-wb-profile-avatar .wh-wb-chat-avatar{width:34px;height:34px;margin-right:0;font-size:13px}",
  ".wh-wb-profile-meta{min-width:0;display:flex;flex-direction:column;gap:2px}",
  ".wh-wb-profile-name{font:600 14px/1.25 var(--ds-font);color:var(--ds-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-wb-profile-status{font:500 12px/1.2 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-profile-status--online{color:var(--ds-success)}",
  ".wh-wb-profile-self{font:500 12.5px/1.3 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-profile-dm{display:inline-flex;align-items:center;justify-content:center;width:100%;box-sizing:border-box;" +
    "padding:7px 12px;border:0;border-radius:var(--ds-radius-sm);cursor:pointer;font:600 13px/1 var(--ds-font);" +
    "color:#fff;background:linear-gradient(135deg,#0a84ff,#64d2ff);box-shadow:var(--ds-shadow-glow)}",
  // DM 会话头的在线两态文字——贴在对方昵称之后。
  ".wh-wb-chat-head-status{margin-left:8px;font:500 12px/1.2 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-chat-head-status--online{color:var(--ds-success)}",

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

  // —— 右栏：情境面板外壳（骨架批 1 就有；R13 批 P1 把真内容——军团三区/run 详情下钻——接进
  // .wh-wb-side-body，见下面 .wh-wb-army-* 一整块）。 —— //
  ".wh-wb-side{width:322px;flex:0 0 auto;border-left:1px solid var(--ds-glass-border);display:flex;flex-direction:column;" +
    "background:var(--ds-glass-quiet);transition:width var(--ds-dur) var(--ds-ease),opacity var(--ds-dur) var(--ds-ease)}",
  ".wh-wb-side[data-open=\"false\"]{width:0;opacity:0;overflow:hidden;border-left:0}",
  ".wh-wb-side-head{padding:13px 15px 10px;border-bottom:1px solid var(--ds-glass-border);display:flex;align-items:center;gap:8px}",
  ".wh-wb-side-head svg{width:16px;height:16px;color:var(--ds-ink-muted)}",
  ".wh-wb-side-title{font:700 13px/1 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-side-body{flex:1 1 auto;overflow-y:auto;padding:16px 15px;font:500 12.5px/1.6 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-side-toggle{position:absolute;top:8px;right:8px;-webkit-app-region:no-drag}",

  // —— R13 批 P1：军团面板三区（输出/军团/后台任务）+ run 卡下钻详情——视觉基准 prototype 的
  // .out-row/.runcard/.bg-row/.run-detail，配色改浅色 --ds-* token。 —— //
  ".wh-wb-army-loading{display:flex;align-items:center;gap:9px;padding:24px 4px;font:600 12.5px/1 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-army-error{padding:20px 4px;text-align:center;font:500 12.5px/1.6 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-army-empty-note{margin:2px 0 12px;font:500 12px/1.6 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-army-capped-note{margin:2px 0 12px;font:500 11px/1.5 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-army-sec-h{display:flex;align-items:center;gap:7px;font:700 11px/1 var(--ds-font);letter-spacing:.06em;" +
    "text-transform:uppercase;color:var(--ds-ink-faint);padding:0 0 8px;margin-top:4px}",
  ".wh-wb-army-sec-n{font:600 10px/1 var(--ds-font);color:var(--ds-ink-faint);background:var(--ds-glass);padding:1px 7px;border-radius:99px;text-transform:none;letter-spacing:0}",
  // 输出行：<details>/<summary> 原生折叠——点击只展示 proposal_href 文案，深链跳转是后续批次的活
  // （04 §4 铁律 3：没有真接线就不能装成能点）。
  ".wh-wb-army-out-row{margin-bottom:6px;border-radius:var(--ds-radius-sm);background:var(--ds-glass);border:1px solid var(--ds-glass-border)}",
  ".wh-wb-army-out-row summary{display:flex;align-items:center;gap:9px;padding:8px 10px;cursor:pointer;list-style:none}",
  ".wh-wb-army-out-row summary::-webkit-details-marker{display:none}",
  ".wh-wb-army-out-row:hover{background:var(--ds-glass-strong)}",
  ".wh-wb-army-out-icon{width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;" +
    "background:var(--ds-accent-soft);color:var(--ds-accent);flex:0 0 auto}",
  ".wh-wb-army-out-icon svg{width:13px;height:13px}",
  ".wh-wb-army-out-main{flex:1 1 auto;min-width:0}",
  ".wh-wb-army-out-title{display:block;font:600 12.5px/1.3 var(--ds-font);color:var(--ds-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-wb-army-out-meta{display:block;font:500 10.5px/1.4 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-army-out-chev{color:var(--ds-ink-faint);flex:0 0 auto}",
  ".wh-wb-army-out-href{margin:0;padding:0 10px 9px 43px;font:500 11px/1.5 var(--ds-font);color:var(--ds-ink-faint);word-break:break-all}",
  ".wh-wb-army-runs{display:flex;flex-direction:column;gap:9px;margin-bottom:6px}",
  ".wh-wb-army-rc{display:block;width:100%;box-sizing:border-box;text-align:left;font:inherit;color:inherit;" +
    "border:1px solid var(--ds-glass-border);background:var(--ds-glass);border-radius:var(--ds-radius-md);padding:11px 12px;cursor:pointer}",
  ".wh-wb-army-rc:hover{background:var(--ds-glass-strong);border-color:rgba(15,23,42,.16)}",
  ".wh-wb-army-rc--static{cursor:default}",
  ".wh-wb-army-rc--static:hover{background:var(--ds-glass);border-color:var(--ds-glass-border)}",
  ".wh-wb-army-rc--run{border-color:rgba(10,132,255,.3)}",
  ".wh-wb-army-rc-top{display:flex;align-items:center;gap:7px;margin-bottom:6px;flex-wrap:wrap}",
  ".wh-wb-army-rc-cat{display:inline-flex;width:16px;height:16px;color:var(--wb-cuu);flex:0 0 auto}",
  ".wh-wb-army-rc-cat svg{width:16px;height:16px}",
  ".wh-wb-army-rc-name{font:700 12px/1 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-army-rc-project{font:600 10.5px/1 var(--ds-font);color:var(--ds-ink-muted);background:var(--ds-glass);" +
    "border:1px solid var(--ds-glass-border);padding:2px 7px;border-radius:99px}",
  ".wh-wb-army-rc-exec{font:600 10.5px/1 var(--ds-font);color:var(--ds-ink-muted);border:1px solid var(--ds-glass-border);padding:1px 7px;border-radius:99px}",
  ".wh-wb-army-rc-status{margin-left:auto;font:700 10.5px/1 var(--ds-font);padding:2px 8px;border-radius:99px}",
  ".wh-wb-army-rc-status--run{color:var(--ds-accent);background:var(--ds-accent-soft)}",
  ".wh-wb-army-rc-status--wait{color:var(--ds-warn);background:var(--ds-warn-soft)}",
  ".wh-wb-army-rc-status--done{color:var(--ds-success);background:var(--ds-success-soft)}",
  ".wh-wb-army-rc-status--fail{color:var(--ds-danger);background:var(--ds-danger-soft)}",
  ".wh-wb-army-rc-goal{font:600 12.5px/1.45 var(--ds-font);color:var(--ds-ink);margin-bottom:6px}",
  ".wh-wb-army-rc-meta{display:flex;flex-wrap:wrap;gap:8px;font:500 10.5px/1.4 var(--ds-font);color:var(--ds-ink-faint);margin-bottom:5px}",
  ".wh-wb-army-rc-step{font:500 11px/1.4 var(--ds-font);color:var(--ds-ink-muted);margin-bottom:7px}",
  ".wh-wb-army-rc-foot{display:flex;align-items:center;gap:8px;font:600 10.5px/1 var(--ds-font);color:var(--ds-ink-faint);" +
    "border-top:1px solid var(--ds-glass-border);padding-top:7px}",
  ".wh-wb-army-loadmore{width:100%;margin-bottom:6px;padding:8px;border-radius:var(--ds-radius-sm);border:1px solid var(--ds-glass-border);" +
    "background:transparent;color:var(--ds-accent);font:600 12px/1 var(--ds-font);cursor:pointer}",
  ".wh-wb-army-loadmore:hover{background:var(--ds-accent-soft)}",
  ".wh-wb-army-loadmore:disabled{opacity:.6;cursor:default}",
  ".wh-wb-army-loadmore-error{margin:0 0 6px;font:500 11px/1.5 var(--ds-font);color:var(--ds-danger)}",
  // run 详情下钻
  ".wh-wb-army-back{border:0;background:transparent;padding:0;margin-bottom:12px;color:var(--ds-accent);" +
    "font:600 11.5px/1 var(--ds-font);cursor:pointer}",
  ".wh-wb-army-rd-name{font:700 14px/1.3 var(--ds-font);color:var(--ds-ink);margin-bottom:3px}",
  ".wh-wb-army-rd-goal{font:500 12px/1.55 var(--ds-font);color:var(--ds-ink-muted);margin-bottom:10px}",
  ".wh-wb-army-rd-meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}",
  ".wh-wb-army-chip{font:600 10.5px/1 var(--ds-font);color:var(--ds-ink-muted);background:var(--ds-glass);" +
    "border:1px solid var(--ds-glass-border);padding:3px 9px;border-radius:99px}",
  ".wh-wb-army-rd-step{margin-bottom:14px;padding:10px 12px;border-radius:var(--ds-radius-md);background:var(--wb-cuu-soft);" +
    "border:1px solid rgba(255,171,94,.28)}",
  ".wh-wb-army-rd-step-phase{font:700 10.5px/1 var(--ds-font);color:var(--wb-cuu);margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em}",
  ".wh-wb-army-rd-step-out{font:500 12px/1.55 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-army-replay-loading{display:flex;align-items:center;gap:8px;font:500 12px/1 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-army-replay-error{margin:0 0 8px;font:500 12px/1.5 var(--ds-font);color:var(--ds-danger)}",
  ".wh-wb-army-timeline{border-left:2px solid var(--ds-glass-border);margin:8px 0 14px 6px;padding-left:13px;" +
    "display:flex;flex-direction:column;gap:11px}",
  ".wh-wb-army-tl-item{position:relative;font:500 12px/1.5 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-army-tl-item::before{content:\"\";position:absolute;left:-18.5px;top:4px;width:9px;height:9px;border-radius:50%;" +
    "background:var(--ds-ink-faint);border:2px solid var(--ds-glass-quiet)}",
  ".wh-wb-army-tl-phase{font:700 10px/1 var(--ds-font);letter-spacing:.05em;text-transform:uppercase;color:var(--ds-ink-faint);margin-bottom:2px}",
  ".wh-wb-army-tl-out{color:var(--ds-ink)}",
  ".wh-wb-army-tl-tm{margin-left:6px;font:500 10.5px/1 var(--ds-font);color:var(--ds-ink-faint)}",

  // —— R13 批 P1：军团总览（跨项目卡片流，中栏 centerTab === "army-overview"）—— //
  ".wh-wb-center.wh-wb-center--army-overview{padding:0;display:flex;flex-direction:column;overflow:hidden}",
  ".wh-wb-army-overview{display:flex;flex-direction:column;height:100%;min-height:0}",
  ".wh-wb-army-ov-bar{display:flex;align-items:center;gap:10px;padding:16px 26px;border-bottom:1px solid var(--ds-glass-border);flex:0 0 auto}",
  ".wh-wb-army-ov-title{font:700 16px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-army-ov-body{flex:1 1 auto;overflow-y:auto;padding:16px 26px 26px}",
  ".wh-wb-army-ov-group{margin-bottom:20px}",
  ".wh-wb-army-ov-group-h{display:flex;align-items:center;gap:7px;font:700 12.5px/1 var(--ds-font);color:var(--ds-ink);margin-bottom:10px}",
  ".wh-wb-army-ov-empty{padding:40px 18px;text-align:center;font:500 13px/1.6 var(--ds-font);color:var(--ds-ink-muted)}",

  // —— R13 批 P3：项目设置（AI 治理表单，中栏 centerTab === "project-settings"）——浅色玻璃行/开关/
  // chips，视觉照 .wh-wb-summary 与 .wh-spot-row 的既有语言。中栏保持默认滚动盒（不像 chat/drive 那样
  // 自管布局），沿用 .wh-wb-center 的 padding。 —— //
  ".wh-wb-pset{max-width:640px}",
  ".wh-wb-pset-head{margin-bottom:16px}",
  ".wh-wb-pset-title{margin:0;font:700 18px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-pset-sub{margin:6px 0 0;font:500 12.5px/1.6 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-pset-readonly-note{margin:8px 0 0;font:600 12px/1.5 var(--ds-font);color:var(--ds-warn)}",
  ".wh-wb-pset-error{margin:0 0 12px;font:600 12px/1.5 var(--ds-font);color:var(--ds-danger)}",
  ".wh-wb-pset-group{border:1px solid var(--ds-glass-border);background:var(--ds-glass);border-radius:var(--ds-radius-md);" +
    "padding:13px 15px;margin-bottom:10px}",
  ".wh-wb-pset-row{display:flex;align-items:center;gap:12px}",
  ".wh-wb-pset-row-main{flex:1 1 auto;min-width:0}",
  ".wh-wb-pset-row-title{font:600 13.5px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-pset-row-sub{margin-top:3px;font:500 11.5px/1.5 var(--ds-font);color:var(--ds-ink-muted)}",
  // 开关：浅底轨道 + 白色小圆钮，选中态换蓝（同 design-system 的 accent）。禁用态（只读表单）降不透明度。
  ".wh-wb-pset-switch{position:relative;width:38px;height:22px;flex:0 0 auto;border:1px solid var(--ds-glass-border);" +
    "border-radius:99px;background:rgba(15,23,42,.08);cursor:pointer;padding:0;transition:background var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-pset-switch[data-on=\"true\"]{background:var(--ds-accent);border-color:var(--ds-accent)}",
  ".wh-wb-pset-switch:disabled{opacity:.55;cursor:default}",
  ".wh-wb-pset-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;" +
    "box-shadow:0 1px 3px rgba(15,23,42,.3);transition:transform var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-pset-switch[data-on=\"true\"] .wh-wb-pset-knob{transform:translateX(16px)}",
  ".wh-wb-pset-inline{display:flex;align-items:center;gap:7px;flex:0 0 auto}",
  ".wh-wb-pset-inline-k{font:500 12px/1 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-pset-num{width:84px;box-sizing:border-box;padding:7px 9px;background:rgba(15,23,42,.045);" +
    "border:1px solid rgba(15,23,42,.14);border-radius:9px;color:var(--ds-ink);font:500 13px/1.2 var(--ds-font);outline:none}",
  ".wh-wb-pset-num:focus{border-color:rgba(10,132,255,.45)}",
  ".wh-wb-pset-time{box-sizing:border-box;padding:6px 8px;background:rgba(15,23,42,.045);" +
    "border:1px solid rgba(15,23,42,.14);border-radius:9px;color:var(--ds-ink);font:500 12.5px/1.2 var(--ds-font);outline:none}",
  ".wh-wb-pset-time:focus{border-color:rgba(10,132,255,.45)}",
  ".wh-wb-pset-quiet-body{margin-top:11px;padding-top:11px;border-top:1px solid var(--ds-glass-border);" +
    "display:flex;flex-direction:column;gap:9px}",
  ".wh-wb-pset-days{display:flex;gap:6px;flex-wrap:wrap}",
  ".wh-wb-pset-day{min-width:30px;padding:6px 8px;border:1px solid var(--ds-glass-border);border-radius:99px;" +
    "background:transparent;color:var(--ds-ink-muted);font:600 11.5px/1 var(--ds-font);cursor:pointer;" +
    "transition:border-color var(--ds-dur-fast) var(--ds-ease),color var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-pset-day[data-sel=\"true\"]{border-color:var(--ds-accent);color:var(--ds-accent);box-shadow:inset 0 0 0 1px rgba(10,132,255,.18)}",
  ".wh-wb-pset-day:disabled{cursor:default;opacity:.7}",
  ".wh-wb-pset-note{font:500 11px/1.4 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-pset-chips{margin-top:10px;display:flex;gap:7px;flex-wrap:wrap}",
  // Granular chip：data-sel="true" = 已禁止（警示红边，同 spotlight .wh-spot-reason[data-sel] 的语义）。
  ".wh-wb-pset-chip{border:1px solid var(--ds-glass-border);border-radius:99px;background:transparent;color:var(--ds-ink-soft);" +
    "font:600 12px/1 var(--ds-font);padding:8px 12px;cursor:pointer;" +
    "transition:border-color var(--ds-dur-fast) var(--ds-ease),color var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-pset-chip[data-sel=\"true\"]{border-color:var(--ds-danger);color:var(--ds-danger);box-shadow:inset 0 0 0 1px rgba(255,69,58,.22)}",
  ".wh-wb-pset-chip:disabled{cursor:default;opacity:.7}",

  // —— R14 批 GH：项目设置里的 GitHub 绑定卡——文本输入/状态卡/操作行，风格延续上面的 .wh-wb-pset-*
  // 语言（浅色玻璃行 + 同款输入框），不引入新的视觉体系。 —— //
  ".wh-wb-pset-gh-loading-row{display:flex;align-items:center;gap:8px;font:500 12.5px/1.5 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-pset-gh-form{display:flex;flex-direction:column;gap:6px;margin-top:4px}",
  ".wh-wb-pset-text{width:100%;box-sizing:border-box;padding:8px 10px;background:rgba(15,23,42,.045);" +
    "border:1px solid rgba(15,23,42,.14);border-radius:9px;color:var(--ds-ink);font:500 13px/1.3 var(--ds-font);outline:none}",
  ".wh-wb-pset-text:focus{border-color:rgba(10,132,255,.45)}",
  ".wh-wb-pset-text:disabled{opacity:.6}",
  ".wh-wb-pset-gh-status{margin-top:4px}",
  ".wh-wb-pset-gh-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}",
  ".wh-wb-pset-gh-unbind--armed{border-color:rgba(255,69,58,.4);color:var(--ds-danger);background:var(--ds-danger-soft,rgba(255,69,58,.12))}",

  // —— 新建项目模态 —— //
  // 遮罩层保留深色 scrim（这是弹窗遮罩的通用惯例，跟壳体本身是浅是深无关，只是把注意力摁到模态上；
  // 比原深色主题版本调淡一档，别在浅色壳体上显得突兀）。
  ".wh-wb-modal-overlay{position:fixed;inset:0;display:none;align-items:flex-start;justify-content:center;" +
    "padding-top:16vh;z-index:50;background:rgba(15,20,35,.3);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}",
  ".wh-wb-modal-overlay[data-open=\"true\"]{display:flex}",
  ".wh-wb-modal{width:min(480px,calc(100vw - 40px));border-radius:20px;overflow:hidden;" +
    "background:linear-gradient(180deg,rgba(255,255,255,.97),rgba(248,250,253,.98));border:1px solid rgba(255,255,255,.7);" +
    "box-shadow:0 40px 110px -30px rgba(60,60,67,.38),inset 0 1px 0 rgba(255,255,255,.8);padding:18px 20px}",
  ".wh-wb-modal-title{margin:0;font:700 14px/1 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-modal-input{width:100%;box-sizing:border-box;margin:12px 0 10px;padding:10px 12px;" +
    "background:rgba(15,23,42,.045);border:1px solid rgba(15,23,42,.14);border-radius:10px;" +
    "color:var(--ds-ink);font:500 13.5px/1.3 var(--ds-font);outline:none}",
  ".wh-wb-modal-input:focus{border-color:rgba(10,132,255,.45)}",
  ".wh-wb-modal-note{margin:0;font:500 11.5px/1.7 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-modal-note b{color:var(--ds-ink-soft);font-weight:600}",
  ".wh-wb-modal-error{margin:10px 0 0;font:600 12px/1.5 var(--ds-font);color:var(--ds-danger)}",
  ".wh-wb-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}",

  // —— R14FIX 批 workbench（建群弹窗排版修复 · 2026-07-15 用户实拍）：建群模态的成员多选行 + Cuu 参与
  // 开关此前在 rail.ts 有结构却在 css.ts 完全没有样式，<label> 默认 inline 让 checkbox/头像/名字换行
  // 错乱（用户截图里 checkbox 浮在名字上方）。这一组规则把每行摆成一条对齐工整的 flex 行。 —— //
  ".wh-wb-new-collab-members{margin:2px 0 8px;max-height:184px;overflow-y:auto;display:flex;flex-direction:column;gap:1px}",
  ".wh-wb-new-collab-members-label{margin:0 0 6px;font:500 11.5px/1.5 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-new-collab-member-row{display:flex;align-items:center;gap:9px;padding:5px 8px;border-radius:9px;cursor:pointer;" +
    "font:500 13px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-new-collab-member-row:hover{background:rgba(20,30,50,.05)}",
  ".wh-wb-new-collab-member-row input[type=\"checkbox\"]{flex:0 0 auto;width:15px;height:15px;margin:0;accent-color:var(--ds-accent);cursor:pointer}",
  // 头像 tile 复用 .wh-wb-chat-avatar（含固定 22×22 + margin-right:-6px 的堆叠留白）——建群行里不堆叠，
  // 抵掉负边距。名字 span 用 :not(.wh-wb-chat-avatar) 排除头像那个 span，否则更高优先级的 `span` 选择器
  // 会把头像也拉成 flex:1（渲染成横向拉伸的椭圆，而不是 22px 圆）。
  ".wh-wb-new-collab-member-row .wh-wb-chat-avatar{margin-right:0}",
  ".wh-wb-new-collab-member-row span:not(.wh-wb-chat-avatar){flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-wb-new-collab-member-empty{margin:2px 0 8px;font:500 12px/1.5 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-new-collab-cuu-toggle{display:flex;align-items:center;gap:9px;padding:8px 2px 2px;cursor:pointer;" +
    "font:500 13px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-new-collab-cuu-toggle input[type=\"checkbox\"]{flex:0 0 auto;width:15px;height:15px;margin:0;accent-color:var(--ds-accent);cursor:pointer}",

  // —— R14FIX 批 workbench：左栏协同分组的「+ 新建」容器 + 「和 Cuu 单独聊」快捷入口 + 每条协同会话
  // 叶子的悬停重命名铅笔。 —— //
  ".wh-wb-new-collab{display:flex;flex-direction:column;gap:1px;margin-top:2px}",
  ".wh-wb-new-collab-error{margin:2px 10px 4px;font:500 11px/1.4 var(--ds-font);color:var(--ds-danger)}",
  // 「和 Cuu 单独聊」——真按钮（.wh-wb-leaf--live 已带 hover/cursor），只把 cat 图标染成 Cuu 品牌橙。
  ".wh-wb-leaf--solo-cuu svg{color:var(--wb-cuu)}",
  // 协同会话叶子行：叶子 + 悬停铅笔的水平容器（铅笔是 <button> 的兄弟——按钮里不能套按钮，同项目设置
  // 齿轮的既有取舍）。叶子从固定宽改成 flex:1，把右侧让给铅笔。
  ".wh-wb-collab-leaf{display:flex;align-items:center}",
  ".wh-wb-collab-leaf .wh-wb-leaf{flex:1 1 auto;min-width:0;width:auto;margin-right:0}",
  ".wh-wb-collab-rename{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;" +
    "margin-right:8px;border:0;border-radius:7px;background:transparent;color:var(--ds-ink-faint);cursor:pointer;opacity:0;" +
    "transition:opacity .12s var(--ds-ease),background var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-collab-leaf:hover .wh-wb-collab-rename,.wh-wb-collab-rename:focus-visible{opacity:1}",
  ".wh-wb-collab-rename:hover{background:rgba(20,30,50,.06);color:var(--ds-ink)}",
  ".wh-wb-collab-rename svg{width:13px;height:13px}",

  // —— 通用按钮（复用 .ds-btn 结构，浅色配色——主按钮照 design-system.ts 的 .ds-btn-primary 同款蓝色渐变
  // + 白字，不再是深色主题那套「浅蓝底配深字」）。 —— //
  ".wh-wb-btn{font:600 12.5px/1 var(--ds-font);padding:8px 14px;border-radius:99px;border:1px solid var(--ds-glass-border);" +
    "background:var(--ds-glass);color:var(--ds-ink);cursor:pointer;transition:background var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-btn:hover{background:var(--ds-glass-strong)}",
  ".wh-wb-btn:disabled{opacity:.5;cursor:default}",
  ".wh-wb-btn--primary{border:0;color:#fff;background:linear-gradient(135deg,#0a84ff,#64d2ff);box-shadow:var(--ds-shadow-glow);font-weight:700}",
  ".wh-wb-btn--ghost{color:var(--ds-ink-muted);background:transparent;border-color:transparent}",

  // —— 批 2：主区群聊。中栏在渲染群聊时切成 flex 列布局，自己管内部滚动区（composer 常驻底部），
  // 不再吃 .wh-wb-center 默认的整体滚动+内边距。 —— //
  ".wh-wb-center.wh-wb-center--chat{padding:0;display:flex;flex-direction:column;overflow:hidden}",
  ".wh-wb-chat{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}",
  ".wh-wb-chat-banner{flex:none;padding:6px 20px;text-align:center;font:600 11.5px/1.4 var(--ds-font);" +
    "color:var(--ds-warn);background:var(--ds-warn-soft);border-bottom:1px solid var(--ds-glass-border)}",
  // R15 批 cuu-toggle：头部挂载点本身撑成一行——左边是既有的成员条/DM 头（.wh-wb-chat-head 内部自己的
  // flex 布局不变），右边留给「请 Cuu 进来」开关（只在 DM/非主区协同会话渲染，见 view.ts renderHead）。
  // 挂载点本身没有类名，只有 data-wb-chat-head 属性——纯布局壳，不影响任何既有断言（既有测试只覆盖
  // renderMemberBarHtml/renderDmHeadBarHtml 各自返回的字符串，不检查这层壳）。
  "[data-wb-chat-head]{display:flex;align-items:center;justify-content:space-between;gap:8px}",
  ".wh-wb-chat-head{flex:none;display:flex;align-items:center;gap:10px;padding:9px 20px;" +
    "border-bottom:1px solid var(--ds-glass-border);font:500 11.5px/1 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-chat-cuu-toggle{flex:none;margin-right:16px;padding:5px 12px;border-radius:999px;" +
    "border:1px solid var(--ds-glass-border);background:var(--ds-glass);font:600 11px/1.2 var(--ds-font);" +
    "color:var(--ds-ink-muted);cursor:pointer}",
  ".wh-wb-chat-cuu-toggle--on{border-color:rgba(255,171,94,.4);background:var(--wb-cuu-soft);color:var(--wb-cuu)}",
  ".wh-wb-chat-cuu-toggle:disabled{opacity:.6;cursor:default}",
  ".wh-wb-chat-avs{display:flex}",
  // 头像堆叠的描边用白色（新壳体底色本就是近白的浅色玻璃），照 .wh-wb-chat-avatar--cuu/render.ts
  // avatarTileHtml 的深底色块配白字在浅底上依然成立——这条边框只是让重叠头像有「切出来」的轮廓感。
  ".wh-wb-chat-avatar{position:relative;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;" +
    "font:700 10px/1 var(--ds-font);color:#fff;margin-right:-6px;border:1.5px solid #fff;flex:0 0 auto}",
  ".wh-wb-chat-avatar--cuu{background:var(--wb-cuu-soft);color:var(--wb-cuu)}",
  // R14 批 CHAT：presence 在线点——纯 CSS 视觉圆点（绿色 success token），叠在色块右下角、盖在头像照片
  // 之上（z-index 高于 hydrateAvatarPhotos 后插的 <img>）。只有在线成员的 tile 才有这个子元素。
  ".wh-wb-chat-avatar-dot{position:absolute;right:-1px;bottom:-1px;width:8px;height:8px;border-radius:50%;" +
    "background:var(--ds-success);border:1.5px solid #fff;z-index:2}",
  ".wh-wb-chat-avatar--cuu svg{width:12px;height:12px}",
  ".wh-wb-chat-head-label{margin-left:4px}",
  ".wh-wb-chat-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:16px 20px 6px}",
  ".wh-wb-chat-daysep{display:flex;align-items:center;gap:10px;color:var(--ds-ink-faint);font:600 10.5px/1 var(--ds-font);margin:6px 0 14px}",
  ".wh-wb-chat-daysep::before,.wh-wb-chat-daysep::after{content:\"\";flex:1;height:1px;background:var(--ds-glass-border)}",
  ".wh-wb-chat-msg{position:relative;display:flex;gap:9px;margin:0 0 14px;align-items:flex-start}",
  ".wh-wb-chat-bub{min-width:0;max-width:min(560px,86%)}",
  ".wh-wb-chat-msg--self{flex-direction:row-reverse}",
  ".wh-wb-chat-msg--self .wh-wb-chat-bub{text-align:right}",
  ".wh-wb-chat-msg--self .wh-wb-chat-who{flex-direction:row-reverse}",
  ".wh-wb-chat-who{display:flex;align-items:baseline;gap:7px;font:600 12px/1 var(--ds-font);color:var(--ds-ink-soft);margin-bottom:4px}",
  ".wh-wb-chat-tm{font:500 10.5px/1 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-chat-txt{font:500 13px/1.55 var(--ds-font);color:var(--ds-ink);white-space:pre-wrap;word-break:break-word;" +
    "background:var(--ds-glass);border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);padding:9px 12px;display:inline-block;text-align:left}",
  ".wh-wb-chat-msg--cuu .wh-wb-chat-txt{background:var(--wb-cuu-soft);border-color:rgba(255,171,94,.28)}",
  ".wh-wb-chat-msg--self .wh-wb-chat-txt{background:var(--ds-accent-soft);border-color:rgba(10,132,255,.3)}",
  // @提及高亮——原先用 --ds-accent-2（design-system 的浅青色）在深底上够亮，浅底上前景文字对比不够；
  // 这三处（mention/撤回重试链接/展开全文）都是要读的可交互文字，换成 --ds-accent 主蓝（design-system
  // 自己给"高亮/可点文字"用的那个 token，不是新发明的颜色）。
  ".wh-wb-chat-mention{color:var(--ds-accent);font-weight:700}",
  ".wh-wb-chat-msg--pending{opacity:.72}",
  ".wh-wb-chat-pending-status{display:block;margin-top:3px;font:500 10.5px/1.4 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-chat-pending-status--error{color:var(--ds-danger)}",
  ".wh-wb-chat-pending-retry{margin-left:4px;border:0;background:transparent;color:var(--ds-accent);" +
    "font:700 10.5px/1 var(--ds-font);cursor:pointer;padding:0;text-decoration:underline}",
  ".wh-wb-chat-filecard{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:var(--ds-radius-md);" +
    "border:1px solid var(--ds-glass-border);background:var(--ds-glass);cursor:default;font:inherit;color:inherit;text-align:left}",
  ".wh-wb-chat-filecard svg{width:15px;height:15px;color:var(--ds-ink-muted);flex:0 0 auto}",
  ".wh-wb-chat-filecard-name{font:600 12.5px/1.3 var(--ds-font);color:var(--ds-ink)}",
  // R12 批 6：已落库消息的 file_card 可点开右栏预览——发送中的乐观渲染（无 --live 修饰符）继续
  // 保持 cursor:default，不给假点击反馈。
  ".wh-wb-chat-filecard--live{cursor:pointer;transition:background var(--ds-dur-fast) var(--ds-ease),border-color var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-chat-filecard--live:hover{background:var(--ds-glass-strong);border-color:rgba(10,132,255,.3)}",
  ".wh-wb-chat-actioncard{max-width:420px;border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);" +
    "background:var(--wb-cuu-soft);padding:11px 13px}",
  // 产出卡(批 4b,原型 .editcard):与行动卡共用骨架但必须有独立身份——决策卡问"要不要",产出卡说"做完了"。
  ".wh-wb-chat-actioncard--deliverable{border-left:3px solid var(--ds-success);background:linear-gradient(90deg,var(--ds-success-soft),transparent 42%)}",
  ".wh-wb-chat-actioncard--deliverable .wh-wb-chat-actioncard-h{color:var(--ds-ink)}",
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
  ".wh-wb-chat-text-toggle{display:block;margin-top:4px;border:0;background:transparent;color:var(--ds-accent);" +
    "font:700 11px/1 var(--ds-font);cursor:pointer;padding:0;text-decoration:underline}",

  // —— R14 批 CHAT：引用回复块（气泡上方，点击跳原消息）—— //
  ".wh-wb-chat-reply-ref{display:flex;flex-direction:column;gap:1px;max-width:100%;text-align:left;margin:0 0 4px;" +
    "padding:4px 9px;border:0;border-left:2px solid var(--ds-accent);border-radius:6px;background:var(--ds-glass-quiet);" +
    "cursor:pointer;font:inherit;color:inherit}",
  ".wh-wb-chat-reply-ref:hover{background:var(--ds-glass-strong)}",
  ".wh-wb-chat-reply-ref-who{font:700 10.5px/1.3 var(--ds-font);color:var(--ds-accent)}",
  ".wh-wb-chat-reply-ref-text{font:500 11.5px/1.3 var(--ds-font);color:var(--ds-ink-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".wh-wb-chat-reply-ref-gone{font:500 11.5px/1.3 var(--ds-font);color:var(--ds-ink-faint);font-style:italic}",
  ".wh-wb-chat-msg--self .wh-wb-chat-reply-ref{text-align:left}",
  // 「已编辑」灰标（who 行时间之后）。
  ".wh-wb-chat-edited{font:500 10px/1 var(--ds-font);color:var(--ds-ink-faint)}",

  // —— R14 批 CHAT：消息行 hover 工具条（回复/五键反应/编辑/删除/置顶）—— //
  ".wh-wb-chat-tools{position:absolute;top:-12px;right:12px;display:flex;align-items:center;gap:1px;padding:2px;" +
    "border-radius:9px;border:1px solid var(--ds-glass-border);background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(248,250,253,.99));" +
    "box-shadow:0 8px 22px -12px rgba(60,60,67,.4);opacity:0;pointer-events:none;" +
    "transition:opacity var(--ds-dur-fast) var(--ds-ease);z-index:4}",
  ".wh-wb-chat-msg--self .wh-wb-chat-tools{right:auto;left:12px}",
  ".wh-wb-chat-msg:hover .wh-wb-chat-tools,.wh-wb-chat-msg:focus-within .wh-wb-chat-tools{opacity:1;pointer-events:auto}",
  ".wh-wb-chat-tool{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;" +
    "border:0;border-radius:6px;background:transparent;color:var(--ds-ink-muted);cursor:pointer}",
  ".wh-wb-chat-tool:hover{background:var(--ds-glass-strong);color:var(--ds-ink)}",
  ".wh-wb-chat-tool svg{width:14px;height:14px}",
  ".wh-wb-chat-tool--danger:hover{background:var(--ds-danger-soft);color:var(--ds-danger)}",
  ".wh-wb-chat-tool--on{color:var(--ds-accent)}",
  ".wh-wb-chat-tool-emoji{font-size:13px;line-height:1}",
  ".wh-wb-chat-tool--react-on{background:var(--ds-accent-soft)}",

  // —— R14 批 CHAT：气泡下方的反应行（有反应才渲染，own 高亮可点切换）—— //
  ".wh-wb-chat-reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}",
  ".wh-wb-chat-msg--self .wh-wb-chat-reactions{justify-content:flex-end}",
  ".wh-wb-chat-reaction{display:inline-flex;align-items:center;gap:3px;padding:1px 7px;border-radius:999px;" +
    "border:1px solid var(--ds-glass-border);background:var(--ds-glass);cursor:pointer;font:600 11px/1.4 var(--ds-font);color:var(--ds-ink-soft)}",
  ".wh-wb-chat-reaction:hover{background:var(--ds-glass-strong)}",
  ".wh-wb-chat-reaction--mine{border-color:rgba(10,132,255,.4);background:var(--ds-accent-soft);color:var(--ds-accent)}",
  ".wh-wb-chat-reaction-emoji{font-size:12px;line-height:1}",
  ".wh-wb-chat-reaction-count{font-variant-numeric:tabular-nums}",

  // —— R14 批 FEEDBACK：Cuu 文字回复的「有用/没用」轻反馈——字符 tile ✓/✗（非 emoji，见
  // 04-feedback-design.md §8 的第四层视觉语言边界）。工具条按钮变体（同 .wh-wb-chat-tool 底色/尺寸，
  // 只加判定色）+ 持久态徽标（who 行常驻，不依赖 hover）+ 备注编辑行（点徽标展开的极简单行输入）。
  // useful 用既有成功绿语汇（同产出卡终态行 --ds-success），not_useful 故意不用满饱和度 --ds-danger
  // （那是"删除"的强烈警示色），改用 --ds-warn 的弱化语汇，避免抢"删除"按钮的视觉分量。
  ".wh-wb-chat-fb-glyph{font:700 13px/1 var(--ds-font)}",
  ".wh-wb-chat-tool--fb-on-useful{background:var(--ds-success-soft);color:var(--ds-success)}",
  ".wh-wb-chat-tool--fb-on-not-useful{background:var(--ds-warn-soft);color:var(--ds-warn)}",
  ".wh-wb-chat-fb-badge{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;" +
    "margin-left:2px;border:0;border-radius:5px;padding:0;font:700 10px/1 var(--ds-font);cursor:pointer}",
  ".wh-wb-chat-fb-badge:hover{filter:brightness(0.94)}",
  ".wh-wb-chat-fb-badge--useful{background:var(--ds-success-soft);color:var(--ds-success)}",
  ".wh-wb-chat-fb-badge--not-useful{background:var(--ds-warn-soft);color:var(--ds-warn)}",
  ".wh-wb-chat-fb-note{margin-top:6px;max-width:280px}",
  ".wh-wb-chat-fb-note-input{width:100%;box-sizing:border-box;resize:none;min-height:30px;" +
    "border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);background:var(--ds-glass);" +
    "padding:6px 9px;font:500 12px/1.4 var(--ds-font);color:var(--ds-ink);outline:none}",
  ".wh-wb-chat-fb-note-input:focus{border-color:rgba(10,132,255,.4)}",
  ".wh-wb-chat-fb-note-actions{display:flex;gap:6px;margin-top:5px}",

  // 行动卡条目反馈——终态条目行末的独立小 tile 组（不进 hover 工具条，行动卡本身已在整行常驻展示）；
  // class 前缀独立于消息级选择器（wh-wb-chat-actioncard-fb-* vs wh-wb-chat-fb-*），避免混淆。
  ".wh-wb-chat-actioncard-fb{display:inline-flex;gap:3px;margin-left:6px}",
  ".wh-wb-chat-actioncard-fb-tile{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;" +
    "border:1px solid var(--ds-glass-border);border-radius:5px;background:var(--ds-glass);color:var(--ds-ink-muted);" +
    "font:700 11px/1 var(--ds-font);padding:0;cursor:pointer}",
  ".wh-wb-chat-actioncard-fb-tile:hover{background:var(--ds-glass-strong)}",
  ".wh-wb-chat-actioncard-fb-tile--on-useful{background:var(--ds-success-soft);border-color:transparent;color:var(--ds-success)}",
  ".wh-wb-chat-actioncard-fb-tile--on-not-useful{background:var(--ds-warn-soft);border-color:transparent;color:var(--ds-warn)}",

  // —— R14 批 CHAT：行内编辑框 + 删除二次确认 —— //
  ".wh-wb-chat-edit{margin-top:2px}",
  ".wh-wb-chat-edit-input{width:100%;box-sizing:border-box;resize:vertical;min-height:38px;max-height:180px;" +
    "border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);background:var(--ds-glass);" +
    "padding:8px 10px;font:500 13px/1.5 var(--ds-font);color:var(--ds-ink);outline:none}",
  ".wh-wb-chat-edit-input:focus{border-color:rgba(10,132,255,.4)}",
  ".wh-wb-chat-edit-error{margin-top:5px;font:500 11px/1.4 var(--ds-font);color:var(--ds-danger)}",
  ".wh-wb-chat-edit-actions{display:flex;gap:6px;margin-top:6px}",
  ".wh-wb-chat-del-confirm{position:absolute;top:-12px;right:12px;display:flex;align-items:center;gap:6px;padding:5px 9px;" +
    "border-radius:9px;border:1px solid var(--ds-glass-border);background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(248,250,253,.99));" +
    "box-shadow:0 8px 22px -12px rgba(60,60,67,.4);font:600 11.5px/1 var(--ds-font);color:var(--ds-ink-soft);z-index:5}",
  ".wh-wb-chat-msg--self .wh-wb-chat-del-confirm{right:auto;left:12px}",

  // —— R14 批 CHAT：墓碑占位（删除后「此消息已删除」，无头像/动作区）—— //
  ".wh-wb-chat-msg--tombstone{justify-content:center}",
  ".wh-wb-chat-tombstone{font:500 11.5px/1.5 var(--ds-font);color:var(--ds-ink-faint);font-style:italic;padding:2px 0}",

  // —— R14 批 CHAT：跳转命中后的高亮闪烁（引用/置顶/跳到未读共用，1.5s）—— //
  ".wh-wb-chat-msg--flash{animation:ds-chat-flash 1.5s var(--ds-ease)}",
  "@keyframes ds-chat-flash{0%{background:var(--ds-accent-soft)}100%{background:transparent}}",

  // —— R14 批 CHAT：置顶条（聊天区顶部可折叠 pin bar）—— //
  ".wh-wb-chat-pinbar{flex:none}",
  ".wh-wb-chat-pinbar--open{border-bottom:1px solid var(--ds-glass-border)}",
  ".wh-wb-chat-pinbar-head{display:flex;align-items:center;gap:7px;width:100%;box-sizing:border-box;padding:7px 20px;" +
    "border:0;background:var(--ds-glass-quiet);color:var(--ds-ink-muted);font:600 11.5px/1 var(--ds-font);cursor:pointer;text-align:left}",
  ".wh-wb-chat-pinbar-head:hover{background:var(--ds-glass-strong)}",
  ".wh-wb-chat-pinbar-head svg{width:13px;height:13px;flex:0 0 auto}",
  ".wh-wb-chat-pinbar-head-label{flex:1}",
  ".wh-wb-chat-pinbar-chev{display:inline-flex}",
  ".wh-wb-chat-pinbar-chev svg{width:13px;height:13px}",
  ".wh-wb-chat-pin-list{max-height:148px;overflow-y:auto;padding:4px 12px 8px}",
  ".wh-wb-chat-pin-row{display:flex;align-items:center;gap:6px;padding:2px 0}",
  ".wh-wb-chat-pin-jump{flex:1;min-width:0;display:flex;align-items:baseline;gap:7px;padding:5px 8px;border:0;border-radius:7px;" +
    "background:transparent;color:var(--ds-ink);font:inherit;text-align:left;cursor:pointer}",
  ".wh-wb-chat-pin-jump:hover{background:var(--ds-glass)}",
  ".wh-wb-chat-pin-who{font:700 11px/1.3 var(--ds-font);color:var(--ds-ink-soft);flex:0 0 auto}",
  ".wh-wb-chat-pin-text{font:500 12px/1.3 var(--ds-font);color:var(--ds-ink-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".wh-wb-chat-pin-remove{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;" +
    "border:0;border-radius:6px;background:transparent;color:var(--ds-ink-faint);cursor:pointer;flex:0 0 auto}",
  ".wh-wb-chat-pin-remove:hover{background:var(--ds-glass-strong);color:var(--ds-ink)}",
  ".wh-wb-chat-pin-remove svg{width:12px;height:12px}",

  // —— R14 批 CHAT：未读分割线 + 聚合式「已读 N/M」+ 底部「跳到未读」浮钮 —— //
  ".wh-wb-chat-unread-sep{display:flex;align-items:center;gap:10px;margin:6px 0 14px;" +
    "font:700 10.5px/1 var(--ds-font);color:var(--ds-danger)}",
  ".wh-wb-chat-unread-sep::before,.wh-wb-chat-unread-sep::after{content:\"\";flex:1;height:1px;background:rgba(255,69,58,.35)}",
  ".wh-wb-chat-readmark{margin:-8px 0 12px;text-align:right;font:600 10px/1 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-chat-jump-slot{position:relative;flex:none}",
  ".wh-wb-chat-jump-unread{position:absolute;right:16px;bottom:8px;display:inline-flex;align-items:center;gap:3px;" +
    "padding:5px 12px;border-radius:999px;border:1px solid var(--ds-glass-border);" +
    "background:linear-gradient(135deg,#0a84ff,#64d2ff);color:#fff;font:700 11px/1 var(--ds-font);cursor:pointer;" +
    "box-shadow:0 10px 26px -12px rgba(10,132,255,.6);z-index:3}",
  ".wh-wb-chat-jump-unread svg{width:12px;height:12px;transform:rotate(90deg)}",

  // —— R14 批 CHAT：composer 顶部「正在回复 xxx」条 —— //
  ".wh-wb-chat-reply-banner{display:flex;align-items:center;gap:7px;margin-bottom:8px;padding:6px 10px;" +
    "border-radius:var(--ds-radius-md);border:1px solid var(--ds-glass-border);border-left:2px solid var(--ds-accent);" +
    "background:var(--ds-glass);font:600 12px/1.3 var(--ds-font);color:var(--ds-ink-soft)}",
  ".wh-wb-chat-reply-banner svg{width:13px;height:13px;color:var(--ds-accent);flex:0 0 auto}",
  ".wh-wb-chat-reply-banner-label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".wh-wb-chat-reply-banner-cancel{display:inline-flex;border:0;background:transparent;color:var(--ds-ink-faint);cursor:pointer;padding:0}",
  ".wh-wb-chat-reply-banner-cancel svg{width:12px;height:12px}",
  // 观察者「正在整理」指示灯——照 typing 同款，只把点的颜色略偏 Cuu 橙以区分（不是新颜色，用 wb-cuu token）。
  ".wh-wb-chat-typing--observer .wh-wb-chat-typing-dots i{background:var(--wb-cuu)}",

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
    "border-radius:var(--ds-radius-md);border:1px solid rgba(255,69,58,.3);background:var(--ds-danger-soft);" +
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
  ".wh-wb-chat-ctag b{color:var(--ds-accent)}",
  ".wh-wb-chat-ctag:hover{background:var(--ds-glass-strong)}",
  ".wh-wb-chat-ctag--soon{cursor:default;opacity:.55}",
  ".wh-wb-chat-ctag--soon:hover{background:var(--ds-glass-quiet)}",
  ".wh-wb-chat-send{margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;" +
    "border-radius:50%;border:0;background:linear-gradient(135deg,#0a84ff,#64d2ff);color:#fff;cursor:pointer}",
  ".wh-wb-chat-send svg{width:13px;height:13px}",
  ".wh-wb-chat-send:disabled{opacity:.35;cursor:default;background:var(--ds-glass)}",

  // —— @ picker / 「即将可用」占位 picker —— //
  ".wh-wb-chat-picker{position:absolute;left:12px;right:12px;bottom:calc(100% + 8px);max-height:220px;overflow-y:auto;" +
    "border-radius:var(--ds-radius-md);border:1px solid var(--ds-glass-border);" +
    "background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(248,250,253,.99));box-shadow:0 20px 50px -20px rgba(60,60,67,.35);padding:6px}",
  ".wh-wb-chat-picker-section-title{padding:6px 8px 3px;font:700 10px/1 var(--ds-font);letter-spacing:.08em;" +
    "text-transform:uppercase;color:var(--ds-ink-faint)}",
  ".wh-wb-chat-picker-row{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:6px 8px;" +
    "border:0;border-radius:8px;background:transparent;color:var(--ds-ink);font:500 12.5px/1.3 var(--ds-font);text-align:left;cursor:pointer}",
  ".wh-wb-chat-picker-row:hover{background:rgba(20,30,50,.05)}",
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
  ".wh-wb-drive-upload-label:hover{background:var(--ds-accent-soft);border-color:rgba(10,132,255,.3)}",
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
  ".wh-wb-act--danger:hover{background:var(--ds-danger-soft);border-color:rgba(255,69,58,.35);color:var(--ds-danger)}",
  ".wh-wb-drive-empty{padding:36px 20px;text-align:center;font:500 12.5px/1.6 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-drive-action-error{margin:6px 18px;padding:8px 12px;border-radius:var(--ds-radius-sm);" +
    "background:var(--ds-danger-soft);border:1px solid rgba(255,69,58,.3);color:var(--ds-danger);font:500 12px/1.4 var(--ds-font)}",
  ".wh-wb-drive-side-head{display:flex;align-items:center;gap:8px;padding:0 0 8px;border-bottom:1px solid var(--ds-glass-border);margin-bottom:10px}",
  ".wh-wb-drive-side-title{font:700 12.5px/1.3 var(--ds-font);color:var(--ds-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".wh-wb-drive-side-note{font:500 11px/1.5 var(--ds-font);color:var(--ds-ink-faint);margin:4px 0 8px}",
  ".wh-wb-drive-side-idle{padding:22px 6px;font:500 12px/1.6 var(--ds-font);color:var(--ds-ink-faint);text-align:center}",
  ".wh-wb-drive-side-item{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:var(--ds-radius-sm);" +
    "background:var(--ds-glass);border:1px solid var(--ds-glass-border);margin-bottom:8px;font:500 12px/1.5 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-drive-side-error{padding:8px 10px;border-radius:var(--ds-radius-sm);background:var(--ds-danger-soft);" +
    "border:1px solid rgba(255,69,58,.3);color:var(--ds-danger);font:500 12px/1.5 var(--ds-font)}",
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
  ".wh-wb-drive-restore-btn:hover{background:var(--ds-accent-soft);border-color:rgba(10,132,255,.3)}",
  // R14（网盘回滚两端对齐）：两段式确认的第一下——按钮翻成警示色催促再点一次，下方补一句真实语义提示。
  ".wh-wb-drive-restore-btn--armed{background:var(--ds-warn-soft,rgba(255,159,10,.14));border-color:rgba(255,159,10,.4);color:var(--ds-warn)}",
  ".wh-wb-drive-version-confirm-pending{display:flex;align-items:flex-start;gap:6px;margin-top:4px;font:500 11.5px/1.4 var(--ds-font);color:var(--ds-warn)}",
  ".wh-wb-drive-version-confirm{display:flex;align-items:center;gap:6px;margin-top:4px;font:500 11.5px/1.4 var(--ds-font);color:var(--ds-warn)}",
  ".wh-wb-drive-version-error{margin-top:4px;font:500 11.5px/1.4 var(--ds-font);color:var(--ds-danger)}",

  // —— R12（模式五档弹层，仅协同会话 composer）：照 prototype 的 .power chip / #powerPop 弹层观感——
  // 玻璃底/圆角/选中态复用既有 --ds-glass*/--ds-radius-*/--wb-cuu* token，第 5 档警示变体复用
  // --ds-warn*。R13 批 V1：弹层不透明兜底改浅色渐变（同 .wh-wb-modal/.wh-wb-chat-picker 的处理），
  // 不是"看起来透明实际乳白"——04 §4-2 铁律：透明 Tauri 窗里 backdrop-filter 是空操作，这里的
  // linear-gradient 浅色底才是真正的不透明兜底。 —— //
  ".wh-wb-mode-chip{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font:600 11px/1 var(--ds-font);" +
    "color:var(--ds-ink-muted);padding:4px 10px;border-radius:var(--ds-radius-pill);border:1px solid var(--ds-glass-border);" +
    "background:transparent;cursor:pointer;white-space:nowrap;transition:background var(--ds-dur-fast) var(--ds-ease)," +
    "color var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-mode-chip:hover{color:var(--ds-ink);background:var(--ds-glass)}",
  ".wh-wb-mode-chip-lv{color:var(--wb-cuu)}",
  ".wh-wb-mode-chip--warn{color:var(--ds-warn);border-color:rgba(255,159,10,.45);background:var(--ds-warn-soft)}",
  ".wh-wb-mode-chip--warn .wh-wb-mode-chip-lv{color:var(--ds-warn)}",
  ".wh-wb-mode-pop{position:absolute;right:0;bottom:calc(100% + 8px);width:280px;z-index:6;box-sizing:border-box;" +
    "background:linear-gradient(180deg,rgba(255,255,255,.97),rgba(248,250,253,.98));border:1px solid var(--ds-glass-border);" +
    "border-radius:var(--ds-radius-lg);padding:14px;box-shadow:0 20px 60px -22px rgba(60,60,67,.4)}",
  ".wh-wb-mode-pop-title{font:700 12.5px/1.3 var(--ds-font);color:var(--ds-ink);margin-bottom:3px}",
  ".wh-wb-mode-pop-sub{font:500 11px/1.5 var(--ds-font);color:var(--ds-ink-muted);margin-bottom:11px}",
  ".wh-wb-mode-lvl{display:flex;align-items:flex-start;gap:9px;padding:8px 9px;border-radius:var(--ds-radius-sm);" +
    "cursor:pointer;border:1px solid transparent;transition:background var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-mode-lvl:hover{background:rgba(20,30,50,.05)}",
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
  ".wh-wb-mode-lvl--warn.wh-wb-mode-lvl--on{background:var(--ds-warn-soft);border-color:rgba(255,159,10,.35)}",
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

  // —— R14 批 APPROVE-CHAT：右栏提议详情（proposal/render.ts，第四个 owner）+ 产出卡「看提议」按钮 +
  // 军团输出行按钮化。全部独立追加（css.test.ts 的既有精确断言锁死旧规则字符串，只加不改），wh-wb-prop-*
  // 新前缀，视觉语言对齐 drive/army 侧栏（--ds-* 浅色玻璃 token）。 —— //
  ".wh-wb-chat-actioncard-actions{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
  ".wh-wb-chat-actioncard-open{font:600 12px/1 var(--ds-font);padding:6px 12px;border-radius:99px;" +
    "border:1px solid var(--ds-glass-border);background:var(--ds-glass);color:var(--ds-accent);cursor:pointer}",
  ".wh-wb-chat-actioncard-open:hover{background:var(--ds-glass-strong)}",
  // R15 批 A6：产出卡内联批准/打回——批准是主按钮（accent 实底白字），打回是轻按钮（打开右栏写理由，
  // 不内联提交）。忙态/落定后置灰不可点，同 spotlight markBusy 手感。
  ".wh-wb-chat-actioncard-approve{font:600 12px/1 var(--ds-font);padding:6px 12px;border-radius:99px;border:1px solid var(--ds-accent);" +
    "background:var(--ds-accent);color:#fff;cursor:pointer}",
  ".wh-wb-chat-actioncard-approve:hover{filter:brightness(1.05)}",
  ".wh-wb-chat-actioncard-approve:disabled{opacity:.55;cursor:default;filter:none}",
  ".wh-wb-chat-actioncard-deny{font:600 12px/1 var(--ds-font);padding:6px 12px;border-radius:99px;" +
    "border:1px solid var(--ds-glass-border);background:var(--ds-glass);color:var(--ds-ink-soft);cursor:pointer}",
  ".wh-wb-chat-actioncard-deny:hover{background:var(--ds-danger-soft);border-color:rgba(255,69,58,.35);color:var(--ds-danger)}",
  ".wh-wb-chat-actioncard-deny:disabled{opacity:.55;cursor:default}",
  // 军团输出行翻成 <button>（原 <details> 折叠）后仍复用 .wh-wb-army-out-* 的内部布局类——按钮宿主自己
  // 要抹掉 UA 默认样式并接住原来 summary 的 flex 布局。
  ".wh-wb-army-out-row--link{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;" +
    "padding:8px 10px;font:inherit;color:inherit;text-align:left;cursor:pointer}",
  ".wh-wb-prop{display:flex;flex-direction:column;gap:10px}",
  ".wh-wb-prop-back{align-self:flex-start;font:600 12px/1 var(--ds-font);color:var(--ds-ink-muted);border:0;" +
    "background:transparent;padding:2px 0;cursor:pointer}",
  ".wh-wb-prop-back:hover{color:var(--ds-ink)}",
  ".wh-wb-prop-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
  ".wh-wb-prop-risk{font:600 10.5px/1 var(--ds-font);padding:3px 8px;border-radius:99px;" +
    "background:var(--ds-glass);color:var(--ds-ink-muted);border:1px solid var(--ds-glass-border)}",
  ".wh-wb-prop-risk--medium{background:var(--ds-warn-soft);color:var(--ds-warn);border-color:transparent}",
  ".wh-wb-prop-risk--high{background:var(--ds-danger-soft);color:var(--ds-danger);border-color:transparent}",
  ".wh-wb-prop-title{margin:0;font:700 13.5px/1.4 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-prop-summary,.wh-wb-prop-change{border:1px solid var(--ds-glass-border);background:var(--ds-glass);" +
    "border-radius:var(--ds-radius-sm);padding:9px 10px}",
  ".wh-wb-prop-change-head{display:flex;align-items:center;gap:7px;margin-bottom:5px;min-width:0}",
  ".wh-wb-prop-chip{font:600 10px/1 var(--ds-font);padding:2px 7px;border-radius:99px;flex:0 0 auto;" +
    "background:var(--ds-accent-soft);color:var(--ds-accent)}",
  ".wh-wb-prop-change-path{font:500 11px/1.4 var(--ds-font);color:var(--ds-ink-faint);overflow:hidden;" +
    "text-overflow:ellipsis;white-space:nowrap}",
  ".wh-wb-prop-change-sum{font:500 12px/1.6 var(--ds-font);color:var(--ds-ink-soft)}",
  ".wh-wb-prop-changes{display:flex;flex-direction:column;gap:8px}",
  ".wh-wb-prop-diff{margin-top:7px;border-radius:8px;overflow:hidden;font:500 11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}",
  ".wh-wb-prop-diff-line{padding:4px 8px;word-break:break-all}",
  ".wh-wb-prop-diff-line--del{background:var(--ds-danger-soft);color:var(--ds-danger)}",
  ".wh-wb-prop-diff-line--add{background:var(--ds-success-soft);color:#1f8f3f}",
  ".wh-wb-prop-checks{display:flex;flex-wrap:wrap;gap:6px}",
  ".wh-wb-prop-check{font:500 10.5px/1.5 var(--ds-font);padding:3px 8px;border-radius:99px;" +
    "background:var(--ds-glass);color:var(--ds-ink-muted);border:1px solid var(--ds-glass-border)}",
  ".wh-wb-prop-check--passed{background:var(--ds-success-soft);color:#1f8f3f;border-color:transparent}",
  ".wh-wb-prop-check--failed{background:var(--ds-danger-soft);color:var(--ds-danger);border-color:transparent}",
  ".wh-wb-prop-check--warning{background:var(--ds-warn-soft);color:var(--ds-warn);border-color:transparent}",
  ".wh-wb-prop-actions{display:flex;flex-direction:column;gap:8px;margin-top:2px}",
  ".wh-wb-prop-note{margin:0;font:500 11px/1.6 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-prop-act{font:600 12.5px/1 var(--ds-font);padding:9px 14px;border-radius:99px;cursor:pointer;" +
    "border:1px solid var(--ds-glass-border);background:var(--ds-glass);color:var(--ds-ink)}",
  ".wh-wb-prop-act:hover{background:var(--ds-glass-strong)}",
  ".wh-wb-prop-act:disabled{opacity:.5;cursor:default}",
  ".wh-wb-prop-act--primary{border:0;color:#fff;background:linear-gradient(135deg,#0a84ff,#64d2ff);" +
    "box-shadow:var(--ds-shadow-glow);font-weight:700}",
  ".wh-wb-prop-act--danger{border-color:transparent;background:var(--ds-danger-soft);color:var(--ds-danger)}",
  ".wh-wb-prop-act--ghost{color:var(--ds-ink-muted);background:transparent;border-color:transparent}",
  ".wh-wb-prop-status{font:600 11px/1 var(--ds-font);padding:5px 10px;border-radius:99px;align-self:flex-start;" +
    "background:var(--ds-glass);color:var(--ds-ink-muted);border:1px solid var(--ds-glass-border)}",
  ".wh-wb-prop-status--merged{background:var(--ds-success-soft);color:#1f8f3f;border-color:transparent}",
  ".wh-wb-prop-status--rejected{background:var(--ds-danger-soft);color:var(--ds-danger);border-color:transparent}",
  ".wh-wb-prop-reasons{display:flex;flex-direction:column;gap:8px;border:1px solid var(--ds-glass-border);" +
    "background:var(--ds-glass);border-radius:var(--ds-radius-sm);padding:10px}",
  ".wh-wb-prop-reasons-q{margin:0;font:700 11.5px/1 var(--ds-font);color:var(--ds-ink-soft)}",
  ".wh-wb-prop-reasons-row{display:flex;flex-wrap:wrap;gap:6px}",
  ".wh-wb-prop-reason{font:500 11px/1 var(--ds-font);padding:5px 10px;border-radius:99px;cursor:pointer;" +
    "border:1px solid var(--ds-glass-border);background:transparent;color:var(--ds-ink-muted)}",
  '.wh-wb-prop-reason[data-sel="true"]{background:var(--ds-danger-soft);color:var(--ds-danger);border-color:transparent}',
  ".wh-wb-prop-reason-text{font:500 12px/1.6 var(--ds-font);color:var(--ds-ink);border:1px solid var(--ds-glass-border);" +
    "border-radius:var(--ds-radius-sm);background:rgba(255,255,255,.8);padding:8px 10px;resize:vertical;min-height:56px}",
  ".wh-wb-prop-reason-text:focus{outline:none;border-color:var(--ds-accent);box-shadow:0 0 0 3px var(--ds-accent-soft)}",
  ".wh-wb-prop-reason-error{margin:0;font:500 11px/1.4 var(--ds-font);color:var(--ds-danger)}",
  ".wh-wb-prop-reason-error:empty{display:none}",
  ".wh-wb-prop-reason-actions{display:flex;justify-content:flex-end}",
  ".wh-wb-prop-notice{display:flex;align-items:center;gap:8px;justify-content:space-between;" +
    "font:500 11.5px/1.5 var(--ds-font);border-radius:var(--ds-radius-sm);padding:8px 10px}",
  ".wh-wb-prop-notice--permission{background:var(--ds-warn-soft);color:var(--ds-warn)}",
  ".wh-wb-prop-notice--conflict{background:var(--ds-warn-soft);color:var(--ds-warn)}",
  ".wh-wb-prop-notice--network{background:var(--ds-danger-soft);color:var(--ds-danger)}",
  ".wh-wb-prop-loading{display:flex;align-items:center;gap:9px;font:500 12px/1 var(--ds-font);color:var(--ds-ink-faint);padding:8px 0}",
  ".wh-wb-prop-error{display:flex;flex-direction:column;gap:10px;align-items:flex-start}",
  ".wh-wb-prop-error-msg{margin:0;font:500 12px/1.6 var(--ds-font);color:var(--ds-ink-muted)}",

  "@media (prefers-reduced-motion:reduce){.wh-wb-side,.wh-wb-winbtn,.wh-wb-project-row,.wh-wb-leaf,.wh-wb-btn," +
    ".wh-wb-chat-ctag,.wh-wb-chat-typing-dots i{transition-duration:.01ms!important;animation-duration:.01ms!important}}",
  // 独立追加一条规则，而不是塞进上面那条既有选择器列表——那条字符串被 css.test.ts 的既有测试按
  // 精确子串匹配锁死（04 §4 铁律 1：不许为了迁就实现去改断言），追加新选择器会破坏它的匹配。
  "@media (prefers-reduced-motion:reduce){.wh-wb-mode-chip,.wh-wb-mode-lvl{transition-duration:.01ms!important;animation-duration:.01ms!important}}",
  // R14 批 CHAT：hover 工具条淡入与跳转高亮闪烁——reduced-motion 下都收成瞬时（同上，独立一条规则）。
  "@media (prefers-reduced-motion:reduce){.wh-wb-chat-tools,.wh-wb-chat-msg--flash{transition-duration:.01ms!important;animation-duration:.01ms!important}}",

  // —— R14 批 RISK（风险预警巡检）—— //
  // 项目设置 · 风险巡检分区：四个阈值输入排成两列网格（同 .wh-wb-pset-group 的浅色玻璃卡片语言，
  // 沿用既有 .wh-wb-pset-num/.wh-wb-pset-inline-k，这里只补外层网格与字段标签的排布规则）。
  ".wh-wb-risk-set-fields{margin-top:11px;display:grid;grid-template-columns:1fr 1fr;gap:10px 16px}",
  ".wh-wb-risk-set-field{display:flex;flex-direction:column;gap:5px}",
  // 聊天区 risk_digest 专属卡——沿用产出卡（.wh-wb-chat-actioncard--deliverable）的骨架，警示语汇
  // 换成 --ds-warn（这是「该看一眼」的提醒，不是失败/危险，用红色会喧宾夺主）。
  ".wh-wb-risk-digest{border-left:3px solid var(--ds-warn);background:linear-gradient(90deg,var(--ds-warn-soft),transparent 42%)}",
  ".wh-wb-risk-digest-list{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}",
  ".wh-wb-risk-digest-item{font:600 11.5px/1.5 var(--ds-font);color:var(--ds-ink-soft)}",

  // —— R15 批 E2（项目时间线 / 甘特）—— //
  // 纯 CSS 甘特：每行两列（左 260px 元信息/控件 + 右 1fr 排期条轨道），顶部周刻度轴与轨道列左对齐。
  ".wh-wb-center--timeline{padding:0}",
  ".wh-wb-tl{display:flex;flex-direction:column;height:100%;min-height:0}",
  ".wh-wb-tl-bar{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--ds-glass-border);flex:0 0 auto}",
  ".wh-wb-tl-bar-title{font:700 14px/1.2 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-tl-bar-spacer{flex:1}",
  ".wh-wb-tl-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:9px;border:1px solid var(--ds-glass-border);" +
    "background:var(--ds-glass);color:var(--ds-ink);font:600 12px/1.3 var(--ds-font);cursor:pointer;" +
    "transition:background var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-tl-btn svg{width:13px;height:13px}",
  ".wh-wb-tl-btn:hover{background:var(--ds-glass-strong)}",
  ".wh-wb-tl-btn--primary{background:var(--ds-accent-soft);border-color:rgba(10,132,255,.28);color:var(--ds-accent)}",
  ".wh-wb-tl-btn[disabled]{opacity:.5;cursor:default}",
  ".wh-wb-tl-errbar{margin:10px 18px 0;padding:8px 12px;border-radius:var(--ds-radius-sm);background:var(--ds-danger-soft);" +
    "border:1px solid rgba(255,69,58,.3);color:var(--ds-danger);font:500 12px/1.5 var(--ds-font)}",
  // 关键路径警示区（逾期且卡着别人）——置顶、暖警示玻璃。
  ".wh-wb-tl-crit{margin:12px 18px 0;padding:11px 14px;border-radius:var(--ds-radius-md);background:var(--ds-warn-soft);" +
    "border:1px solid rgba(224,137,42,.32)}",
  ".wh-wb-tl-crit-head{font:700 12px/1.3 var(--ds-font);color:var(--ds-warn);margin-bottom:8px}",
  ".wh-wb-tl-crit-body{display:flex;flex-wrap:wrap;gap:6px}",
  ".wh-wb-tl-crit-chip{padding:4px 9px;border-radius:99px;border:1px solid rgba(224,137,42,.4);background:var(--ds-glass);" +
    "color:var(--ds-ink);font:600 11px/1.3 var(--ds-font);cursor:pointer}",
  ".wh-wb-tl-crit-chip:hover{background:var(--ds-warn-soft)}",
  ".wh-wb-tl-nodates{margin:12px 18px 0;font:500 12px/1.6 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-tl-scroll{flex:1 1 auto;min-height:0;overflow:auto;padding:0 18px 20px}",
  // 周刻度轴：与轨道列（左偏 260px）对齐；刻度绝对定位，稀疏标注。
  ".wh-wb-tl-axis{position:sticky;top:0;z-index:2;height:26px;margin:6px 0 4px 260px;border-bottom:1px solid var(--ds-glass-border);" +
    "background:var(--ds-glass-quiet)}",
  ".wh-wb-tl-tick{position:absolute;top:0;bottom:0;border-left:1px solid var(--ds-glass-border)}",
  ".wh-wb-tl-tick-label{position:absolute;top:5px;left:3px;font:600 10px/1 var(--ds-font);color:var(--ds-ink-faint);white-space:nowrap}",
  ".wh-wb-tl-today{position:absolute;top:0;bottom:0;width:0;border-left:1.5px dashed var(--ds-danger);opacity:.7;pointer-events:none}",
  // 里程碑分组。
  ".wh-wb-tl-group{margin-top:10px}",
  ".wh-wb-tl-group-body{display:flex;flex-direction:column}",
  ".wh-wb-tl-group-empty{padding:8px 0 8px 260px;font:500 11.5px/1.5 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-tl-mhead{display:flex;align-items:center;gap:8px;padding:8px 6px;border-radius:var(--ds-radius-sm);background:var(--ds-glass);" +
    "border:1px solid var(--ds-glass-border)}",
  ".wh-wb-tl-mhead--loose{background:transparent;border-color:transparent}",
  ".wh-wb-tl-mhead.is-done .wh-wb-tl-mtitle{color:var(--ds-ink-faint);text-decoration:line-through}",
  ".wh-wb-tl-mflag svg{width:14px;height:14px;color:var(--ds-accent)}",
  ".wh-wb-tl-mtitle{font:700 12.5px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-tl-mdue{font:600 11px/1.2 var(--ds-font);color:var(--ds-ink-muted);background:var(--ds-glass-strong);padding:2px 7px;border-radius:99px}",
  ".wh-wb-tl-mdue--none{color:var(--ds-ink-faint);background:transparent}",
  ".wh-wb-tl-mdone{font:600 10px/1.2 var(--ds-font);color:var(--ds-success);background:var(--ds-success-soft);padding:2px 7px;border-radius:99px}",
  ".wh-wb-tl-mspacer{flex:1}",
  ".wh-wb-tl-icbtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;border-radius:7px;" +
    "background:transparent;color:var(--ds-ink-faint);cursor:pointer;transition:background var(--ds-dur-fast) var(--ds-ease)}",
  ".wh-wb-tl-icbtn svg{width:14px;height:14px}",
  ".wh-wb-tl-icbtn:hover{background:rgba(20,30,50,.06);color:var(--ds-ink)}",
  ".wh-wb-tl-icbtn--danger:hover{background:var(--ds-danger-soft);color:var(--ds-danger)}",
  ".wh-wb-tl-icbtn[disabled]{opacity:.4;cursor:default}",
  // 里程碑内联表单。
  ".wh-wb-tl-mform{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 6px}",
  ".wh-wb-tl-mform-title{flex:1 1 160px;min-width:120px;padding:6px 10px;border-radius:8px;border:1px solid var(--ds-glass-border);" +
    "background:var(--ds-glass);color:var(--ds-ink);font:500 12.5px/1.3 var(--ds-font)}",
  ".wh-wb-tl-mform-due{padding:5px 8px;border-radius:8px;border:1px solid var(--ds-glass-border);background:var(--ds-glass);" +
    "color:var(--ds-ink);font:500 12px/1.3 var(--ds-font)}",
  // 工作项行。
  ".wh-wb-tl-row{display:grid;grid-template-columns:260px 1fr;gap:10px;align-items:center;padding:7px 0;border-top:1px solid var(--ds-glass-hairline)}",
  ".wh-wb-tl-row:first-child{border-top:0}",
  ".wh-wb-tl-row--flash{animation:ds-flash 1.4s var(--ds-ease)}",
  ".wh-wb-tl-rowmeta{display:flex;flex-direction:column;gap:4px;min-width:0}",
  ".wh-wb-tl-rowtitle{display:flex;align-items:center;gap:6px;min-width:0}",
  ".wh-wb-tl-code{font:700 11px/1.2 var(--ds-font);color:var(--ds-accent);flex:0 0 auto}",
  ".wh-wb-tl-name{font:600 12.5px/1.35 var(--ds-font);color:var(--ds-ink);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-wb-tl-rowtags{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
  ".wh-wb-tl-status{font:600 10px/1.3 var(--ds-font);color:var(--ds-ink-muted);background:var(--ds-glass-strong);padding:2px 7px;border-radius:99px}",
  ".wh-wb-tl-status--done,.wh-wb-tl-status--merged{color:var(--ds-success);background:var(--ds-success-soft)}",
  ".wh-wb-tl-status--cancelled{color:var(--ds-ink-faint)}",
  ".wh-wb-tl-status--escalated{color:var(--ds-warn);background:var(--ds-warn-soft)}",
  ".wh-wb-tl-assignee{font:500 10.5px/1.3 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-tl-assignee--none{color:var(--ds-ink-faint)}",
  ".wh-wb-tl-blocks{font:600 10px/1.3 var(--ds-font);color:var(--ds-warn);background:var(--ds-warn-soft);padding:2px 7px;border-radius:99px}",
  ".wh-wb-tl-rowctl{display:flex;gap:6px;align-items:center}",
  ".wh-wb-tl-attach,.wh-wb-tl-dep-add{max-width:100%;padding:3px 6px;border-radius:7px;border:1px solid var(--ds-glass-border);" +
    "background:var(--ds-glass);color:var(--ds-ink-muted);font:500 11px/1.3 var(--ds-font);cursor:pointer}",
  ".wh-wb-tl-deps{display:flex;flex-wrap:wrap;gap:5px;align-items:center}",
  ".wh-wb-tl-dep{display:inline-flex;align-items:center;gap:3px;font:600 10px/1.3 var(--ds-font);color:var(--ds-ink-muted);" +
    "background:var(--ds-glass-strong);padding:2px 4px 2px 7px;border-radius:99px}",
  ".wh-wb-tl-dep-x{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border:0;border-radius:50%;" +
    "background:transparent;color:var(--ds-ink-faint);cursor:pointer;padding:0}",
  ".wh-wb-tl-dep-x svg{width:10px;height:10px}",
  ".wh-wb-tl-dep-x:hover{background:var(--ds-danger-soft);color:var(--ds-danger)}",
  // OKR tile（E2b）——就近挂在行标题右侧。
  ".wh-wb-tl-okr{display:inline-flex;align-items:center;gap:3px;font:700 9.5px/1.3 var(--ds-font);color:var(--ds-accent-2,var(--ds-accent));" +
    "background:var(--ds-accent-soft);padding:1px 6px;border-radius:99px;flex:0 0 auto;cursor:default}",
  // 排期条轨道 + 条。
  ".wh-wb-tl-track{position:relative;height:22px;min-width:120px}",
  ".wh-wb-tl-gbar{position:absolute;top:4px;height:14px;min-width:5px;border-radius:7px;background:var(--ds-accent);box-shadow:var(--ds-shadow-1)}",
  ".wh-wb-tl-gbar--overdue{background:var(--ds-danger)}",
  ".wh-wb-tl-gbar--done{background:var(--ds-ink-faint)}",
  ".wh-wb-tl-gbar--ghost{background:transparent;border:1.5px dashed var(--ds-accent);box-shadow:none}",
  ".wh-wb-tl-gbar--overdue.wh-wb-tl-gbar--ghost{border-color:var(--ds-danger)}",
  ".wh-wb-tl-gbar--done.wh-wb-tl-gbar--ghost{border-color:var(--ds-ink-faint)}",
  ".wh-wb-tl-unscheduled{position:absolute;top:3px;left:0;font:500 10.5px/1.4 var(--ds-font);color:var(--ds-ink-faint);font-style:italic}",
  // 状态/空态。
  ".wh-wb-tl-state{padding:40px 20px;text-align:center;font:500 13px/1.6 var(--ds-font);color:var(--ds-ink-muted);" +
    "display:flex;flex-direction:column;align-items:center;gap:10px}",
  ".wh-wb-tl-state--error{color:var(--ds-ink-muted)}",
  ".wh-wb-tl-empty{padding:48px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px}",
  ".wh-wb-tl-empty-icon svg{width:34px;height:34px;color:var(--ds-ink-faint)}",
  ".wh-wb-tl-empty-title{margin:6px 0 0;font:700 16px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-tl-empty-sub{margin:0;max-width:420px;font:500 13px/1.6 var(--ds-font);color:var(--ds-ink-muted)}",
  ".wh-wb-tl-empty-note{margin:4px 0 0;font:500 11.5px/1.5 var(--ds-font);color:var(--ds-ink-faint)}",

  // ===== R16 批 W2：任务看板（四列 · 拖拽派发）=====
  ".wh-wb-center--kanban{padding:0}",
  ".wh-wb-kb{display:flex;flex-direction:column;height:100%;min-height:0}",
  ".wh-wb-kb-top{flex:0 0 auto;display:flex;align-items:baseline;gap:12px;padding:12px 18px 10px;flex-wrap:wrap}",
  ".wh-wb-kb-total{font:700 15px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-kb-hint{font:500 11.5px/1.4 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-kb-notice{margin:0 18px 8px;padding:8px 12px;border-radius:var(--ds-radius-sm);font:600 12px/1.5 var(--ds-font)}",
  ".wh-wb-kb-notice--info{background:var(--ds-accent-soft);color:var(--ds-accent);border:1px solid rgba(10,132,255,.24)}",
  ".wh-wb-kb-notice--error{background:var(--ds-danger-soft);color:var(--ds-danger);border:1px solid rgba(255,69,58,.24)}",
  ".wh-wb-kb-board{flex:1 1 auto;min-height:0;display:flex;gap:13px;align-items:flex-start;overflow-x:auto;overflow-y:hidden;padding:0 18px 18px}",
  ".wh-wb-kb-col{width:262px;flex:none;display:flex;flex-direction:column;max-height:100%;min-height:0;" +
    "background:var(--ds-glass-quiet);border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-md);box-shadow:var(--ds-shadow-1)}",
  ".wh-wb-kb-col-head{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 12px 8px}",
  ".wh-wb-kb-dot{width:8px;height:8px;border-radius:50%;flex:none}",
  ".wh-wb-kb-col-name{font:600 12.5px/1 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-kb-col-count{font:700 10.5px/1 var(--ds-font);color:var(--ds-ink-faint);background:var(--ds-glass);border-radius:99px;" +
    "min-width:18px;height:17px;padding:0 6px;display:flex;align-items:center;justify-content:center}",
  ".wh-wb-kb-col-list{flex:1 1 auto;min-height:56px;overflow-y:auto;padding:2px 9px 11px;display:flex;flex-direction:column;gap:8px}",
  ".wh-wb-kb-col-list--over{background:var(--ds-accent-soft);border-radius:10px;outline:2px dashed rgba(10,132,255,.4);outline-offset:-4px}",
  ".wh-wb-kb-col-empty{padding:14px 8px;text-align:center;font:500 11px/1.5 var(--ds-font);color:var(--ds-ink-faint)}",
  ".wh-wb-kb-card{background:var(--ds-glass-strong);border:1px solid var(--ds-glass-border);border-radius:var(--ds-radius-sm);" +
    "box-shadow:var(--ds-shadow-1);padding:10px 11px;cursor:grab;transition:box-shadow var(--ds-dur-fast,120ms) var(--ds-ease,ease)}",
  ".wh-wb-kb-card:hover{box-shadow:var(--ds-shadow-2)}",
  ".wh-wb-kb-card:active{cursor:grabbing}",
  ".wh-wb-kb-card:focus-visible{outline:2px solid var(--ds-accent);outline-offset:1px}",
  ".wh-wb-kb-card--dragging{opacity:.4}",
  ".wh-wb-kb-card--over{border-left:3px solid var(--ds-danger)}",
  ".wh-wb-kb-card-title{font:600 12.5px/1.4 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-kb-card-meta{display:flex;align-items:center;gap:7px;margin-top:7px}",
  ".wh-wb-kb-code{font:600 10px/1.3 var(--ds-mono,ui-monospace,monospace);color:var(--ds-ink-faint)}",
  ".wh-wb-kb-status{font:600 9.5px/1.3 var(--ds-font);color:var(--ds-ink-muted);background:var(--ds-glass);border:1px solid var(--ds-glass-border);" +
    "padding:1px 6px;border-radius:99px}",
  ".wh-wb-kb-status--escalated{color:var(--ds-danger);background:var(--ds-danger-soft)}",
  ".wh-wb-kb-status--in_review{color:var(--ds-warn);background:var(--ds-warn-soft)}",
  ".wh-wb-kb-status--done,.wh-wb-kb-status--merged{color:var(--ds-success);background:var(--ds-success-soft)}",
  ".wh-wb-kb-card-foot{display:flex;align-items:center;gap:8px;margin-top:8px;color:var(--ds-ink-faint);font:500 11px/1 var(--ds-font)}",
  ".wh-wb-kb-due{display:inline-flex;align-items:center;gap:4px}",
  ".wh-wb-kb-due--over{color:var(--ds-danger)}",
  ".wh-wb-kb-due--none{color:var(--ds-ink-faint);font-style:italic}",
  ".wh-wb-kb-overdot{width:6px;height:6px;border-radius:50%;background:var(--ds-danger)}",
  ".wh-wb-kb-blocks{font:600 10px/1.3 var(--ds-font);color:var(--ds-warn);background:var(--ds-warn-soft);padding:1px 6px;border-radius:99px}",
  ".wh-wb-kb-owner{margin-left:auto;display:inline-flex;align-items:center;gap:5px}",
  ".wh-wb-kb-owner--none{font-style:italic}",
  ".wh-wb-kb-av{width:19px;height:19px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;" +
    "font:700 9px/1 var(--ds-font);color:var(--ds-accent);background:var(--ds-accent-soft);border:1px solid var(--ds-glass-border)}",
  ".wh-wb-kb-state{padding:40px 20px;text-align:center;font:500 13px/1.6 var(--ds-font);color:var(--ds-ink-muted);" +
    "display:flex;flex-direction:column;align-items:center;gap:10px}",
  ".wh-wb-kb-empty{padding:48px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px}",
  ".wh-wb-kb-empty-icon svg{width:34px;height:34px;color:var(--ds-ink-faint)}",
  ".wh-wb-kb-empty-title{margin:6px 0 0;font:700 16px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-wb-kb-empty-sub{margin:0;max-width:420px;font:500 13px/1.6 var(--ds-font);color:var(--ds-ink-muted)}",

  "@keyframes ds-flash{0%{background:var(--ds-accent-soft)}100%{background:transparent}}"
].join("");
