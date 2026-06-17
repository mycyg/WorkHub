export type FormatSseEventOptions = {
  id?: string | undefined;
};

// findings：event-name 与 id 直接进 SSE 帧，若含 CR/LF 会伪造额外 SSE 字段/帧（字段注入）。
// data 已按行拆成多条 data: 行处理；这里把 event/id 里的 CR/LF 剥掉，使该原语无论调用方如何传都安全。
function stripSseControl(value: string) {
  return value.replace(/[\r\n]/gu, "");
}

export function formatSseEvent(event: string, data: unknown, options: FormatSseEventOptions = {}) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  const lines = payload ? payload.split(/\r\n|\n|\r/u) : [""];
  const dataBlock = lines.map((line) => `data: ${line}`).join("\n");
  const idLine = options.id ? `id: ${stripSseControl(options.id)}\n` : "";
  return `${idLine}event: ${stripSseControl(event)}\n${dataBlock}\n\n`;
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
