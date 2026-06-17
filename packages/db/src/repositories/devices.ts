import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { clientDevices } from "../schema/index.js";

export type ClientDeviceAuthRow = typeof clientDevices.$inferSelect;

export type CreateClientDeviceInput = {
  id?: string;
  userId: string;
  deviceName: string;
  platform: string;
  clientTokenHash: string;
  lastSeenAt: Date;
};

export type ClientDeviceRepository = {
  findActiveByTokenHash: (tokenHash: string) => Promise<ClientDeviceAuthRow | null>;
  findActiveByTokenHashForUser: (tokenHash: string, userId: string) => Promise<ClientDeviceAuthRow | null>;
  createClientDevice: (input: CreateClientDeviceInput) => Promise<ClientDeviceAuthRow>;
  listByUser: (userId: string) => Promise<ClientDeviceAuthRow[]>;
  touchLastSeen: (deviceId: string, at: Date) => Promise<ClientDeviceAuthRow | null>;
  revokeByIdForUser: (deviceId: string, userId: string, at: Date) => Promise<ClientDeviceAuthRow | null>;
  revokeByTokenHash: (tokenHash: string, at: Date) => Promise<ClientDeviceAuthRow | null>;
};

export function createClientDeviceRepository(db: WorkHubDb): ClientDeviceRepository {
  return {
    async findActiveByTokenHash(tokenHash) {
      const rows = await db
        .select()
        .from(clientDevices)
        .where(and(eq(clientDevices.clientTokenHash, tokenHash), isNull(clientDevices.revokedAt)))
        .limit(1);
      return rows[0] ?? null;
    },

    async findActiveByTokenHashForUser(tokenHash, userId) {
      const rows = await db
        .select()
        .from(clientDevices)
        .where(
          and(
            eq(clientDevices.clientTokenHash, tokenHash),
            eq(clientDevices.userId, userId),
            isNull(clientDevices.revokedAt)
          )
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async createClientDevice(input) {
      const rows = await db
        .insert(clientDevices)
        .values({
          id: input.id ?? randomUUID(),
          userId: input.userId,
          deviceName: input.deviceName,
          platform: input.platform,
          clientTokenHash: input.clientTokenHash,
          lastSeenAt: input.lastSeenAt
        })
        .returning();
      const device = rows[0];
      if (!device) {
        throw new Error("Failed to create client device");
      }
      return device;
    },

    async listByUser(userId) {
      return db
        .select()
        .from(clientDevices)
        .where(eq(clientDevices.userId, userId))
        // findings[#low]：revokedAt ASC 在 PG 默认 NULLS LAST，会把 active(null) 排到吊销设备之后。
        // 用 `is not null` 布尔键：active=false(0) 排前，revoked=true(1) 排后；组内按最近活跃倒序。
        .orderBy(sql`${clientDevices.revokedAt} is not null`, desc(clientDevices.lastSeenAt));
    },

    async touchLastSeen(deviceId, at) {
      const rows = await db
        .update(clientDevices)
        .set({ lastSeenAt: at, updatedAt: at })
        .where(eq(clientDevices.id, deviceId))
        .returning();
      return rows[0] ?? null;
    },

    async revokeByIdForUser(deviceId, userId, at) {
      const existing = await db
        .select()
        .from(clientDevices)
        .where(and(eq(clientDevices.id, deviceId), eq(clientDevices.userId, userId)))
        .limit(1);
      const device = existing[0];
      if (!device) {
        return null;
      }
      if (device.revokedAt !== null) {
        return device;
      }
      const rows = await db
        .update(clientDevices)
        .set({ revokedAt: at, updatedAt: at })
        .where(and(eq(clientDevices.id, deviceId), eq(clientDevices.userId, userId)))
        .returning();
      return rows[0] ?? null;
    },

    async revokeByTokenHash(tokenHash, at) {
      const existing = await this.findActiveByTokenHash(tokenHash);
      if (!existing) {
        return null;
      }
      const rows = await db
        .update(clientDevices)
        .set({ revokedAt: at, updatedAt: at })
        .where(eq(clientDevices.id, existing.id))
        .returning();
      return rows[0] ?? null;
    }
  };
}
