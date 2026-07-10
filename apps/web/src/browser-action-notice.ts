export type BrowserActionNoticeSnapshot = {
  visible: boolean;
  seq: string | null;
  kind: string | null;
  actionId: string | null;
  body: string;
};

export function noticeSequence(value: string | null | undefined) {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function shouldRetryTransportActionNotice(input: {
  notice: BrowserActionNoticeSnapshot;
  previousSeq: number;
  actionId?: string;
}) {
  return input.notice.visible &&
    noticeSequence(input.notice.seq) > input.previousSeq &&
    input.notice.kind === "action_error" &&
    (input.actionId === undefined || input.notice.actionId === input.actionId) &&
    input.notice.body.includes("Failed to fetch");
}

export function isExpectedActionNotice(input: {
  notice: BrowserActionNoticeSnapshot;
  previousSeq: number;
  kind: string;
  actionId?: string;
}) {
  return input.notice.visible &&
    noticeSequence(input.notice.seq) > input.previousSeq &&
    input.notice.kind === input.kind &&
    (input.actionId === undefined || input.notice.actionId === input.actionId);
}
