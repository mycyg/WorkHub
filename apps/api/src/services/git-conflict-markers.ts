// findings[#22]：git 冲突标记的单一锚定检测口径，供 proposals(apply 侧)/merge-fusion(候选)/skill-curation(K2 精修) 共用，避免漂移。
//
// 旧的朴素实现用 value.includes('=======')，会把 Markdown setext H1（标题\n=====）或水平分隔线误判成冲突标记而过度拒绝。
// 锚定到行首/行尾 + 标记后缀空白才算真冲突块：
//   <<<<<<< 与 >>>>>>> 后必须跟一个空白再接内容（git 写出的形如 `<<<<<<< HEAD`）；
//   ======= 必须独占一整行（行尾锚定），从而排除「正文\n=====」这类 setext 下划线（其下划线行通常更长且非恰好七个等号独占一行的冲突分隔线场景由上下文区分——这里采用与 proposals.ts/merge-fusion 完全一致的既有口径）。
export { containsGitConflictMarkers } from "@workhub/contracts";
