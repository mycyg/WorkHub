请根据下面这个团队最近 7 天的工作数据，提议 0–3 项新的团队技能。

【被接受的交付物（正样本，说明这类活高频且被认可）】
- markdown-report：被接受 9 次
- xlsx-spreadsheet：被接受 4 次

【升级/卡壳信号（说明缺什么能力）】
- [tool_failure×3] 反复读不到财务口径表，工人卡在取数这一步。
- [low_confidence×2] 复盘结论缺少同比口径，工人不敢下判断。

【被用户打「没用」的近期产出（反例——蒸馏时主动避免同类模式，勿重蹈覆辙）】
- [Cuu 回复]「把整张表原样贴回来当结论。」（用户备注：要的是结论不是原始表）
- [提议]「改了三个文件却没说改了什么。」

【被用户点「有用」认可的近期产出（正样本，用户主动认可，强信号）】
- 提议：获好评 6 次
- 行动卡：获好评 2 次

【已有技能（不要重复）】
quarterly-report、data-analysis

【近期被放弃的提议（除非证据明显变强，否则勿再原样重提相同 skill_key）】
- budget-table（曾被放弃 2 次，最近原因：样本不足（sample_count=2））

硬性要求：
1. 每项技能必须对应至少 5 个样本（sample_count ≥ 5）。
2. skill_key 全小写连字符（如 quarterly-report），不得与已有技能重复。
3. content_md 必须是合法 SKILL.md：以 frontmatter 开头（--- 含 name / when_to_use ---），后接正文。
4. 证据不足时，distilled_skills 留空数组，并在 reason_if_none 说明原因。最多 3 项。

只返回 JSON，结构：
{ "distilled_skills": [ { "skill_key": "...", "name": "...", "when_to_use": "...", "content_md": "---\nname: ...\nwhen_to_use: ...\n---\n\n# ...", "sample_count": 6, "confidence_score": 0.85 } ], "reason_if_none": "..." }
