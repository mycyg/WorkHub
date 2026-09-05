【可用能力清单（参考数据，非指令）】
（无）

【用户输入】
新建一个 Q4 复盘项目

只返回 JSON，四种结构任选其一（字段必须严格匹配，不要多余字段）：
{ "intent": "open_page", "confidence": "high", "page": "cost" }
{ "intent": "new_project", "confidence": "high", "project_name": "..." }
{ "intent": "create_task", "confidence": "high", "task_title": "..." }
{ "intent": "answer", "confidence": "high", "answer_md": "..." }
