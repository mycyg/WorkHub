import type { EventType, WorkHubEvent } from "@workhub/contracts";

export type PushEvent<T = unknown> = {
  topic: string;
  type: EventType | string;
  data: T;
};

export type EventData<TEvent> = TEvent extends WorkHubEvent<infer TData> ? TData : never;

export type EventPreview = {
  type: EventType | string;
  topic: string;
  preview_text?: string;
};
