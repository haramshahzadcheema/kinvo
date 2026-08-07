import { z } from 'zod';

/**
 * The JSON Schema handed to CALL-E as `resultSchema` on call creation —
 * CALL-E's own AI extraction validates its structured output against this
 * server-side before marking a call `completed` (a validation failure
 * instead surfaces as the `call.result_validation_failed` webhook event /
 * a null `structured_result`, both handled defensively in
 * outcomeTranslation.ts). `additionalProperties: false` and a closed
 * `enum` keep the extraction task unambiguous — deliberately not asking
 * for anything beyond the one fact Kinvo's workflow actually needs.
 */
export const CONFIRMATION_RESULT_JSON_SCHEMA = {
  type: 'object',
  required: ['confirmed'],
  additionalProperties: false,
  properties: {
    confirmed: {
      type: 'string',
      enum: ['yes', 'no', 'unclear'],
      description:
        "Whether the driver confirmed they will take the job. Use 'unclear' if the driver's answer could not be reasonably classified as a clear yes or no.",
    },
  },
} as const;

/**
 * Re-validates CALL-E's structured_result before Kinvo branches on it.
 * `resultSchema` only constrains what CALL-E's AI is asked to produce — it
 * is not a guarantee enforced on every historical or edge-case delivery, so
 * this output is untrusted external data like any other API response, not
 * a value Kinvo already knows the shape of.
 */
export const confirmationStructuredResultSchema = z.object({
  confirmed: z.enum(['yes', 'no', 'unclear']),
});
export type ConfirmationStructuredResult = z.infer<typeof confirmationStructuredResultSchema>;
