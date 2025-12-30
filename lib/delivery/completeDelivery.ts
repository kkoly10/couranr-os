import { supabase } from "@/lib/supabaseClient";
import { capturePayment } from "@/lib/stripe/capturePayment";

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

  if (order.status === "completed") {
    return order; // idempotent protection
  }

  if (!order.payment_intent_id) {
    throw new Error("Missing payment intent");
  }

  // Capture payment
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

  if (updateError) {
    throw new Error("Failed to finalize order");
  }

  return updated;
}