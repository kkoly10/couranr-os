import { supabase } from "../supabaseClient";

export type CreateDeliveryInput = {
  orderId: string;
  pickupAddressId: string;
  dropoffAddressId: string;

  estimatedMiles: number;
  weightLbs: number;
  stops: number;

  rush: boolean;
  signatureRequired: boolean;
  scheduledAt: string | null; // ISO string or null
};

export async function createDelivery(input: CreateDeliveryInput) {
  const {
    orderId,
    pickupAddressId,
    dropoffAddressId,
    estimatedMiles,
    weightLbs,
    stops,
    rush,
    signatureRequired,
    scheduledAt,
  } = input;

  if (!orderId) throw new Error("createDelivery: orderId is required");

  const { data, error } = await supabase
    .from("deliveries")
    .insert({
      order_id: orderId,
      pickup_address_id: pickupAddressId,
      dropoff_address_id: dropoffAddressId,

      estimated_miles: estimatedMiles,
      weight_lbs: weightLbs,
      stops,

      rush,
      signature_required: signatureRequired,
      scheduled_at: scheduledAt,

      status: "created", // adjust if your enum differs
    })
    .select("id")
    .single();

  if (error) throw new Error(`createDelivery failed: ${error.message}`);
  if (!data?.id) throw new Error("createDelivery failed: missing delivery id");

  return { deliveryId: data.id as string };
}