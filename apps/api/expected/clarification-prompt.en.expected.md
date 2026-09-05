Generate one useful clarification question from the user's request and project files.
Return strict JSON only:
{"title":"...","body":"...","placeholder":"...","options":[{"id":"option-1","label":"...","description":"..."}],"recommended_option_id":"option-1"}
Rules: ask exactly one question; do not ask for a preset delivery type; do not use generic titles like 'One key detail to confirm'; the question must reference concrete information from the user request or project files; prioritize source file, acceptance criteria, audience, or missing input; if enough information exists, ask the user to confirm the file and assumptions; use English.
Options rules: provide 2-4 concrete candidate answers to this exact question (not delivery types); label ≤ 8 words, description one sentence on the consequence; set recommended_option_id to the most sensible one. Candidates must come from real information in the request or files — return an empty array if you cannot form 2 distinct ones.

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
