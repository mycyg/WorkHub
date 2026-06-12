---
name: pptx-deck
description: 用 python-pptx 生成 PPT 演示（标题页、要点页、图片页），含正确的版式选择
when_to_use: 任务要求交付 .pptx 演示文稿、汇报材料时
---

# PPT 演示（python-pptx）

库已预装（pilot 镜像）。**只用下面验证过的 API。**

## 模板

```python
from pptx import Presentation
from pptx.util import Inches, Pt

prs = Presentation()  # 16:9 默认

# 标题页：版式 0 = 标题+副标题
slide = prs.slides.add_slide(prs.slide_layouts[0])
slide.shapes.title.text = "汇报标题"
slide.placeholders[1].text = "副标题 / 日期"

# 要点页：版式 1 = 标题+内容
slide = prs.slides.add_slide(prs.slide_layouts[1])
slide.shapes.title.text = "本周进展"
body = slide.placeholders[1].text_frame
body.text = "第一条要点"
for point in ["第二条要点", "第三条要点"]:
    para = body.add_paragraph()
    para.text = point
    para.level = 0  # 子级用 1

# 图片页：版式 5 = 仅标题，图片手动放
slide = prs.slides.add_slide(prs.slide_layouts[5])
slide.shapes.title.text = "数据图表"
slide.shapes.add_picture("outputs/chart.png", Inches(1), Inches(1.5), width=Inches(8))

prs.save("outputs/<文件名>.pptx")
```

## 约定

1. 图表先用 stat-charts 技能生成 PNG 再插入，不要用 python-pptx 原生 chart API（复杂易错）。
2. 同时输出 `outputs/<同名>-outline.md`（每页标题+要点的大纲），便于审阅者快速过内容。
3. 自验：`run_command ["python3", "-c", "from pptx import Presentation; p=Presentation('outputs/<文件名>.pptx'); print(len(p.slides), '页')"]`。

## 常见坑

- 版式索引依赖默认模板：0=标题页、1=标题+内容、5=仅标题、6=空白。不要使用其他索引。
- `placeholders[1]` 在版式 5/6 上不存在——图片页只设 title。
- 文本超长不会自动换页；每页要点 ≤6 条，每条 ≤30 字。
