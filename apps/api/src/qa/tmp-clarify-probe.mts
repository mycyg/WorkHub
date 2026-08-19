import { loadSettings } from "@workhub/config";
import { createApiProviderRegistry } from "../services/provider-registry.js";

async function main() {
  const settings = loadSettings();
  const registry = createApiProviderRegistry({ settings });
  console.log("configured:", registry.isConfigured());
  const client = registry.get({ id: "probe", label: "probe", userId: "probe" }, "clarify");
  const response = await client.messages.create({
    maxTokens: 1600,
    source: "agent_step",
    timeoutMs: 60000,
    system: "You are WorkHub's intake clarifier. Return strict JSON only. Never include secrets or unrelated implementation advice.",
    messages: [{ role: "user", content: "请根据用户需求和项目文件，生成一个真正需要用户补充的澄清反问。\nReturn strict JSON only:\n{\"title\":\"...\",\"body\":\"...\",\"placeholder\":\"...\",\"options\":[{\"id\":\"option-1\",\"label\":\"...\",\"description\":\"...\"}],\"recommended_option_id\":\"option-1\"}\n规则：只问一个问题；不要问预设交付方式；不要使用“需要确认一个关键点”这类泛化标题；反问必须引用用户需求或项目文件中的具体信息；使用中文。\noptions 规则：给出 2-4 个针对这个问题的具体候选答案（不是交付类型），每条 label ≤ 20 字、description 一句话说明影响；把最合理的一条设为 recommended_option_id。候选必须来自用户需求或文件里的真实信息，凑不出 2 条有区分度的就返回空数组。\n\nRequest:\n给我写一份周五团队周会的一页纪要模板，包含阻塞、进展、下周计划三节\n\nProject files:\nNo project files are currently visible." }]
  });
  const blocks = response.content as { type: string; text?: string; thinking?: string }[];
  for (const b of blocks) console.log("BLOCK", b.type, "len", (b.text ?? b.thinking ?? "").length);
  const text = blocks.filter(b => b.type === "text").map(b => b.text ?? "").join("\n");
  console.log("TEXT_FULL_START");
  console.log(text);
  console.log("TEXT_FULL_END");
}
main().catch((e) => { console.error("PROBE ERROR:", e); process.exit(1); });
