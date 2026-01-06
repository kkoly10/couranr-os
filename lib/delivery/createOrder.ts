import { supabaseAdmin } from "../supabaseAdmin";

export type CreateOrderInput = {
  customerId: string;
  totalCents: number;
  serviceType: "delivery" | "docs" | "auto";
};

export type CreateOrderResult = {
  id: string;
  order_number: string;
  total_cents: number;
  service_type: string;
  customer_id: string;
  created_at: string;
};

export async function createOrder(
  input: CreateOrderInput
): Promise<CreateOrderResult> {
  const { customerId, totalCents, serviceType } = input;

  const { data, error } = await supabaseAdmin
    .from("orders")
    .insert({
      customer_id: customerId,
      total_cents: totalCents,
      service_type: serviceType,
      // ❌ DO NOT pass order_number
      // ✅ Database generates it automatically
    })
    .select()
    .single();

  if (error) {
    console.error("createOrder failed:", error);
    throw new Error("Failed to create order");
  }

  return data;
}