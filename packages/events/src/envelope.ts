import { randomUUID } from "node:crypto";

import type { Actor, CuuState, EventType, WorkHubEvent } from "@workhub/contracts";

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
    event_id: input.event_id ?? randomUUID(),
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
