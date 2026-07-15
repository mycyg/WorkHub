// WorkHub 桌面 · 工作台 SVG 图标（无 emoji，字符描边风格照 prototype 的 <symbol> 表重绘）。
// 和 command-palette.ts 的 ic() 同一套约定：24x24 viewBox，stroke=currentColor，可内联到任意按钮/行。

function ic(inner: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export const workbenchIcons = {
  chat: ic('<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-4.5 4v-4H6a2 2 0 0 1-2-2Z"/>'),
  collab: ic('<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.4"/><path d="M15 15.4a4.8 4.8 0 0 1 5.5 3.6"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>'),
  folder: ic('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'),
  army: ic('<circle cx="12" cy="5.5" r="2.3"/><circle cx="6" cy="17.5" r="2.3"/><circle cx="18" cy="17.5" r="2.3"/><path d="M10.9 7.6 7.2 15.4M13.1 7.6 16.8 15.4M8.3 17.5h7.4"/>'),
  search: ic('<circle cx="11" cy="11" r="6"/><path d="M15.6 15.6 20 20"/>'),
  close: ic('<path d="M6 6l12 12M18 6L6 18"/>'),
  minimize: ic('<path d="M5 12h14"/>'),
  chevronRight: ic('<path d="M9 6l6 6-6 6"/>'),
  chevronLeft: ic('<path d="M15 6l-6 6 6 6"/>'),
  send: ic('<path d="M4 12 20 4l-7 16-2.5-6.5L4 12Z"/>'),
  cat: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5 10.2V4.6L9.3 7.5C10.2 7.2 11.1 7 12 7c.9 0 1.8.2 2.7.5L19 4.6v5.6a7 7 0 1 1-14 0Zm3.3 2.4a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0Zm5.2 0a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0Z"/></svg>`,
  // R12 批 6（网盘整合 + git 化）：文件行图标 + 版本历史（时钟）+ 已找回确认（对勾）。
  file: ic('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>'),
  history: ic('<circle cx="12" cy="13" r="8"/><path d="M12 9.5V13l2.6 1.6"/><path d="M9 2.5h6"/>'),
  check: ic('<path d="M5 12.5 9.5 17 19 6.5"/>'),
  // R12 批8：无权限深链空态（00 §9）——群聊气泡挂锁图标，替代不存在的 emoji。
  lock: ic('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  // R13 批 P3：rail 项目行的「项目设置」入口（AI 治理表单）——齿轮。
  gear: ic('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.9 1.9M7.4 16.6l-1.9 1.9M18.5 18.5l-1.9-1.9M7.4 7.4 5.5 5.5"/>'),
  // R14 批 CHAT：消息行 hover 工具条 + 置顶条的 SVG 图标（回复/编辑/删除/置顶）——反应键用 emoji 字形
  // （render.ts 的 REACTION_EMOJI），其余动作一律 SVG，不进 emoji。
  reply: ic('<path d="M10 8V4l-7 7 7 7v-4c4.5 0 7.5 1.5 9 5 0-7-3.5-11-9-11Z"/>'),
  edit: ic('<path d="M4 20h4l10-10-4-4L4 16Z"/><path d="M13.5 6.5l4 4"/>'),
  trash: ic('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>'),
  pin: ic('<path d="M9 3h6l-1 6 3 3H7l3-3-1-6Z"/><path d="M12 15v6"/>'),
  // R15 批 E2（项目时间线 / 甘特）：rail 项目行的「时间线」树叶——横向排期条示意（三条错位的甘特条）。
  timeline: ic('<path d="M4 5h10M4 12h14M4 19h7"/><path d="M14 5v0M18 12v0M11 19v0"/>')
} as const;

export type WorkbenchIconKey = keyof typeof workbenchIcons;
