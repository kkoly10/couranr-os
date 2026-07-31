import { NextResponse } from "next/server";
import {
  PUBLIC_STATUS,
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
