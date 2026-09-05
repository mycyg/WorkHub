---
name: code-script
description: 代码/脚本类交付物的约定（入口注释、无网络假设、交付前用 run_command 自验）
when_to_use: 任务要求交付可运行的代码、脚本、配置或小工具时
---

# 代码脚本交付约定

## 约定

1. **交付前必须自验**：用 `run_command` 真实跑一遍（python3/node/pytest/tsc 在白名单内），把运行输出贴进总结。跑不通的代码不交付。
2. 文件头注释三行：用途 / 用法（含示例命令）/ 假设与限制。
3. **无网络假设**：执行环境禁网。代码里不要有 pip install、npm install、HTTP 请求；若任务确实需要联网能力，生成代码可以包含网络调用，但在交付物里注明「网络部分未实际验证」并列进待确认事项。
4. 依赖边界：python 可用标准库 + pandas/numpy/matplotlib/openpyxl/python-docx/python-pptx（镜像预装）；node 只用内置模块。超出的依赖在文件头声明，并在总结里用一句人话说清它卡住了什么。
5. 入口防御：校验输入参数，缺参时打印用法退出（exit code 2），不要静默吞错。
6. 测试：超过 50 行的逻辑附最小测试（pytest 或 node --test），并实际跑过。

## 自验示例

```
run_command ["python3", "outputs/tool.py", "--help"]
run_command ["python3", "-m", "pytest", "outputs/test_tool.py", "-q"]
run_command ["node", "--test", "outputs/tool.test.mjs"]
```
