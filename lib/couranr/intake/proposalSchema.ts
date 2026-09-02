/**
 * P5-001 — the structured-output schema a provider is asked to fill.
 *
 * This is the OUTBOUND contract: it tells the model which shape to produce so
 * that a well-behaved response parses on the first try. It is deliberately
 * the same shape `validateProviderOutput` accepts, but it is NOT the
 * boundary — the validator in `interpret.ts` runs on every response, after
 * the schema, and drops anything the schema could not or did not enforce.
 *
 * Two of the requirement's bounds are NOT expressed as JSON-Schema keywords
 * here, on purpose. The structured-outputs API rejects a raw schema that
 * carries `maxLength`, `maxItems`, `minimum` or `maximum` with a 400
 * ("String constraints (minLength, maxLength)", "Array constraints beyond
 * minItems of 0 or 1" and "Numerical constraints" are all listed as
 * unsupported, and a raw schema passed to `messages.create` is sent to the
 * API unchanged). So the 50-fact cap, the 500-character evidence cap and the
 * 0–100 confidence range are stated in `description` for the model and
 * ENFORCED by `validateProviderOutput`, which is where they were enforced
 * before any real provider existed. `tests/couranr-intake-anthropic.test.ts`
 * pins the schema to the supported subset so nobody re-adds a keyword that
 * would turn every request into a 400.
 */

import { FACT_KEYS, MAX_FACT_STRING_LENGTH } from "@/lib/couranr/shipment/facts";

/** Mirrors the hard cap in `validateProviderOutput`. Enforced there, not here. */
export const PROPOSAL_MAX_FACTS = 50;

/**
 * JSON-Schema keywords the structured-outputs API does not accept in a raw
 * schema. Kept next to the schema so the test that scans for them has one
 * source of truth to read.
 */
export const UNSUPPORTED_STRUCTURED_OUTPUT_KEYWORDS = [
  "maxLength",
  "minLength",
  "maxItems",
  "minimum",
  "maximum",
  "multipleOf",
  "pattern",
] as const;

export const PROPOSAL_JSON_SCHEMA = {
  type: "object",
  description:
    "Shipment facts proposed from the merchant's description. Propose only what the text supports.",
  properties: {
    facts: {
      type: "array",
      description: `At most ${PROPOSAL_MAX_FACTS} entries, at most one entry per key. An empty array is a valid answer.`,
      items: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "One of the closed fact keys. Never invent a key.",
            enum: [...FACT_KEYS],
          },
          value: {
            description:
              "The normalized value for this key: a boolean for yes/no keys, a number for counts and weights, otherwise a short string from the documented vocabulary.",
            anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
          },
          confidence: {
            type: "integer",
            description: "Integer from 0 to 100. How strongly the text supports this value.",
          },
          sourceEvidence: {
            type: "string",
            description: `The exact span of the merchant's text this value came from, at most ${MAX_FACT_STRING_LENGTH} characters. Quote; do not paraphrase.`,
          },
        },
        required: ["key", "value", "confidence", "sourceEvidence"],
        additionalProperties: false,
      },
    },
    overallConfidence: {
      type: "integer",
      description: "Integer from 0 to 100. Overall confidence in the set of proposals.",
    },
  },
  required: ["facts", "overallConfidence"],
  additionalProperties: false,
} as const;

export type ProposalJsonSchema = typeof PROPOSAL_JSON_SCHEMA;
