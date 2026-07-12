// R12 批 5(军团面板读侧切片):每个 run 配一个易认的猫仔代号——输出区/线程回贴/通知里用名字指代，
// 跨面板认人比裸 run id 友好（00-interaction-design.md §4「军团成员有名字」）。
//
// 纯函数、无副作用、无 node 内置模块依赖：这个包会被 apps/desktop-webview（Tauri webview，浏览器环境）
// 直接引入，禁止使用 node:crypto 之类的 server-only API。用 FNV-1a 做确定性哈希——同一个 runId 永远映射
// 到同一个名字，不同 runId 在词表上大致均匀分布。

// 词表：纯中文、无 emoji（仓库偏好），全部食物/软萌系猫名，风格对齐 00 文档给的示例（阿墨/雪球/橘皮/煤球/年糕）。
// 至少 32 个，实际给了 40 个留分布余量；顺序即索引，不可随意重排——重排等于把已经分配出去的代号全部改名。
export const CAT_CODENAMES = [
  "阿墨", "雪球", "橘皮", "煤球", "年糕",
  "豆沙", "汤圆", "奶糖", "麻薯", "布丁",
  "栗子", "糯米", "芋泥", "抹茶", "花卷",
  "馒头", "饺子", "元宝", "珍珠", "墨鱼",
  "藕粉", "桂花", "茉莉", "桃酥", "绿豆",
  "红豆", "黑豆", "芝麻", "核桃", "松果",
  "柚子", "橙子", "柿子", "石榴", "荔枝",
  "龙眼", "杏仁", "腰果", "燕麦", "米糕"
] as const;

export type CatCodename = (typeof CAT_CODENAMES)[number];

// 空串/非字符串防御时的固定回退名——不抛错（这是纯展示层的取名函数，调用方不该因为一个空 id 而整卡崩掉），
// 但回退值本身也是确定性的，不会在两次调用间跳动。
const FALLBACK_CODENAME: CatCodename = CAT_CODENAMES[0];

// FNV-1a 32 位哈希：无第三方依赖、纯 JS、在浏览器/webview/node 里行为一致。
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 转成无符号 32 位，避免取模时出现负数索引。
  return hash >>> 0;
}

export function catCodename(runId: string): CatCodename {
  const trimmed = typeof runId === "string" ? runId.trim() : "";
  if (trimmed.length === 0) {
    return FALLBACK_CODENAME;
  }
  const hash = fnv1a32(trimmed);
  const index = hash % CAT_CODENAMES.length;
  return CAT_CODENAMES[index]!;
}
