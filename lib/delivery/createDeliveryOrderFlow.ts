import { createDeliveryOrder } from "./createOrder";
import { createAddress } from "./createAddresses";
import { createDelivery } from "./createDelivery";

/**
 * Orchestrates the full delivery order creation flow.
 * This is the single source of truth for creating delivery orders.
 */
export async function createDeliveryOrderFlow({
  customerId,
  pickupAddress,
  dropoffAddress,
  recipient,
  pricing,
}: {
  customerId: string;

  pickupAddress: {
    label?: string;
    address_line: string;
    city?: string;
    state?: string;
    zip?: string;
    lat?: number;
    lng?: number;
    is_business?: boolean;
    business_hours?: string;
  };

  dropoffAddress: {
    label?: string;
    address_line: string;
    city?: string;
    state?: string;
    zip?: string;
    lat?: number;
    lng?: number;
    is_business?: boolean;
    business_hours?: string;
  };

  recipient: {
    name: string;
    phone: string;
    email?: string;
  };

  pricing: {
    subtotalCents: number;
    feesCents: number;
    totalCents: number;

    miles: number;
    weight: number;

    baseFee: number;
    mileageFee: number;
    weightFee: number;
    rushFee: number;
    signatureFee: number;
  };
}) {
  // 1️⃣ Create order
  const order = await createDeliveryOrder({
    customerId,
    subtotalCents: pricing.subtotalCents,
    feesCents: pricing.feesCents,
    totalCents: pricing.totalCents,
  });

  // 2️⃣ Create pickup address
  const pickup = await createAddress({
    ...pickupAddress,
    label: pickupAddress.label ?? "Pickup",
  });

  // 3️⃣ Create dropoff address
  const dropoff = await createAddress({
    ...dropoffAddress,
    label: dropoffAddress.label ?? "Dropoff",
  });

  // 4️⃣ Create delivery record
  await createDelivery({
    orderId: order.id,
    pickupAddressId: pickup.id,
    dropoffAddressId: dropoff.id,
    recipient,
    pricing: {
      miles: pricing.miles,
      weight: pricing.weight,
      baseFee: pricing.baseFee,
      mileageFee: pricing.mileageFee,
      weightFee: pricing.weightFee,
      rushFee: pricing.rushFee,
      signatureFee: pricing.signatureFee,
    },
  });

  // 5️⃣ Return essential info
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    totalCents: pricing.totalCents,
  };
}