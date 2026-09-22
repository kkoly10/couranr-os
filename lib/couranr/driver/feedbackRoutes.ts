import { NextRequest, NextResponse } from "next/server";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  prepareDriverTip, readDriverFeedback, reconcileDriverTipForViewer,
  submitDriverReview, type FeedbackScope,
} from "./feedback";
import { classifyDatabaseError } from "@/lib/couranr/errors";
import { routeFailure, routeInternalFailure } from "@/lib/couranr/requests/respond";

assertServerOnly("lib/couranr/driver/feedbackRoutes.ts");

const noStore = { "Cache-Control": "no-store" };
const unavailable = () => routeFailure("not_found", "Feedback is unavailable for this delivery.");

/** The routes resolve identity; this shared handler never accepts an audience or driver from JSON. */
export async function handleFeedbackRequest(
  req: NextRequest, deliveryId: string, scope: FeedbackScope,
): Promise<NextResponse> {
  try {
    if (req.method === "GET") {
      return NextResponse.json({ feedback: await readDriverFeedback(deliveryId, scope) },
        { headers: noStore });
    }
    let body: any;
    try { body = await req.json(); }
    catch { return routeFailure("invalid_input", "Choose a review or tip action."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return routeFailure("invalid_input", "Choose a review or tip action.");
    }
    if (body.action === "review") {
      const rating = Number(body.rating);
      const comment = typeof body.comment === "string" ? body.comment.trim() : "";
      if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 1000) {
        return routeFailure("invalid_input", "Choose 1–5 stars and a short optional note.");
      }
      return NextResponse.json({ feedback: await submitDriverReview({
        deliveryId, scope, rating, comment,
      }) }, { headers: noStore });
    }
    if (body.action === "tip") {
      const amountCents = Number(body.amountCents);
      if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 10000) {
        return routeFailure("invalid_input", "Enter a voluntary tip from $1 to $100.");
      }
      return NextResponse.json({ tip: await prepareDriverTip({ deliveryId, scope, amountCents }) },
        { headers: noStore });
    }
    if (body.action === "reconcile") {
      return NextResponse.json({ feedback: await reconcileDriverTipForViewer(deliveryId, scope) },
        { headers: noStore });
    }
    return unavailable();
  } catch (cause: unknown) {
    const code = classifyDatabaseError(cause);
    if (code === "not_found" || code === "not_permitted") return unavailable();
    if (code === "version_conflict" || code === "conflict") {
      return routeFailure("conflict", "Feedback for this delivery already exists or has changed.");
    }
    if (code === "invalid_input") return routeFailure("invalid_input", "Feedback could not be accepted.");
    return routeInternalFailure({
      operation: "driverFeedback",
      detail: cause,
      message: "We could not process feedback right now. Nothing new was charged.",
    });
  }
}
