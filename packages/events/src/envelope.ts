import type { Actor, CuuState, EventType, WorkHubEvent } from "@workhub/contracts";

type RuntimeCrypto = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

function runtimeCrypto(): RuntimeCrypto | undefined {
  return (globalThis as typeof globalThis & { crypto?: RuntimeCrypto }).crypto;
}

function randomByteValues() {
  const bytes = new Uint8Array(16);
  const crypto = runtimeCrypto();
  if (crypto?.getRandomValues) {
    return crypto.getRandomValues(bytes);
  }
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

export function createWorkHubEventId(): string {
  const crypto = runtimeCrypto();
  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  const bytes = randomByteValues();
  const versionByte = bytes[6] ?? 0;
  const variantByte = bytes[8] ?? 0;
  bytes[6] = (versionByte & 0x0f) | 0x40;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type MakeWorkHubEventInput<T> = {
  type: EventType;
  topic: string;
  data: T;
  event_id?: string;
  ts?: Date;
  actor?: Actor;
  work_item_id?: string;
  project_id?: string;
  session_id?: string;
  run_id?: string;
  proposal_id?: string;
  preview_text?: string;
  cuu_state?: CuuState;
  attention?: WorkHubEvent<T>["attention"];
};

export function makeWorkHubEvent<T>(input: MakeWorkHubEventInput<T>): WorkHubEvent<T> {
  const event: WorkHubEvent<T> = {
    event_id: input.event_id ?? createWorkHubEventId(),
    type: input.type,
    topic: input.topic,
    ts: (input.ts ?? new Date()).toISOString(),
    data: input.data
  };

  if (input.actor) {
    event.actor = input.actor;
  }
  if (input.work_item_id) {
    event.work_item_id = input.work_item_id;
  }
  if (input.project_id) {
    event.project_id = input.project_id;
  }
  if (input.session_id) {
    event.session_id = input.session_id;
  }
  if (input.run_id) {
    event.run_id = input.run_id;
  }
  if (input.proposal_id) {
    event.proposal_id = input.proposal_id;
  }
  if (input.preview_text) {
    event.preview_text = input.preview_text.slice(0, 200);
  }
  if (input.cuu_state) {
    event.cuu_state = input.cuu_state;
  }
  if (input.attention) {
    event.attention = input.attention;
  }

  return event;
}
