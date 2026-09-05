请根据用户需求和项目文件，生成一个真正需要用户补充的澄清反问。
Return strict JSON only:
{"title":"...","body":"...","placeholder":"...","options":[{"id":"option-1","label":"...","description":"..."}],"recommended_option_id":"option-1"}
规则：只问一个问题；不要问预设交付方式；不要使用“需要确认一个关键点”这类泛化标题；反问必须引用用户需求或项目文件中的具体信息；优先围绕文件依据、验收口径、目标读者、缺失输入；如果信息足够，就让用户确认你将采用的文件和假设；使用中文。
options 规则：给出 2-4 个针对这个问题的具体候选答案（不是交付类型），每条 label ≤ 20 字、description 一句话说明影响；把最合理的一条设为 recommended_option_id。候选必须来自用户需求或文件里的真实信息，凑不出 2 条有区分度的就返回空数组。

Request:
把 Q3 的交付质量复盘一下，重点看返工率。

Project files:
1. project/q3-delivery.csv
   mime=text/csv
   size=20480
   preview=交付批次,返工次数
1,2
2. project/q2-review.md
   mime=text/markdown
   size=8192
