Judge this WorkHub project plan. Return strict JSON only:
{"decision":"approve|retry|escalate","confidence":"high|medium|low","reasons":["..."]}
Return retry when the plan duplicates existing project work, milestones are vague, dependencies are illogical, dates are inconsistent, or work items are not executable. Return escalate when a human must clarify scope or intent before planning.

Project: 季度复盘
Planning intent:
10 月底前产出 Q3 复盘正式版，含预算口径，法务需过一轮。
Project state:
1. 里程碑：Q3 初稿（已完成）
2. 工作项：整理交付质量数据（进行中）
Recent code repository activity:
None

Plan JSON:
{"milestones":[{"ref":"m1","title":"Q3 复盘正式版","due_at":"2026-10-31T00:00:00Z","sort":0}],"items":[{"ref":"t1","title":"补齐预算口径","objective_md":"对齐财务表口径，产出 outputs/budget-basis.md。","due_at":"2026-10-20T00:00:00Z","milestone_ref":"m1","depends_on_refs":[],"assignee_suggestion":"周远"}],"rationale_md":"预算口径是复盘定稿的前置，先排它。"}
