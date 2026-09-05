# 预留端点与 SDK 孤儿方法的处理口径

- Status: implemented
- Date: 2026-08-20
- Owner: kimi-code（接线审计遗留决策项）

## Problem

接线审计发现一批「端点存在、客户端零调用」的 API（auth 邀请族、objectives、permissions PUT/ask、client-devices 管理族）和约 19 个零调用的 api-client 方法。要删、要留、还是标 experimental，需要统一口径。

## Decision

- **api-client 的零调用方法**：保留，定位为公开 SDK 面（SDK 有未用方法属正常），不逐个追删；但不再新增「先写方法」的孤儿。
- **auth 注册/登录/邀请族端点**：保留——pilot 多用户邀请制要用（.env.pilot 已配置 password 模式），属已规划功能的提前落地。
- **objectives / permissions ask / client-devices 管理**：~~保留为预留口~~ **修正（2026-08-20 用户指令）：不允许存在「界面未上线」状态——全部落地实现**，见 implemented/2026-08-20-land-all-reserved-features.md（本 Note 以新决策为准）。
- **DELETE /api/permissions/:id 放宽为浏览器 admin 会话**（MRG-12）：保留放宽（设置页要用），但必须落审计（服务层已有）——治理面操作无痕不可接受。

## Alternatives considered

- 全部删除：会删掉 pilot 要用的邀请制和治理面，否决。
- 逐端点标 experimental 状态码：过度工程，否决。

## Consequences

新增端点的纪律：要么有客户端消费，要么在 OpenAPI 注明预留原因。接线审计（死 API/死按钮对账）应成为发布前例行检查。
