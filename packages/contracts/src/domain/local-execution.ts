import { z } from "zod";

import { executionHintSchema } from "./conversation.js";
import { idSchema, isoDateTimeSchema } from "./common.js";

const desktopExecutionHintSchema = executionHintSchema.extract(["local", "any"]);
const opaqueLeaseTokenSchema = z.string().min(1).max(512);
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const hmacSha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const safeNonnegativeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const localExecutionClaimRequestSchema = z
  .object({
    assignee_user_id: idSchema,
    accepted_execution_hints: z.array(desktopExecutionHintSchema).min(1).max(2)
  })
  .strict();
export type LocalExecutionClaimRequest = z.infer<typeof localExecutionClaimRequestSchema>;

export const localExecutionLeaseSchema = z
  .object({
    run_id: idSchema,
    lease_token: opaqueLeaseTokenSchema,
    lease_expires_at: isoDateTimeSchema,
    recovery_generation: safeNonnegativeIntegerSchema,
    recovery_attempt: safeNonnegativeIntegerSchema
  })
  .strict();
export type LocalExecutionLease = z.infer<typeof localExecutionLeaseSchema>;

export const localArtifactUploadSignatureSchema = z
  .object({
    run_id: idSchema,
    lease_token: opaqueLeaseTokenSchema,
    sha256: sha256HexSchema,
    size_bytes: safeNonnegativeIntegerSchema,
    algorithm: z.literal("hmac-sha256"),
    version: z.literal(1),
    signature: hmacSha256HexSchema
  })
  .strict();
export type LocalArtifactUploadSignature = z.infer<typeof localArtifactUploadSignatureSchema>;
