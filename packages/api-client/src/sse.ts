import { parseSseFrames, type ParsedSseEvent } from "@workhub/events";

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
