import { supabaseAdmin } from "../supabaseAdmin";

export type CreateOrderInput = {
  customerId: string;
  totalCents: number;
  serviceType: "delivery" | "docs" | "auto";
};

export async function createOrder(input: CreateOrderInput) {
  const { customerId, totalCents, serviceType } = input;

  const { data, error } = await supabaseAdmin
    .from("orders")
    .insert({
      customer_id: customerId,
      total_cents: totalCents,
      service_type: serviceType,
      payment_status: "pending",
    })
    .select()
    .single();

  if (error) {
    throw new Error(`createOrder failed: ${error.message}`);
  }

  return data;
}
