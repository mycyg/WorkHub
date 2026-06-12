---
name: data-analysis
description: 用 pandas/numpy 做数据分析（描述统计、分组聚合、相关性），产出 CSV + 结论报告
when_to_use: 任务要求分析数据、出统计结论、做对比汇总时
---

# 数据分析（pandas / numpy）

库已预装（pilot 镜像）。**只用下面验证过的模式。**

## 模板

```python
import pandas as pd
import numpy as np

df = pd.read_csv("输入文件.csv")  # 工作目录内的输入；Excel 用 pd.read_excel

# 1) 体检
profile = pd.DataFrame({
    "dtype": df.dtypes.astype(str),
    "non_null": df.notna().sum(),
    "nulls": df.isna().sum(),
})
profile.to_csv("outputs/data-profile.csv")

# 2) 描述统计
df.describe(include="all").to_csv("outputs/describe.csv")

# 3) 分组聚合
summary = df.groupby("分组列").agg(
    数量=("数值列", "count"),
    均值=("数值列", "mean"),
    合计=("数值列", "sum"),
).round(2)
summary.to_csv("outputs/group-summary.csv")

# 4) 数值列相关性
numeric = df.select_dtypes(include=[np.number])
if numeric.shape[1] >= 2:
    numeric.corr().round(3).to_csv("outputs/correlation.csv")
```

## 约定

1. **结论必须落 `outputs/analysis.md`**：结论先行（3 条以内）→ 关键数字（引用哪个 CSV 哪一行）→ 方法与口径 → 数据质量备注（缺失/异常值如何处理）。
2. 所有中间产物进 outputs/，审阅者可逐个核对。
3. 缺失值处理要显式声明（`dropna`/`fillna` 用了哪个、为什么），不要静默处理。

## 常见坑

- `groupby().agg()` 用命名聚合（如上），不要用已废弃的 dict-of-dict 形式。
- 中文列名直接可用；读 CSV 乱码时尝试 `encoding="gbk"` 一次，仍失败按 blocker 上报。
- 不要画图——图表交给 stat-charts 技能（先分析出数，再加载它）。
