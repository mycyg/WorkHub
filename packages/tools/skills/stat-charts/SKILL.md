---
name: stat-charts
description: 用 matplotlib 生成统计图表 PNG（折线/柱状/饼图），中文标签字体已配置
when_to_use: 任务要求交付趋势图、对比图、占比图等统计图表时
---

# 统计图表（matplotlib）

库已预装（pilot 镜像，含 Noto CJK 字体）。**只用下面验证过的模式。**

## 模板

```python
import matplotlib
matplotlib.use("Agg")  # 无显示环境必须
import matplotlib.pyplot as plt

# 中文字体（镜像已装 Noto Sans CJK；本机缺字体时标签会变方框，属环境差异，不要为此重试）
plt.rcParams["font.sans-serif"] = ["Noto Sans CJK SC", "PingFang SC", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

fig, ax = plt.subplots(figsize=(8, 4.5), dpi=144)

# 折线
ax.plot(["1月", "2月", "3月"], [12, 18, 15], marker="o", label="A 产品")
ax.plot(["1月", "2月", "3月"], [8, 11, 17], marker="s", label="B 产品")
ax.set_title("月度销量趋势")
ax.set_ylabel("销量（件）")
ax.legend()
ax.grid(True, alpha=0.3)

fig.tight_layout()
fig.savefig("outputs/<文件名>.png")
plt.close(fig)
```

柱状用 `ax.bar(labels, values)`；饼图用 `ax.pie(values, labels=labels, autopct="%1.0f%%")`（饼图前 `ax.set_aspect("equal")`）。

## 约定

1. 每张图同时落一份源数据 `outputs/<同名>-data.csv`——审阅者要能核数。
2. `figsize=(8, 4.5), dpi=144` 为默认（PPT 16:9 友好）；饼图用 `(6, 6)`。
3. 自验：`run_command ["python3", "-c", "from PIL import Image"]` 不可用没关系，改用 `["python3", "-c", "import os; print(os.path.getsize('outputs/<文件名>.png'))"]` 确认非空。

## 常见坑

- 必须 `matplotlib.use("Agg")` 且在 `import pyplot` 之前。
- 一个脚本画多张图时，每张 `plt.close(fig)`，否则内存涨。
- 不要用 seaborn/plotly（未预装）。
