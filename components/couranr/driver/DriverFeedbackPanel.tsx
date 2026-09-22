"use client";

import * as React from "react";
import { Alert, Button, Card, CardHeader, Stack, Text } from "@/components/couranr/primitives";
import { DriverTipPaymentElement } from "@/components/couranr/payments/DriverTipPaymentElement";
import { formatCents } from "@/lib/couranr/requests/view";
import type { FeedbackView } from "@/lib/couranr/driver/feedbackTypes";

export type DriverFeedbackReply = {
  feedback?: FeedbackView;
  tip?: { clientSecret: string | null; state: string; amountCents: number };
  error?: string;
};
export type DriverFeedbackRequest = (body?: Record<string, unknown>) => Promise<DriverFeedbackReply | null>;

/** Rendered only for delivered state. Recipient/sender/merchant routes each
 * re-prove their own delivery scope; no driver ID is ever sent by this panel. */
export function DriverFeedbackPanel(props: {
  request: DriverFeedbackRequest;
}) {
  const [feedback, setFeedback] = React.useState<FeedbackView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [rating, setRating] = React.useState(5);
  const [comment, setComment] = React.useState("");
  const [tipDollars, setTipDollars] = React.useState("5");
  const [tipSecret, setTipSecret] = React.useState<string | null>(null);
  const [tipAmount, setTipAmount] = React.useState(0);
  const busy = React.useRef(false);
  const requestRef = React.useRef(props.request);
  React.useEffect(() => {
    requestRef.current = props.request;
  }, [props.request]);

  React.useEffect(() => {
    let alive = true;
    void requestRef.current().then((r) => {
      if (!alive) return;
      if (r?.feedback) {
        setFeedback(r.feedback);
        // A redirect may have completed the payment in another navigation.
        // Re-read Stripe once before offering any retry of a pending intent.
        if (r.feedback.tip && ["pending", "prepared", "failed"].includes(r.feedback.tip.paymentState)) {
          void requestRef.current({ action: "reconcile" }).then((fresh) => {
            if (alive && fresh?.feedback) setFeedback(fresh.feedback);
          });
        }
      }
      else setError(r?.error ?? "Feedback is not available right now.");
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  async function review() {
    if (busy.current) return;
    busy.current = true; setError(null);
    try {
      const r = await props.request({ action: "review", rating, comment });
      if (r?.feedback) setFeedback(r.feedback);
      else setError(r?.error ?? "Your review could not be saved.");
    } finally { busy.current = false; }
  }

  async function startTip() {
    if (busy.current) return;
    const amountCents = Math.round(Number(tipDollars) * 100);
    if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 10000) {
      setError("Choose a voluntary tip from $1 to $100."); return;
    }
    busy.current = true; setError(null);
    try {
      const r = await props.request({ action: "tip", amountCents });
      if (r?.tip?.clientSecret) {
        setTipSecret(r.tip.clientSecret); setTipAmount(r.tip.amountCents);
      } else if (r?.tip?.state === "succeeded") {
        const fresh = await props.request({ action: "reconcile" });
        if (fresh?.feedback) setFeedback(fresh.feedback);
      } else setError(r?.error ?? "The secure tip form could not be opened.");
    } finally { busy.current = false; }
  }

  async function reconcile(): Promise<"succeeded" | "pending" | "failed"> {
    const r = await props.request({ action: "reconcile" });
    if (r?.feedback) {
      setFeedback(r.feedback);
      if (r.feedback.tip?.paymentState === "succeeded" && r.feedback.tip.capturedAmountCents > 0) {
        return "succeeded";
      }
      return r.feedback.tip?.paymentState === "failed" ? "failed" : "pending";
    }
    setError(r?.error ?? "The tip could not be verified yet.");
    return "pending";
  }

  if (loading) return <Card><Text>Loading driver feedback…</Text></Card>;
  if (!feedback) return <Card><Text>{error ?? "Feedback is unavailable."}</Text></Card>;

  const tip = feedback.tip;
  const paid = Boolean(tip?.capturedAmountCents) && tip?.paymentState === "succeeded";
  return <Card data-couranr-driver-feedback="true">
    <CardHeader title="How was your delivery?" description="Your feedback is private to Couranr Operations." />
    <Stack gap={4}>
      <Text>Driver: {feedback.driverName || "Couranr driver"}</Text>
      {feedback.review ? (
        <Alert tone="success" title="Review received">
          {feedback.review.rating} out of 5 stars. Thank you for helping us improve.
        </Alert>
      ) : (
        <div>
          <label htmlFor="couranr-driver-rating">Rate your driver</label>
          <select id="couranr-driver-rating" value={rating}
            onChange={(e) => setRating(Number(e.target.value))}>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n === 1 ? "" : "s"}</option>)}
          </select>
          <label htmlFor="couranr-driver-review">Optional private note</label>
          <textarea id="couranr-driver-review" value={comment} maxLength={1000}
            onChange={(e) => setComment(e.target.value)} rows={3} />
          <Button type="button" onClick={() => void review()}>Send review</Button>
        </div>
      )}
      <div>
        <Text strong>Leave an optional driver tip</Text>
        <Text size="sm" muted>
          Couranr collects tips in its company account and allocates the full amount
          to the assigned driver for payroll. This does not change your delivery charge.
        </Text>
        {paid ? <Alert tone="success" title="Tip received">
          {formatCents(tip!.capturedAmountCents)} was received for your driver.
        </Alert> : tip?.paymentState === "refunded" ? (
          <Text>This tip was refunded.</Text>
        ) : tip?.paymentState === "partially_refunded" ? (
          <Text>This tip was partially refunded. Couranr Support can help with the balance.</Text>
        ) : tip?.paymentState === "disputed" ? (
          <Alert tone="warning" title="Tip under payment review">
            {formatCents(tip.disputedAmountCents)} is on hold while the payment provider reviews a dispute.
          </Alert>
        ) : tip?.paymentState === "dispute_lost" ? (
          <Text>This tip was reversed after a payment dispute.</Text>
        ) : tipSecret ? (
          <DriverTipPaymentElement clientSecret={tipSecret} amountCents={tipAmount}
            onReconcile={reconcile} />
        ) : (
          <div>
            <label htmlFor="couranr-driver-tip-amount">Tip amount (USD)</label>
            <input id="couranr-driver-tip-amount" type="number" min="1" max="100" step="0.01"
              value={tip?.amountCents ? (tip.amountCents / 100).toFixed(2) : tipDollars}
              disabled={Boolean(tip)}
              onChange={(e) => setTipDollars(e.target.value)} />
            <Button type="button" onClick={() => void startTip()}>
              {tip ? "Continue secure tip payment" : "Continue to tip payment"}
            </Button>
          </div>
        )}
      </div>
      {error ? <Alert tone="warning" title="Please try again">{error}</Alert> : null}
    </Stack>
  </Card>;
}
