import { z } from "zod";

import { idSchema } from "./domain/common.js";

export const resolveEscalationActions = ["retry", "pm_mode", "cancel"] as const;
export const resolveEscalationActionSchema = z.enum(resolveEscalationActions);
export type ResolveEscalationAction = z.infer<typeof resolveEscalationActionSchema>;

export const resolveEscalationRequestSchema = z.object({
  action: resolveEscalationActionSchema,
  reason_md: z.string().trim().min(1).max(2000).optional()
});
export type ResolveEscalationRequest = z.infer<typeof resolveEscalationRequestSchema>;

export const delegateEscalationRequestSchema = z.object({
  to_user_id: idSchema,
  reason_md: z.string().trim().min(1).max(2000).optional()
});
export type DelegateEscalationRequest = z.infer<typeof delegateEscalationRequestSchema>;
