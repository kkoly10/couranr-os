import { supabaseAdmin } from "../supabaseAdmin";

type CreateOrderInput = {
  customerId: string;
  totalCents: number;
};

export async function createOrder({
  customerId,
  totalCents,
}: CreateOrderInput) {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .insert({
      customer_id: customerId,
      total_cents: totalCents,
      payment_status: "pending",
    })
    .select()
    .single();

  if (error) {
    throw new Error(`createOrder failed: ${error.message}`);
  }

  return data;
}
