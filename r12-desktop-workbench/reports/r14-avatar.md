# R14 批 AVATAR · 头像与资料入口 · 完成汇报

分支：`r14/avatar`（从 `origin/main` @ `adb241b4` 拉出）
Worktree：`/Users/apple/.codex/worktrees/WorkHub/r14-avatar`

## 做了什么

用户拍板（2026-07-14）：头像功能必须做，且必须支持**用户自己裁剪**（不能只做自动居中裁）。全部落地：

1. **数据层**：`users` 表加 `avatar_webp bytea`（drizzle `customType`，nullable）+ `avatar_updated_at timestamptz`（nullable），迁移 `0054_user_avatar.sql`（`ADD COLUMN IF NOT EXISTS`，重放安全），journal 尾更新为 idx 54。`users` 仓库加 `setAvatar`/`clearAvatar`/`findAvatar` 三个 OPTIONAL 方法（假仓库不实现则头像端点回 501）。
2. **API 层**（新文件，未挂载——见下方集成清单）：`PUT /me/avatar`（二进制 body，magic bytes 校验 webp/png/jpeg 三种、256KB 硬顶 413 中文报错）、`DELETE /me/avatar`、`GET /users/:id/avatar`（登录 + 同工作区可见，fail-closed；ETag=`avatar_updated_at` 毫秒值，If-None-Match 命中回 304）。
3. **裁剪纯函数**（`packages/ui/src/avatar/avatar-crop.ts`）：取景框↔源图坐标数学——最小缩放（短边贴边，不许露空白）、缩放上限、居中初始态、拖动平移夹紧、缩放锚定取景框中心、`cropSourceRect` 供 `canvas.drawImage` 用。25 条穷举单测（边界夹紧/最小缩放/长图宽图/1px 极端图/NaN·Infinity 输入）。
4. **web 端**：`/settings`「我的资料」卡加头像位（回退首字母 tile，`<img>` onerror 隐藏）；新文件 `apps/web/src/avatar-crop-modal.ts` 承载真正的裁剪层（拖动平移用 Pointer Events、缩放滑杆、canvas 出 256×256 webp 失败退 png），deps 注入式设计使其可脱离 `browser.ts`（后者顶层直接摸 `document`，无法在 node:test 下 import）单独测试。
5. **桌面端**：Spotlight 设置视图加头像分区 + 自己的裁剪层（`openSpotlightAvatarCropModal`，同一套裁剪数学、独立 DOM 接线）；工作台聊天消息行、成员条、建群选人器的头像 tile 加 `data-wb-avatar-user-id` 标记，`chat/view.ts` 新增 `hydrateAvatarPhotos`（走 `fetchDriveResource` 授权 fetch，桌面鉴权是 client-token 走响应体不是 cookie，`<img src>` 直连拿不到鉴权头）把色块换成真图，404/失败静默回退。

## 测试数字（最终一次全量跑，六项全绿）

| 命令 | 结果 |
|---|---|
| `pnpm --filter @workhub/db test` | 286 tests, 284 pass, 2 skip（真 PG 矩阵，无本地库时按既有约定跳过）, 0 fail |
| `pnpm --filter @workhub/api test` | 1228 tests, 1227 pass, 1 skip, 0 fail |
| `pnpm --filter @workhub/ui test` | 171 tests, 171 pass, 0 fail（含 avatar-crop 25 条） |
| `pnpm --filter @workhub/web test` | 73 tests, 73 pass, 0 fail（含裁剪层集成测试 5 条） |
| `pnpm --filter @workhub/desktop-webview test` | 856 tests, 856 pass, 0 fail（含桌面裁剪层集成测试 5 条 + settings 头像测试 6 条 + render/rail 头像属性测试若干） |
| `pnpm -r typecheck` | 16/16 项目 0 错误 |

新增测试覆盖验收门逐条对应：
- 上传校验合法三态（webp/png/jpeg）+ 非法格式 400 + 超限 413（`user-avatar-service.test.ts`）。
- ETag 304（服务层 + 路由层各一遍，`user-avatar-service.test.ts` / `user-avatar-routes.test.ts`）。
- 同工作区鉴权 fail-closed（自己看自己免查会员表；查看他人未同工作区 → 404，不泄漏存在性）。
- 渲染回退 tile（route-components.test.ts 的 SSR 骨架断言 + chat/render.test.ts 的 `data-wb-avatar-user-id` 属性断言 + rail.test.ts 的选人器行断言）。
- 双端裁剪层集成测试：`apps/web/src/avatar-crop-modal.test.ts`（5 条）+ `apps/desktop-webview/src/spotlight/views/avatar-crop-modal.test.ts`（5 条），逐条覆盖「选图→拖动平移+缩放→确认→上传成功」全链路（用注入假 deps，不依赖真 DOM/Image/canvas）、取消路径、图片加载失败、canvas 编码失败、文案无 emoji 无 Cuu 字样。

## 裁剪层实现位置

- 纯坐标数学：`packages/ui/src/avatar/avatar-crop.ts`（导出自包根 `@workhub/ui`）。
- web 裁剪 DOM 层：`apps/web/src/avatar-crop-modal.ts`（`openAvatarCropModal` + `AvatarCropDeps`），`apps/web/src/browser.ts` 的 `bindSettingsAvatarPanel` 调用它。**独立成文件的原因**：`browser.ts` 顶层执行 `document.getElementById("root")`，在无 DOM 的 `node --import tsx --test` 下一 import 就抛 `ReferenceError: document is not defined`；裁剪层要能被单测覆盖就不能和这行代码共享模块。
- 桌面裁剪 DOM 层：`apps/desktop-webview/src/spotlight/views/settings.ts`（`openSpotlightAvatarCropModal` + `SpotlightAvatarCropDeps`）。`createSettingsView()` 本身可以在无 DOM 下 import（不像 browser.ts 那样顶层摸 DOM），所以没有另开文件；但裁剪层默认 deps 仍然摸真 `document`/`Image`/`canvas`，测试始终注入假 deps。
- 两份 DOM 层结构几乎一致但**有意不合并**——这是本批设计的既定取舍（"web 与桌面各自薄接，复用同一套纯函数"），不是遗漏去重。

## 集成者缝合位（本批范围围栏禁止直接改，需人工/集成者接线）

### `apps/api/src/app.ts`
```ts
import { createUserAvatarRoutes } from "./routes/user-avatar.js";
app.route("/api", createUserAvatarRoutes());
```
且 `app.onError` 需要新增一段（照 `UserProfileServiceError` 现有写法插在同一批 `instanceof` 分支旁）：
```ts
import { UserAvatarServiceError } from "./services/user-avatar.js";
// ...
if (error instanceof UserAvatarServiceError) {
  return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
}
```

### `apps/api/src/openapi.ts`
补三条路径文档：
- `PUT /api/me/avatar`：请求体二进制 `image/*`，响应 `{ ok: true, data: { avatar_updated_at: string } }`。
- `DELETE /api/me/avatar`：响应 `{ ok: true, data: { avatar_updated_at: null } }`。
- `GET /api/users/{id}/avatar`：响应二进制图片；支持 `If-None-Match` → 304；404 = 未登录同工作区不可见，或该用户没有头像。

### `apps/api/src/app.test.ts`
未改动（范围围栏禁止）——集成者接线后建议补一条端到端挂载存在性断言（同其余路由模块的既有先例）。

## 我改过的断言（如有）

- `packages/db/src/schema.test.ts` 的 journal 尾断言：从「以 0053 结尾」改为「以 0054 结尾」——这是本批新增迁移导致的必然更新，不是迁就实现（该断言本身就是"钉住当前 journal 尾"的设计意图，每个新迁移批次都要动它一次，0052/0053 的提交历史也是同样做法）。
- 29 个 `apps/api/src/**/*.test.ts` 文件的 `UserAuthRow` 字面量夹具补了 `avatarWebp: null, avatarUpdatedAt: null` 两行——纯机械追加，不改任何断言/测试逻辑。这是 `users` 表加两列后 drizzle `$inferSelect` 类型变化的必然连锁（nullable 列在推导类型里是"键必须存在、值可为 null"，不是"键可选"），不追加就是 `pnpm -r typecheck` 红。29 个文件清单已列在对应 commit（`fix(api): add avatar fields to UserAuthRow test fixtures`）里。

## 范围外发现（不修，只报）

1. **`packages/ui` 的 `test` 脚本 glob 有效性问题**：`"test": "node --import tsx --test src/**/*.test.ts"`，pnpm 默认经 `/bin/sh`（非 bash/zsh 的 globstar）展开该 glob 时，`**` 只匹配单层目录，导致 `src/` 目录下的顶层测试文件（`route-state.test.ts`、`task-plan-i18n.test.ts`）从未被 `pnpm --filter @workhub/ui test` 真正跑过——这是本批之前就存在的静默 gap，不是我引入的。我新增的 `avatar-crop.ts`/`avatar-crop.test.ts` 因此特意放进了 `packages/ui/src/avatar/`（新子目录，被 glob 正确覆盖，已验证 25 条测试真的会跑），没有踩这个坑，但没有修 `route-state.test.ts`/`task-plan-i18n.test.ts` 长期不跑的问题（改 `package.json` 脚本超出本批范围围栏）。建议单独立项修复脚本（比如换成 `--test src` 让 Node test runner 自己递归发现，不依赖 shell glob）。
2. **chat/view.ts 的 `avatarPhotoCache` 无失效/无回收**：模块级 `Map<userId, blobUrlPromise>`，用户中途换头像要等客户端重启才能看到新图；桌面客户端进程生命周期内一个工作区的真人成员数量是几十量级，内存代价可忽略——设计上的有意取舍，已在代码注释里写明，不是遗漏。
3. **未接线的头像展示点**：@ 提及选人器（chat/render.ts 的 `renderMentionPickerHtml`）与改派选人器（reassign picker）没有加 `data-wb-avatar-user-id`/头像 hydrate——计划原文列的展示点是"聊天消息行、顶部成员条、建群选人器、设置页预览"四处，均已覆盖；这两个 picker 不在列表内，为控制范围没有顺手加，如果需要可以后续小补丁跟进（同样复用 `avatarTileHtml`/`hydrateAvatarPhotos`，改动量很小）。

## 没做/存疑

- 未跑真机（.app vibrancy）验收——桌面头像预览/裁剪层的真实交互（拖动手感、触控）需要人在真 Tauri 客户端里点一遍确认视觉效果；typecheck + 单测已覆盖逻辑正确性。
- 未跑 `pnpm verify`/PG smoke（范围围栏未要求本批跑库；`users.setAvatar/clearAvatar/findAvatar` 只在 query-recorder 假 DB 层面测过查询形状，没有对真 Postgres 跑过 bytea 列的真实读写——如果需要真库验证，建议集成者接线后顺路跑一次 `apps/api/src/qa/` 下的 PG smoke）。
- 未改 `apps/api/src/app.ts`/`openapi.ts`/`server.ts`/`app.test.ts`（范围围栏严禁），头像端点因此**尚未真正对外可用**，需集成者按上方「集成者缝合位」小节接线。
