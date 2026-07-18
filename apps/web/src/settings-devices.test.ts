import assert from "node:assert/strict";
import test from "node:test";
import type { ClientDeviceResponse } from "@workhub/contracts";

import {
  buildSettingsDeviceRow,
  formatDeviceLastSeen,
  humanizeDeviceRevokeError,
  isCurrentDevice,
  isDeviceRevoked
} from "./settings-devices.js";

function device(partial: Partial<ClientDeviceResponse> = {}): ClientDeviceResponse {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    user_id: "10000000-0000-4000-8000-000000000001",
    device_name: "Ica's MacBook Pro",
    platform: "desktop",
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    last_seen_at: "2026-07-18T03:04:00.000Z",
    ...partial
  };
}

test("R20 P2-05 formatDeviceLastSeen localizes the timestamp per locale and falls back honestly when absent", () => {
  const zh = formatDeviceLastSeen("2026-07-18T03:04:00.000Z", "zh-CN");
  const en = formatDeviceLastSeen("2026-07-18T03:04:00.000Z", "en-US");
  assert.match(zh, /2026/);
  assert.match(en, /2026/);
  assert.notEqual(zh, en);

  assert.equal(formatDeviceLastSeen(undefined, "zh-CN"), "从未连接");
  assert.equal(formatDeviceLastSeen(undefined, "en-US"), "Never connected");
  // 畸形字符串不炸成 "Invalid Date" —— 同样走诚实的空态文案。
  assert.equal(formatDeviceLastSeen("not-a-date", "en-US"), "Never connected");
});

test("R20 P2-05 isCurrentDevice / isDeviceRevoked: revoked devices never count as 本机 even if the id matches", () => {
  const activeDevice = device({ revoked_at: undefined });
  const revokedDevice = device({ revoked_at: "2026-07-18T04:00:00.000Z" });

  assert.equal(isDeviceRevoked(activeDevice), false);
  assert.equal(isDeviceRevoked(revokedDevice), true);

  assert.equal(isCurrentDevice(activeDevice, activeDevice.id), true);
  assert.equal(isCurrentDevice(activeDevice, "some-other-id"), false);
  assert.equal(isCurrentDevice(activeDevice, null), false);
  // 已撤销的设备哪怕 id 命中也不再标「本机」。
  assert.equal(isCurrentDevice(revokedDevice, revokedDevice.id), false);
});

test("R20 P2-05 buildSettingsDeviceRow marks the matching device as 本机/This device and disables its revoke action", () => {
  const current = device({ id: "aaaaaaaa-0000-4000-8000-000000000001" });
  const other = device({ id: "bbbbbbbb-0000-4000-8000-000000000002", device_name: "Old iPad" });

  const currentRow = buildSettingsDeviceRow(current, current.id, "zh-CN");
  assert.equal(currentRow.isCurrent, true);
  assert.equal(currentRow.isRevoked, false);
  assert.equal(currentRow.statusLabel, "本机");
  assert.equal(currentRow.canRevoke, false, "本机没有自撤销入口");

  const otherRow = buildSettingsDeviceRow(other, current.id, "zh-CN");
  assert.equal(otherRow.isCurrent, false);
  assert.equal(otherRow.statusLabel, "活跃");
  assert.equal(otherRow.canRevoke, true);
  assert.equal(otherRow.deviceName, "Old iPad");
});

test("R20 P2-05 buildSettingsDeviceRow: revoked device is neither 本机 nor revocable, regardless of current-device probe", () => {
  const revoked = device({
    id: "cccccccc-0000-4000-8000-000000000003",
    revoked_at: "2026-07-18T04:00:00.000Z"
  });

  const row = buildSettingsDeviceRow(revoked, revoked.id, "en-US");
  assert.equal(row.isRevoked, true);
  assert.equal(row.isCurrent, false);
  assert.equal(row.canRevoke, false);
  assert.equal(row.statusLabel, "Revoked");
});

test("R20 P2-05 buildSettingsDeviceRow: when the current-device probe fails (plain web session, 403), no row is marked 本机", () => {
  const rowA = buildSettingsDeviceRow(device({ id: "a" }), null, "zh-CN");
  const rowB = buildSettingsDeviceRow(device({ id: "b" }), null, "zh-CN");
  assert.equal(rowA.isCurrent, false);
  assert.equal(rowB.isCurrent, false);
});

test("R20 P2-05 humanizeDeviceRevokeError: never silently swallows — always returns a non-empty, locale-correct message", () => {
  assert.equal(
    humanizeDeviceRevokeError({ code: "not_found" }, "zh-CN"),
    "没有找到这台设备，可能已经撤销过了。"
  );
  assert.equal(
    humanizeDeviceRevokeError({ code: "not_found" }, "en-US"),
    "That device wasn't found — it may already be revoked."
  );
  assert.equal(
    humanizeDeviceRevokeError({ code: "forbidden" }, "en-US"),
    "You don't have permission to revoke that device."
  );
  // 未知错误形态（网络错误/裸 Error/非对象）也必须兜底成人话，绝不返回空串或抛出。
  assert.equal(humanizeDeviceRevokeError(new Error("boom"), "zh-CN"), "撤销失败，请稍后重试。");
  assert.equal(humanizeDeviceRevokeError(null, "en-US"), "Revoke failed, please try again.");
  assert.equal(humanizeDeviceRevokeError("weird-string-error", "en-US"), "Revoke failed, please try again.");
});
