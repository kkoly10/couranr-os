import { supabaseAdmin } from "../supabaseAdmin";

export type CreateDeliveryInput = {
  orderId: string;
  pickupAddressId: string;
  dropoffAddressId: string;
  estimatedMiles: number;
  weightLbs: number;
  rush: boolean;
  signatureRequired: boolean;
  stops: number;
  scheduledAt: string | null;
};

export type CreateDeliveryResult = {
  id: string;
};

export async function createDelivery(
  input: CreateDeliveryInput
): Promise<CreateDeliveryResult> {
  const {
    orderId,
    pickupAddressId,
    dropoffAddressId,
    estimatedMiles,
    weightLbs,
    rush,
    signatureRequired,
    stops,
    scheduledAt,
  } = input;

  const { data, error } = await supabaseAdmin
    .from("deliveries")
    .insert({
      order_id: orderId,
      pickup_address_id: pickupAddressId,
      dropoff_address_id: dropoffAddressId,
      estimated_miles: estimatedMiles,
      weight_lbs: weightLbs,
      rush,
      signature_required: signatureRequired,
      stops,
      scheduled_at: scheduledAt,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      error?.message || "Failed to create delivery"
    );
  }

  return { id: data.id };
}
