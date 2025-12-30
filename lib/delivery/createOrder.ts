import { supabase } from "../supabaseClient";

export async function createOrder({
  customerId,
  totalCents,
  serviceType,
}: {
  customerId: string;
  totalCents: number;
  serviceType: "delivery";
}) {
  const orderNumber = `CR-${Date.now()}`;

  const { data, error } = await supabase
    .from("orders")
    .insert({
      customer_id: customerId,
      service_type: serviceType,
      order_number: orderNumber,
      total_cents: totalCents,
      status: "pending",
      payment_status: "pending",
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error("Failed to create order");
  }

  return {
    orderId: data.id,
    orderNumber: data.order_number,
  };
}