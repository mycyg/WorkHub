export type FormatSseEventOptions = {
  id?: string | undefined;
};

export function formatSseEvent(event: string, data: unknown, options: FormatSseEventOptions = {}) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  const lines = payload ? payload.split(/\r\n|\n|\r/u) : [""];
  const dataBlock = lines.map((line) => `data: ${line}`).join("\n");
  const idLine = options.id ? `id: ${options.id}\n` : "";
  return `${idLine}event: ${event}\n${dataBlock}\n\n`;
}

export function formatSseComment(comment: string) {
  return `: ${comment}\n\n`;
}

export type ParsedSseEvent = {
  id?: string | undefined;
  event: string;
  data: string;
};

export function parseSseFrames(input: string): ParsedSseEvent[] {
  return input
    .split(/\n\n/u)
    .filter((frame) => frame.trim().length > 0 && !frame.startsWith(":"))
    .map((frame) => {
      let id: string | undefined;
      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split(/\n/u)) {
        if (line.startsWith("id:")) {
          id = line.slice("id:".length).trim();
        } else if (line.startsWith("event:")) {
          event = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trimStart());
        }
      }
      return { ...(id ? { id } : {}), event, data: dataLines.join("\n") };
    });
}
