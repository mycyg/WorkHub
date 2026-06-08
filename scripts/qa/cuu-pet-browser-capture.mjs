import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const chromePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const url = process.env.CUU_PET_URL ?? "http://127.0.0.1:1420/pet.html";
const captureKind = process.env.CUU_PET_CAPTURE_KIND ?? "live2d-cat";
const waitSelector = process.env.CUU_PET_WAIT_SELECTOR ?? '[data-cuu-live2d-runtime="live2d_cubism2_cat"]';
const outDir = resolve(process.env.CUU_PET_CAPTURE_DIR ?? "docs/workhub/05-clients/assets/audit/2026-06-08-cuu-live2d-cat-runtime");
const width = Number(process.env.CUU_PET_CAPTURE_WIDTH ?? 240);
const height = Number(process.env.CUU_PET_CAPTURE_HEIGHT ?? 280);
const delays = (process.env.CUU_PET_CAPTURE_DELAYS ?? "0,900,1800,2700,3600")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value >= 0);
const debuggingPort = Number(process.env.CUU_PET_CDP_PORT ?? 9337);
const userDataDir = resolve("tmp/qa/chrome-cuu-pet-cdp");

mkdirSync(outDir, { recursive: true });
rmSync(userDataDir, { recursive: true, force: true });
mkdirSync(userDataDir, { recursive: true });

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=${userDataDir}`,
  `--window-size=${width},${height}`,
  "about:blank"
], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"]
});

let stderr = "";
chrome.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

try {
  const target = await waitForTarget();
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  });
  await cdp.send("Page.navigate", { url });
  await cdp.waitForEvent("Page.loadEventFired", 30000);
  await waitForRuntime(cdp, `document.querySelector(${JSON.stringify(waitSelector)}) !== null`, 30000);

  const start = Date.now();
  const frames = [];
  for (const delay of delays) {
    const elapsed = Date.now() - start;
    if (delay > elapsed) {
      await sleep(delay - elapsed);
    }
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    const name = `pet-${captureKind}-cdp-frame-${String(delay).padStart(4, "0")}.png`;
    writeFileSync(resolve(outDir, name), Buffer.from(screenshot.data, "base64"));
    frames.push(name);
  }

  const domProbe = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const root = document.querySelector('[data-wh-surface="pet"]');
      const live = document.querySelector('[data-cuu-live2d-runtime]');
      return {
        surface: root ? {...root.dataset} : null,
        live2d: live ? {...live.dataset} : null
      };
    })()`
  });
  writeFileSync(
    resolve(outDir, `pet-${captureKind}-cdp-dom.json`),
    JSON.stringify(domProbe.result.value, null, 2) + "\n",
    "utf8"
  );
  writeFileSync(
    resolve(outDir, `pet-${captureKind}-cdp-report.json`),
    JSON.stringify({ url, width, height, wait_selector: waitSelector, frames, captured_at: new Date().toISOString() }, null, 2) + "\n",
    "utf8"
  );
  await cdp.close();
} finally {
  chrome.kill();
}

async function waitForTarget() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`).then((response) => response.json());
      const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (target) {
        return target;
      }
    } catch {
      // Chrome is still starting.
    }
    await sleep(200);
  }
  throw new Error(`Chrome DevTools target did not become available. stderr:\n${stderr}`);
}

function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const eventWaiters = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        item.reject(new Error(message.error.message));
      } else {
        item.resolve(message.result ?? {});
      }
      return;
    }
    if (message.method && eventWaiters.has(message.method)) {
      const waiters = eventWaiters.get(message.method);
      eventWaiters.delete(message.method);
      for (const waiter of waiters) {
        waiter.resolve(message.params ?? {});
      }
    }
  });

  return new Promise((resolvePromise, rejectPromise) => {
    socket.addEventListener("open", () => {
      resolvePromise({
        send(method, params = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
          });
        },
        waitForEvent(method, timeoutMs) {
          return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`Timed out waiting for CDP event ${method}.`));
            }, timeoutMs);
            const entry = {
              resolve(value) {
                clearTimeout(timeout);
                resolve(value);
              }
            };
            const waiters = eventWaiters.get(method) ?? [];
            waiters.push(entry);
            eventWaiters.set(method, waiters);
          });
        },
        close() {
          socket.close();
        }
      });
    });
    socket.addEventListener("error", () => rejectPromise(new Error("Failed to connect Chrome DevTools WebSocket.")));
  });
}

async function waitForRuntime(cdp, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
    if (result.result?.value === true) {
      return;
    }
    await sleep(200);
  }
  throw new Error(`Runtime condition did not become true: ${expression}`);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
