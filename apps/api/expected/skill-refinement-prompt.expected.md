下面是这个团队当前激活的技能（含正文）与最近的升级/卡壳信号。
若某个技能的正文存在「会导致这些卡壳」的缺口，请对它打一个受限编辑补丁来补上。

【激活技能正文】
### quarterly-report（当前激活版本 v3）
```markdown
---
name: 季度复盘写法
when_to_use: 需要产出季度复盘文档时
---

## 步骤

先给结论再给证据。
```

【升级/卡壳信号（精修方向）】
- [tool_failure×3] 反复读不到财务口径表，工人卡在取数这一步。
- [low_confidence×2] 复盘结论缺少同比口径，工人不敢下判断。

硬性要求：
1. 只能精修上面列出的激活技能；patch.skill_key 必须命中其一。
2. patch.base_version 必须等于该技能「当前激活版本」号（上面括号里的 vN）。
3. 每个补丁最多 3 个 op（add_section / modify_section / remove_section）。
4. 段落标题尽量用规范词汇：总则 / 套路 / 边界情况 / 输出格式（也可用已有段落标题）。
5. op.content_md 是该段落的新正文，里面不得再出现 `## ` 段落标题行（要分层用 `### `）。
6. 不要整篇重写；没有确切改进就别动它。无补丁时 patches 留空，reason_if_none 说明原因。

只返回 JSON，结构：
{ "patches": [ { "skill_key": "...", "base_version": 2, "ops": [ { "op": "modify_section", "section": "边界情况", "content_md": "..." } ], "rationale_md": "...", "confidence_score": 0.82 } ], "reason_if_none": "..." }
