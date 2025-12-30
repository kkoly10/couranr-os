import { stripe } from "../stripe";
import { supabase } from "../supabaseClient";

export async function capturePayment({
  orderId,
}: {
  orderId: string;
}) {
  // 1️⃣ Get payment intent from order
  const { data: order, error } = await supabase
    .from("orders")
    .select("stripe_payment_intent_id")
    .eq("id", orderId)
    .single();

  if (error || !order?.stripe_payment_intent_id) {
    throw new Error("Payment intent not found for order");
  }

  // 2️⃣ Capture payment
  const intent = await stripe.paymentIntents.capture(
    order.stripe_payment_intent_id
  );

  // 3️⃣ Update order status
  await supabase
    .from("orders")
    .update({
      payment_status: "captured",
    })
    .eq("id", orderId);

  return intent;
}
