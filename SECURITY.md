# 安全策略 · Security Policy

简体中文 ｜ [English](#english)

WorkHub 重视所有用户与协作者的数据安全。本文件说明如何负责任地向我们报告安全漏洞。

## 支持范围

- 本仓库内的源代码与默认配置。
- 官方部署模板（`docker-compose.pilot.yml`、`.env.pilot.example`）所描述的标准部署形态。

不在范围内：第三方依赖自身的漏洞（请直接向上游报告，但仍欢迎告知我们以便升级）、用户自行魔改后的部署、社会工程攻击。

## 如何报告

- 请**私下**通过邮件报告：`mycyg1994@gmail.com`，邮件标题以 `[SECURITY]` 开头。
- 报告中请尽量包含：受影响的组件/版本（commit）、复现步骤或 PoC、影响评估、以及任何建议的修复方向。
- **请勿**通过公开 Issue、PR 或社交媒体披露未修复的漏洞。

## 我们的承诺

- **3 个工作日内**确认收到你的报告。
- **10 个工作日内**给出初步评估与处理计划。
- 在修复发布前不公开漏洞细节；修复后会在变更记录中致谢报告者（除非你要求匿名）。
- 我们遵循协调披露：在修复发布、并给用户留出合理升级窗口之前，不公开披露。

感谢你帮助 WorkHub 变得更安全。

---

## English

WorkHub takes the security of its users and contributors seriously. This document explains how to report security vulnerabilities responsibly.

### Scope

- Source code and default configuration in this repository.
- The standard deployment shape described by the official templates (`docker-compose.pilot.yml`, `.env.pilot.example`).

Out of scope: vulnerabilities in third-party dependencies themselves (please report those upstream, though we appreciate a heads-up so we can upgrade), heavily customized deployments, and social-engineering attacks.

### How to report

- Please report **privately** by email to `mycyg1994@gmail.com` with a subject line starting with `[SECURITY]`.
- Where possible, include: the affected component/version (commit), reproduction steps or a PoC, an impact assessment, and any suggested remediation.
- **Do not** disclose unfixed vulnerabilities via public Issues, PRs, or social media.

### Our commitment

- We will **acknowledge** your report within **3 business days**.
- We will provide an **initial assessment** and remediation plan within **10 business days**.
- We will not publicly disclose details until a fix is released; reporters will be credited in the changelog after the fix (unless you prefer to remain anonymous).
- We follow coordinated disclosure: no public disclosure until a fix has shipped and users have had a reasonable window to upgrade.

Thank you for helping keep WorkHub secure.
