import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

export async function capturePayment(paymentIntentId: string) {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

  // Already captured = idempotent success
  if (intent.status === "succeeded") return intent;

  // Must be in requires_capture (because we authorized first)
  if (intent.status !== "requires_capture") {
    throw new Error(`Payment cannot be captured. Status: ${intent.status}`);
  }

  return await stripe.paymentIntents.capture(paymentIntentId);
}