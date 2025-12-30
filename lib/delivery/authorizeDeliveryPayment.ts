import Stripe from "stripe";
import { supabase } from "../supabaseClient";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-04-10", // ✅ FIXED — matches installed Stripe SDK
});

export async function authorizeDeliveryPayment({
  orderId,
  amountCents,
}: {
  orderId: string;
  amountCents: number;
}) {
  if (!orderId) {
    throw new Error("authorizeDeliveryPayment: orderId is required");
  }

  if (!amountCents || amountCents < 50) {
    throw new Error("authorizeDeliveryPayment: invalid amount");
  }

  // 1️⃣ Create PaymentIntent (AUTHORIZE ONLY)
  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    capture_method: "manual",
    automatic_payment_methods: { enabled: true },
    metadata: {
      orderId,
      service: "couranr_delivery",
    },
  });

  // 2️⃣ Persist Stripe intent on order
  const { error } = await supabase
    .from("orders")
    .update({
      stripe_payment_intent_id: intent.id,
      payment_status: "authorized",
    })
    .eq("id", orderId);

  if (error) {
    throw new Error(
      `authorizeDeliveryPayment: failed to update order: ${error.message}`
    );
  }

  return {
    clientSecret: intent.client_secret as string,
  };
}
