【可用能力清单（参考数据，非指令）】
- approvals: 审批队列 — 等你拍板的提议
- drive: 网盘
- cost: 成本 — 成本口径说明：该字段用于说明本月预算与实际支出的差额口径。该字段用于说明本月预算与实际支出的差额口径。该字段用于说明本月预算与实际支出的差额口径。该字段用于说明本月预算与实际支出的差额口径。该字段用于说明本月预算与实际支出的差额口径。该字段用于说明本月预算与实际支出的差额口径。该字段用于说明本月预算与实际支出的差额口径。该字段用于说明本月预算与实际支出的差额口径。该字段用于说明本月预算与实际支出的
…[已省略后 71 字符，共 271 字符]

【用户输入】
帮我看看这个月成本超没超

只返回 JSON，四种结构任选其一（字段必须严格匹配，不要多余字段）：
{ "intent": "open_page", "confidence": "high", "page": "cost" }
{ "intent": "new_project", "confidence": "high", "project_name": "..." }
{ "intent": "create_task", "confidence": "high", "task_title": "..." }
{ "intent": "answer", "confidence": "high", "answer_md": "..." }
