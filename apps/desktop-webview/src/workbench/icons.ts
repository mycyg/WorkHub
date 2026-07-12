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
  cat: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5 10.2V4.6L9.3 7.5C10.2 7.2 11.1 7 12 7c.9 0 1.8.2 2.7.5L19 4.6v5.6a7 7 0 1 1-14 0Zm3.3 2.4a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0Zm5.2 0a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0Z"/></svg>`
} as const;

export type WorkbenchIconKey = keyof typeof workbenchIcons;
