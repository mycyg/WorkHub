import assert from "node:assert/strict";
import test from "node:test";

import { InProcessPushBus } from "./broker/memory.js";
import { InMemoryPresenceStore, ONLINE_TTL_SECONDS } from "./broker/presence.js";
import type { PushEvent } from "@workhub/events";

test("in-process bus preserves per-subscriber queue delivery", async () => {
  const bus = new InProcessPushBus();
  const subscription = await bus.subscribe("workitem:w1");

  await bus.publish("workitem:w1", "agent_run.step", { step: 1 });

  const first = await subscription[Symbol.asyncIterator]().next();
  assert.equal(first.done, false);
  assert.deepEqual(first.value, {
    topic: "workitem:w1",
    type: "agent_run.step",
    data: { step: 1 }
  });

  await bus.unsubscribe("workitem:w1", subscription);
});

test("local queue keeps the old maxsize/drop-slow-subscriber backpressure rule", async () => {
  const bus = new InProcessPushBus(2);
  const subscription = await bus.subscribe("run:r1");
  const iterator = subscription[Symbol.asyncIterator]();

  await bus.publish("run:r1", "agent_run.step", { step: 1 });
  await bus.publish("run:r1", "agent_run.step", { step: 2 });
  await bus.publish("run:r1", "agent_run.step", { step: 3 });

  assert.equal(((await iterator.next()).value as PushEvent<{ step: number }>).data.step, 1);
  assert.equal(((await iterator.next()).value as PushEvent<{ step: number }>).data.step, 2);
  assert.equal(await nextOrTimeout(iterator, 20), "timeout");

  await bus.unsubscribe("run:r1", subscription);
});

test("presence follows stream count or recent last-seen within the LAN TTL", async () => {
  let tick = 0;
  const presence = new InMemoryPresenceStore(() => new Date(1000 + tick));

  await presence.markStreamOpen("u1");
  assert.equal((await presence.getPresence("u1")).is_online, true);

  await presence.markStreamClosed("u1");
  assert.equal((await presence.getPresence("u1")).is_online, true);

  tick = (ONLINE_TTL_SECONDS + 1) * 1000;
  assert.equal((await presence.getPresence("u1")).is_online, false);
});

async function nextOrTimeout(iterator: AsyncIterator<PushEvent>, ms: number) {
  return Promise.race([
    iterator.next(),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms))
  ]);
}
