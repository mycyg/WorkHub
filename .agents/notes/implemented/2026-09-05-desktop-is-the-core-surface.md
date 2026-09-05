# 桌面端是产品核心面，web 退为备选

- Status: implemented
- Date: 2026-09-05
- Owner: 用户拍板（R23 报告回复）；Claude Fable 指挥家轮执行

## Problem

R23 侦察（SA-01）指出产品最大的自相矛盾：群聊、行动卡认领、私聊、个人空间、时间线编辑等主打功能只在桌面工作台里，web 是刻意的只读镜像；而桌面端既没有打包分发管线，打包后的 CSP 又只放行 127.0.0.1，README「三步走」的自托管用户根本拿不到这些功能。方向必须二选一：让 web 可写，或让桌面端真正能分发、能连远端。

## Decision

桌面端（client-tauri 壳 + apps/desktop-webview 三窗口）是产品核心面，后续投入优先桌面；web 保持「至少可用」的备选地位，不追求与桌面对等。R24 据此落地：
1. 入口：连接服务器屏（地址 + 测试连接 + 显式确认）、首启不再静默用硬编码昵称报到、模式感知的登录/注册/邀请屏、首启「建第一个项目」卡。
2. 连通：打包后 CSP `connect-src` 放开 http/https/ws/wss，配套三道应用层闸（单 origin 钉死、地址只能人工键入确认、换服务器即清令牌）；壳层 `set_server_url` 让 SSE/托盘/通知跟随；令牌迁壳层仍是终局（见 proposed 档案）。
3. 分发：`.github/workflows/desktop-release.yml`（tag 或手动触发，四平台，证书缺失照常出 ad-hoc 产物）、版本单一事实源与门禁、发布脚本、双语下载说明。

## Alternatives considered

- web 可写（R16 工作台重设计方向）：要把 123 个文件的工作台在 web 重做一遍，且桌宠/托盘/全局热键/深链这些桌面独有体验无法复刻。否决。
- 两端对等：投入翻倍，两端漂移已是历史教训（R8–R22 多轮审查反复出现「一端有一端没有」）。否决。
- 保持现状只改文档「桌面端仅支持本机后端」：等于宣布产品核心场景不支持。否决。

## Consequences

- 新功能先做桌面端；web 只保证不坏、不阻断（登录、审批、只读镜像）。
- 桌面端每轮迭代必须真机走查（本机 `pnpm build:desktop-macos` + screencapture），因为 desktop-webview 无法在浏览器预览。
- 分发管线首次四平台干跑（Windows/Linux 从未编译）是最大不确定项，需在合并后用 `workflow_dispatch dry_run=true` 验证并按产物名回校准文档。
- 签名/公证需要用户提供 Apple 开发者账号；在此之前 Release 说明必须写清 Gatekeeper 绕过方式。
