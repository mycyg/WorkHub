export function formatSseEvent(event: string, data: unknown) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  const lines = payload ? payload.split(/\r\n|\n|\r/u) : [""];
  const dataBlock = lines.map((line) => `data: ${line}`).join("\n");
  return `event: ${event}\n${dataBlock}\n\n`;
}

export function formatSseComment(comment: string) {
  return `: ${comment}\n\n`;
}

export type ParsedSseEvent = {
  event: string;
  data: string;
};

export function parseSseFrames(input: string): ParsedSseEvent[] {
  return input
    .split(/\n\n/u)
    .filter((frame) => frame.trim().length > 0 && !frame.startsWith(":"))
    .map((frame) => {
      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split(/\n/u)) {
        if (line.startsWith("event:")) {
          event = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trimStart());
        }
      }
      return { event, data: dataLines.join("\n") };
    });
}
