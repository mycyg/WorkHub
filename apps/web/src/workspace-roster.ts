// R23 F-04：实现已搬到 @workhub/web-runtime（桌面聚焦盒的转交选人器要用同一份翻页逻辑，
// 不能再抄一遍）。这里保留再导出，让 web 侧既有 import 路径与单测保持不变。
export {
  fetchWorkspaceRosterMembers,
  type WorkspaceRosterMemberSlice,
  type WorkspaceRosterRequester,
  type WorkspaceRosterVM
} from "@workhub/web-runtime";
