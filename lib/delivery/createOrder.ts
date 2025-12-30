import { supabase } from "../supabaseClient";

export type CreateOrderInput = {
  customerId: string;
  totalCents: number;
  serviceType: "delivery";
};

export async function createOrder({ customerId, totalCents, serviceType }: CreateOrderInput) {
  if (!customerId) throw new Error("createOrder: customerId is required");
  if (!totalCents || totalCents < 50) throw new Error("createOrder: totalCents is invalid");

  const orderNumber = `CR-${Date.now()}`;

  const { data, error } = await supabase
    .from("orders")
    .insert({
      customer_id: customerId,
      service_type: serviceType,
      order_number: orderNumber,
      total_cents: totalCents,
      status: "pending",          // adjust if your enum differs
      payment_status: "pending",  // adjust if your enum differs
    })
    .select("id, order_number, total_cents")
    .single();

  if (error) throw new Error(`createOrder failed: ${error.message}`);
  if (!data?.id) throw new Error("createOrder failed: missing order id");

  return {
    orderId: data.id as string,
    orderNumber: data.order_number as string,
    totalCents: data.total_cents as number,
  };
}