import { z } from "zod";

import {
  keyResultStatusSchema,
  objectiveStatusSchema
} from "./enums.js";
import { idSchema, isoDateTimeSchema } from "./domain/common.js";

export const keyResultVmSchema = z.object({
  id: idSchema,
  objective_id: idSchema,
  seq: z.number().int().nonnegative(),
  title: z.string().min(1).max(256),
  status: keyResultStatusSchema.default("on_track"),
  progress_pct: z.number().int().min(0).max(100).default(0),
  target_value: z.string().min(1).optional(),
  current_value: z.string().min(1).optional(),
  unit: z.string().min(1).max(64).optional(),
  created_at: isoDateTimeSchema.optional(),
  updated_at: isoDateTimeSchema.optional()
});
export type KeyResultVM = z.infer<typeof keyResultVmSchema>;

export const objectiveVmSchema = z.object({
  id: idSchema,
  workspace_id: idSchema,
  title: z.string().min(1).max(256),
  description_md: z.string().optional(),
  status: objectiveStatusSchema.default("active"),
  progress_pct: z.number().int().min(0).max(100).default(0),
  key_results: z.array(keyResultVmSchema).default([]),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema
});
export type ObjectiveVM = z.infer<typeof objectiveVmSchema>;
