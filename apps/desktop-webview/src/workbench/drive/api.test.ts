import assert from "node:assert/strict";
import { test } from "node:test";

import type { DrivePageVM } from "@workhub/contracts";

import { fetchDriveItemTextPreview, fetchDriveItemVersions, rollbackDriveItemVersion, type DriveVersionHistory, type DriveVersionsApiClient } from "./api.js";

function fakeClient(handler: (path: string, init?: RequestInit) => unknown): DriveVersionsApiClient {
  return {
    request: async <T>(path: string, init?: RequestInit) => handler(path, init) as T
  };
}

function history(): DriveVersionHistory {
  return {
    item_id: "item-1",
    filename: "report.md",
    current_version_id: "v2",
    versions: [
      { id: "v2", version_no: 2, filename: "report.md", size_bytes: 2048, created_at: "2026-07-12T09:00:00.000000Z", created_by_label: "阿曼", current: true },
      { id: "v1", version_no: 1, filename: "report.md", size_bytes: 1024, created_at: "2026-07-10T09:00:00.000000Z", created_by_label: "阿曼", current: false, restore_href: "/api/drive/projects/p1/items/item-1/versions/v1/restore" }
    ]
  };
}

test("fetchDriveItemVersions requests the item's versions path without a query string when no limit is given", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const client = fakeClient((path, init) => {
    calls.push({ path, init });
    return history();
  });

  const result = await fetchDriveItemVersions(client, "p1", "item-1");

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/api/drive/projects/p1/items/item-1/versions");
  assert.equal(calls[0]!.init, undefined);
  assert.deepEqual(result, history());
});

test("fetchDriveItemVersions appends limit as a query param when given", async () => {
  const calls: string[] = [];
  const client = fakeClient((path) => {
    calls.push(path);
    return history();
  });

  await fetchDriveItemVersions(client, "p1", "item-1", { limit: 10 });

  assert.equal(calls[0], "/api/drive/projects/p1/items/item-1/versions?limit=10");
});

test("fetchDriveItemVersions URL-encodes the project and item ids", async () => {
  const calls: string[] = [];
  const client = fakeClient((path) => {
    calls.push(path);
    return history();
  });

  await fetchDriveItemVersions(client, "p 1", "item/1");

  assert.equal(calls[0], "/api/drive/projects/p%201/items/item%2F1/versions");
});

test("rollbackDriveItemVersion posts to the versionId's restore path and returns the refreshed drive page", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const refreshedPage = { generated_at: "2026-07-12T09:00:00.000000Z" } as unknown as DrivePageVM;
  const client = fakeClient((path, init) => {
    calls.push({ path, init });
    return refreshedPage;
  });

  const result = await rollbackDriveItemVersion(client, "p1", "item-1", "v1");

  assert.equal(calls[0]!.path, "/api/drive/projects/p1/items/item-1/versions/v1/restore");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.equal(result, refreshedPage);
});

// —— fetchDriveItemTextPreview —— //
// 桌面 webview 不与 API 同源，预览走 spotlight/views/drive.ts 导出的 fetchDriveResource（读
// window.localStorage 里的 client-token）——照该模块自己的既有测试同款手法 mock window/fetch。

function withMockedWindowAndFetch(
  handler: (url: string, init: RequestInit | undefined) => Response,
  run: () => Promise<void>
): Promise<void> {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } }
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init)
  });
  return run().finally(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
    Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
  });
}

test("fetchDriveItemTextPreview returns the preview text and download href on success", async () => {
  await withMockedWindowAndFetch(
    () =>
      new Response(
        JSON.stringify({ ok: true, data: { text: "hello", truncated: false, download_href: "/api/drive/projects/p1/items/item-1/download" } }),
        { status: 200 }
      ),
    async () => {
      const result = await fetchDriveItemTextPreview("p1", "item-1", "http://127.0.0.1:8787");
      assert.deepEqual(result, {
        ok: true,
        text: "hello",
        truncated: false,
        downloadHref: "/api/drive/projects/p1/items/item-1/download"
      });
    }
  );
});

test("fetchDriveItemTextPreview distinguishes 'unsupported file type' (415) from a real failure", async () => {
  await withMockedWindowAndFetch(
    () => new Response(JSON.stringify({ ok: false, error: { code: "drive_preview_unsupported", message: "no preview" } }), { status: 415 }),
    async () => {
      const result = await fetchDriveItemTextPreview("p1", "item-1", "http://127.0.0.1:8787");
      assert.deepEqual(result, { ok: false, unsupported: true });
    }
  );
});

test("fetchDriveItemTextPreview surfaces a real failure with the server's message, not a generic string", async () => {
  await withMockedWindowAndFetch(
    () => new Response(JSON.stringify({ ok: false, error: { message: "你没有权限查看这个项目网盘。" } }), { status: 403 }),
    async () => {
      const result = await fetchDriveItemTextPreview("p1", "item-1", "http://127.0.0.1:8787");
      assert.deepEqual(result, { ok: false, unsupported: false, message: "你没有权限查看这个项目网盘。" });
    }
  );
});

test("fetchDriveItemTextPreview falls back to a derived download href when the server omits one", async () => {
  await withMockedWindowAndFetch(
    () => new Response(JSON.stringify({ ok: true, data: { text: "hi", truncated: false } }), { status: 200 }),
    async () => {
      const result = await fetchDriveItemTextPreview("p1", "item-1", "http://127.0.0.1:8787");
      assert.equal(result.ok, true);
      assert.equal((result as { downloadHref: string }).downloadHref, "/api/drive/projects/p1/items/item-1/download");
    }
  );
});
