export async function createDelivery({
  orderId,
  pickupAddressId,
  dropoffAddressId,
  recipient,
  pricing,
}: {
  orderId: string;
  pickupAddressId: string;
  dropoffAddressId: string;
  recipient: {
    name: string;
    phone: string;
    email?: string;
  };
  pricing: {
    miles: number;
    weight: number;
    baseFee: number;
    mileageFee: number;
    weightFee: number;
    rushFee: number;
    signatureFee: number;
  };
}) {
  const { error } = await supabase.from("deliveries").insert({
    order_id: orderId,
    pickup_address_id: pickupAddressId,
    dropoff_address_id: dropoffAddressId,
    recipient_name: recipient.name,
    recipient_phone: recipient.phone,
    recipient_email: recipient.email,
    estimated_miles: pricing.miles,
    weight_lbs: pricing.weight,
    base_fee_cents: pricing.baseFee,
    mileage_fee_cents: pricing.mileageFee,
    weight_fee_cents: pricing.weightFee,
    rush_fee_cents: pricing.rushFee,
    signature_fee_cents: pricing.signatureFee,
  });

  if (error) throw error;
}
