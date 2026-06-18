import { createBudgetReservationRepository, getSharedDatabaseClient, type BudgetReservationRepository } from "@workhub/db";

// R2 epic(原子预算)：生产默认的预留仓库——绑共享 PG 客户端。仅 PG 队列路径注入它；
// 内存队列不注入（单测不受预留逻辑影响）。
let defaultRepository: BudgetReservationRepository | undefined;

export function getDefaultBudgetReservationRepository(): BudgetReservationRepository {
  defaultRepository ??= createBudgetReservationRepository(getSharedDatabaseClient().db);
  return defaultRepository;
}
