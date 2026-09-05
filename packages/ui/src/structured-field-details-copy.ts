// 结构化字段详情（字段改动详情 / 字段保存记录）的用户可见文案单一来源。
// 文案 locale 独占门禁：含汉字的字面量只许住在词典文件里，见 scripts/dev/check-ui-i18n.ts。

import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";

const zh = {
  items: "项",
  notRecorded: "未记录",
  fieldsUnit: "个字段",
  count: "数量",
  choice: "处理方式",
  baseValue: "原始值",
  currentValue: "当前",
  afterValue: "写入",
  fieldChangeTitle: "字段改动详情",
  restorable: "可还原到改动前",
  writebackTitle: "字段保存记录"
} as const;

const en = {
  items: "items",
  notRecorded: "Not recorded",
  fieldsUnit: "fields",
  count: "Items",
  choice: "Choice",
  baseValue: "Base",
  currentValue: "Current",
  afterValue: "After",
  fieldChangeTitle: "Field-level targets",
  restorable: "Restorable to the state before this change",
  writebackTitle: "Field writeback audit"
} as const satisfies Record<keyof typeof zh, string>;

export type StructuredFieldDetailsCopyKey = keyof typeof zh;

export function structuredFieldDetailsT(locale: WorkHubLocale, key: StructuredFieldDetailsCopyKey): string {
  return (normalizeWorkHubLocale(locale) === "zh-CN" ? zh : en)[key];
}
