import { parseSseFrames, type ParsedSseEvent } from "@workhub/events";
import type { WorkHubEvent } from "@workhub/contracts";

export type WorkHubSseMessage<T = unknown> = ParsedSseEvent & {
  json?: T;
};

export function parseWorkHubSse<T = unknown>(input: string): WorkHubSseMessage<T>[] {
  return parseSseFrames(input).map((frame) => {
    try {
      return {
        ...frame,
        json: JSON.parse(frame.data) as T
      };
    } catch {
      return frame;
    }
  });
}

export function parseWorkHubEventSse<T = unknown>(input: string): WorkHubEvent<T>[] {
  return parseWorkHubSse<WorkHubEvent<T>>(input)
    .map((message) => message.json)
    .filter((event): event is WorkHubEvent<T> => isWorkHubEvent(event));
}

export function parseRunEventSse<T = unknown>(runId: string, input: string): WorkHubEvent<T>[] {
  const topic = `run:${runId}`;
  return parseWorkHubEventSse<T>(input).filter((event) => event.topic === topic || event.run_id === runId);
}

function isWorkHubEvent<T = unknown>(input: unknown): input is WorkHubEvent<T> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  const record = input as Record<string, unknown>;
  return (
    typeof record.event_id === "string" &&
    typeof record.type === "string" &&
    typeof record.topic === "string" &&
    typeof record.ts === "string" &&
    "data" in record
  );
}
