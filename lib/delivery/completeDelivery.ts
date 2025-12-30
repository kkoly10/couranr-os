import { supabase } from "../supabaseClient";
import { capturePayment } from "../stripe/capturePayment";

export async function completeDelivery(orderId: string) {
  // Fetch order
  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (error || !order) {
    throw new Error("Order not found");
  }

  // Idempotency: if already completed, do nothing
  if (order.status === "completed" || order.payment_status === "captured") {
    return order;
  }

  if (!order.payment_intent_id) {
    throw new Error("Missing payment_intent_id on order");
  }

  // Capture Stripe payment intent (idempotent helper)
  await capturePayment(order.payment_intent_id);

  // Mark order complete
  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update({
      status: "completed",
      payment_status: "captured",
      completed_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(updateError?.message || "Failed to finalize order");
  }

  return updated;
}