import Stripe from "stripe";
import { supabase } from "../supabaseClient";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

type AuthorizeDeliveryPaymentInput = {
  orderId: string;
  amountCents: number;
};

export async function authorizeDeliveryPayment({
  orderId,
  amountCents,
}: AuthorizeDeliveryPaymentInput) {
  if (!orderId) {
    throw new Error("orderId is required to authorize payment");
  }

  if (!amountCents || amountCents < 50) {
    throw new Error("Invalid payment amount");
  }

  /**
   * 1. Create Stripe PaymentIntent (manual capture)
   */
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

  /**
   * 2. Persist PaymentIntent ID on the order
   */
  const { error } = await supabase
    .from("orders")
    .update({
      stripe_payment_intent_id: intent.id,
      payment_status: "authorized",
    })
    .eq("id", orderId);

  if (error) {
    throw new Error(
      `Failed to link payment intent to order: ${error.message}`
    );
  }

  /**
   * 3. Return client secret for Stripe Elements
   */
  return {
    clientSecret: intent.client_secret,
  };
}
