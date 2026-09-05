为这个 WorkHub 项目起草一份可审计、可落地的项目计划（里程碑 + 工作项 + 依赖）。
Return strict JSON only with this shape:
{"milestones":[{"ref":"m1","title":"...","due_at":"2026-08-01T00:00:00Z"|null,"sort":0}],"items":[{"ref":"t1","title":"...","objective_md":"...","due_at":"..."|null,"milestone_ref":"m1"|null,"depends_on_refs":["t0"],"assignee_suggestion":"..."|null}],"rationale_md":"..."}
规则：ref 用草案内稳定局部 id；milestone_ref 只能引用 milestones 里的 ref；depends_on_refs 只能引用 items 里的 ref，且不得自引用、不得成环；日期不倒挂（一件事的 due_at 不早于它依赖项的 due_at，不晚于它所属里程碑的 due_at）；工作项要可执行、objective_md 写清目标与产出；给出 rationale_md 解释排期取舍；不要产出与「项目现状」里已存在项重复的计划。

Project: 季度复盘

Planning intent (goals / deadlines / constraints):
10 月底前产出 Q3 复盘正式版，含预算口径，法务需过一轮。

Project state (existing milestones and open work — do not duplicate):
1. 里程碑：Q3 初稿（已完成）
2. 工作项：整理交付质量数据（进行中）
