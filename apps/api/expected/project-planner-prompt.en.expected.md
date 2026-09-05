Draft an auditable, executable project plan (milestones + work items + dependencies) for this WorkHub project.
Return strict JSON only with this shape:
{"milestones":[{"ref":"m1","title":"...","due_at":"2026-08-01T00:00:00Z"|null,"sort":0}],"items":[{"ref":"t1","title":"...","objective_md":"...","due_at":"..."|null,"milestone_ref":"m1"|null,"depends_on_refs":["t0"],"assignee_suggestion":"..."|null}],"rationale_md":"..."}
Rules: use stable local ids for ref; milestone_ref may only reference a milestones ref; depends_on_refs may only reference items refs, never self, never a cycle; keep dates consistent (an item's due_at is not earlier than its dependencies' due_at and not later than its milestone's due_at); items must be executable with a clear objective_md; include rationale_md explaining the schedule; do not re-plan work that already exists in the project state.

Project: 季度复盘

Planning intent (goals / deadlines / constraints):
10 月底前产出 Q3 复盘正式版，含预算口径，法务需过一轮。

Project state (existing milestones and open work — do not duplicate):
1. 里程碑：Q3 初稿（已完成）
2. 工作项：整理交付质量数据（进行中）
