import { NextResponse } from "next/server";
import {
  PUBLIC_STATUS,
  logServerFailure,
  newCorrelationId,
  publicError,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import type { CommandFailure } from "./commands";

/**
 * The ONLY way a canonical route returns a failure.
 *
 * Routing every error through one function is what makes "no raw database
 * detail reaches a browser" checkable rather than aspirational: there is a
 * single place to audit, and `tests/couranr-error-safety.test.ts` fails the
 * build if a route builds an error body any other way.
 */
export function failureResponse(failure: CommandFailure) {
  return NextResponse.json(
    publicError({
      correlationId: failure.correlationId,
      code: failure.code,
      message: failure.message,
      details: failure.details,
    }),
    { status: PUBLIC_STATUS[failure.code] }
  );
}

/**
 * For failures the route itself raises before any command runs — a malformed
 * body, a missing id. Still carries a correlation id so support sees the same
 * shape for every failure.
 */
export function routeFailure(code: PublicErrorCode, message?: string) {
  return NextResponse.json(
    publicError({ correlationId: newCorrelationId(), code, message }),
    { status: PUBLIC_STATUS[code] }
  );
}

/**
 * For a route that must FAIL CLOSED on an infrastructure error.
 *
 * Logs the real cause under a correlation id and returns only the sanitized
 * body carrying that id. Use this wherever a failed lookup would otherwise be
 * indistinguishable from an empty result — treating "the query errored" as
 * "there are no rows" is how a returning merchant gets told they are new.
 */
export function routeInternalFailure(params: {
  operation: string;
  detail?: unknown;
  message?: string;
}) {
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation: params.operation,
    code: "internal",
    detail: params.detail,
  });
  return NextResponse.json(
    publicError({ correlationId, code: "internal", message: params.message }),
    { status: PUBLIC_STATUS.internal }
  );
}
