---
name: docx-document
description: 用 python-docx 生成 Word 文档（报告/方案/纪要），含标题层级、段落、表格与基本样式
when_to_use: 任务要求交付 .docx Word 文档时
---

# Word 文档（python-docx）

库已预装（pilot 镜像）。**只用下面验证过的 API，不要凭记忆扩展。**

## 模板（写成脚本后用 run_command 执行）

```python
from docx import Document
from docx.shared import Pt, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()
doc.add_heading("文档标题", level=0)
doc.add_heading("一、背景", level=1)
p = doc.add_paragraph("正文段落。")
p.add_run("需要强调的部分").bold = True

# 表格：先建空表再填，header 在第 0 行
table = doc.add_table(rows=1, cols=3)
table.style = "Light Grid Accent 1"
hdr = table.rows[0].cells
hdr[0].text, hdr[1].text, hdr[2].text = "项", "数值", "说明"
for row in [("A", "1", "示例")]:
    cells = table.add_row().cells
    for i, v in enumerate(row):
        cells[i].text = str(v)

doc.add_page_break()
doc.save("outputs/<文件名>.docx")
```

## 约定

1. 产物存 `outputs/`，文件名小写连字符（如 `outputs/q2-review-report.docx`）。
2. 中文内容直接写字符串即可，无需特殊编码处理。
3. 生成后自验：`run_command ["python3", "-c", "from docx import Document; d=Document('outputs/<文件名>.docx'); print(len(d.paragraphs), '段')"]`，确认可重新打开。
4. 同时输出一份 `outputs/<同名>.md` 纯文本镜像，方便审阅者在 Web 里预览正文。

## 常见坑

- `add_heading(level=0)` 是文档大标题；正文层级从 1 开始。
- 不要使用 `doc.styles` 自定义新样式（API 复杂易错），内置样式名足够。
- 表格样式名错误会抛 KeyError——只用 "Table Grid" 或 "Light Grid Accent 1"。
