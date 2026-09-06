import type { AttentionHomeVM } from "@workhub/contracts";

/**
 * 「待你拍板」的条数——桌面三处角标/副标题共用的唯一读法。
 *
 * R27（真机走查）：快捷入口「审批队列」写着「1 条待你拍板」时，工作台左上「待拍板」还是「都处理完了」。
 * 两面其实都读 GET /api/pages/attention，但各自在自己的文件里 `vm.queue?.length ?? 0` 数了一遍——
 * 同一件待拍板的事在两面各算各的，任何一面改口径（少数一类、把队列截断、只数 primary）都会让两面
 * 立刻各说各话，而且没有任何测试拦得住。收成这一个函数：两面的数字从此只有一个来源。
 *
 * 队列本身仍以服务端为准（approval_requests / proposals / 升级 / 记忆冲突四个来源在
 * apps/api/src/routes/pages.ts 的 /attention 里汇成一条），会话里的系统消息只是附加的可见性，
 * 从不参与计数。
 */
export function pendingDecisionCount(vm: Pick<AttentionHomeVM, "queue"> | null | undefined): number {
  const queue = vm?.queue;
  return Array.isArray(queue) ? queue.length : 0;
}
