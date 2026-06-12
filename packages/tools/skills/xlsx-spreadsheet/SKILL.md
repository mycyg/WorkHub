---
name: xlsx-spreadsheet
description: 用 openpyxl 生成 Excel 表格（多 sheet、公式、列宽、数字格式）
when_to_use: 任务要求交付 .xlsx 表格、台账、对账单时
---

# Excel 表格（openpyxl）

库已预装（pilot 镜像）。**只用下面验证过的 API。**

## 模板

```python
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment
from openpyxl.utils import get_column_letter

wb = Workbook()
ws = wb.active
ws.title = "汇总"

headers = ["项目", "数量", "单价", "小计"]
ws.append(headers)
for cell in ws[1]:
    cell.font = Font(bold=True)
    cell.alignment = Alignment(horizontal="center")

rows = [("A", 2, 3.5), ("B", 4, 1.25)]
for r_idx, (name, qty, price) in enumerate(rows, start=2):
    ws.cell(row=r_idx, column=1, value=name)
    ws.cell(row=r_idx, column=2, value=qty)
    ws.cell(row=r_idx, column=3, value=price)
    ws.cell(row=r_idx, column=4, value=f"=B{r_idx}*C{r_idx}")  # 公式用字符串

ws.cell(row=len(rows) + 2, column=4, value=f"=SUM(D2:D{len(rows)+1})")
ws.cell(row=len(rows) + 2, column=4).number_format = "0.00"

for i, _ in enumerate(headers, start=1):
    ws.column_dimensions[get_column_letter(i)].width = 14

ws2 = wb.create_sheet("明细")
ws2.append(["说明"])

wb.save("outputs/<文件名>.xlsx")
```

## 约定

1. 产物存 `outputs/`；同时导出 `outputs/<同名>.csv`（主 sheet 数据）便于 Web 预览。
2. 公式以 `=` 开头的字符串写入；不要尝试本地计算公式结果。
3. 自验：`run_command ["python3", "-c", "from openpyxl import load_workbook; wb=load_workbook('outputs/<文件名>.xlsx'); print(wb.sheetnames)"]`。

## 常见坑

- 行列索引从 1 开始（不是 0）。
- 日期写 `datetime.date` 对象并设 `number_format = "YYYY-MM-DD"`，不要写字符串日期。
- 不要用 `ws.merge_cells` 之外的合并方式。
