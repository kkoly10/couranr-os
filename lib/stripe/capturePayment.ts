import { stripe } from "../stripe";
import { supabase } from "../supabaseClient";

export async function capturePayment({
  orderId,
}: {
  orderId: string;
}) {
  if (!orderId) {
    throw new Error("capturePayment: orderId is required");
  }

  // 1️⃣ Get Stripe PaymentIntent ID from order
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("stripe_payment_intent_id")
    .eq("id", orderId)
    .single();

  if (orderError || !order?.stripe_payment_intent_id) {
    throw new Error("capturePayment: PaymentIntent not found for order");
  }

  // 2️⃣ Capture payment
  const intent = await stripe.paymentIntents.capture(
    order.stripe_payment_intent_id
  );

  // 3️⃣ Update order status
  const { error: updateError } = await supabase
    .from("orders")
    .update({
      payment_status: "captured",
    })
    .eq("id", orderId);

  if (updateError) {
    throw new Error(
      `capturePayment: failed to update order: ${updateError.message}`
    );
  }

  return intent;
}
