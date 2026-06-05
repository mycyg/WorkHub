import {
  createAuditLogRepository,
  createDatabaseClient,
  createSnapshotRepository,
  type AuditLogRepository,
  type SnapshotRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";

let defaultDbClient: WorkHubDatabaseClient | undefined;

export type AuditStores = {
  auditLogs: AuditLogRepository;
  snapshots: SnapshotRepository;
};

export function getDefaultAuditStores(): AuditStores {
  defaultDbClient ??= createDatabaseClient();
  return {
    auditLogs: createAuditLogRepository(defaultDbClient.db),
    snapshots: createSnapshotRepository(defaultDbClient.db)
  };
}
