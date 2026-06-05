import { z } from "zod";

import { auditLogFactSchema, manifestFactsSchema } from "./audit.js";
import { replayTraceVmSchema } from "./pages.js";

export const replayTracePageVmSchema = replayTraceVmSchema.extend({
  audit_logs: z.array(auditLogFactSchema).default([]),
  manifest_facts: manifestFactsSchema.optional()
});
export type ReplayTracePageVM = z.infer<typeof replayTracePageVmSchema>;
