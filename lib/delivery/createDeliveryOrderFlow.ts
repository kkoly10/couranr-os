import { supabaseAdmin } from "../supabaseAdmin";
import { createOrder } from "./createOrder";
import { createAddresses } from "./createAddresses";
import { createDelivery } from "./createDelivery";

export type DeliveryOrderInput = {
  customerId: string;
  pickupAddress: {
    address_line: string;
  };
  dropoffAddress: {
    address_line: string;
  };
  estimatedMiles: number;
  weightLbs: number;
  rush: boolean;
  signatureRequired: boolean;
  stops: number;
  scheduledAt: string | null;
  totalCents: number;
};

export type DeliveryOrderResult = {
  orderId: string;
  orderNumber: string;
  deliveryId: string;
};

export async function createDeliveryOrderFlow(
  input: DeliveryOrderInput
): Promise<DeliveryOrderResult> {
  const {
    customerId,
    pickupAddress,
    dropoffAddress,
    estimatedMiles,
    weightLbs,
    rush,
    signatureRequired,
    stops,
    scheduledAt,
    totalCents,
  } = input;

  // 1️⃣ Create order
  const order = await createOrder({
    customerId,
    totalCents,
  });

  // 2️⃣ Create addresses
  const pickup = await createAddresses({
    ...pickupAddress,
    type: "pickup",
  });

  const dropoff = await createAddresses({
    ...dropoffAddress,
    type: "dropoff",
  });

  // 3️⃣ Create delivery
  const delivery = await createDelivery({
    orderId: order.id,
    pickupAddressId: pickup.id,
    dropoffAddressId: dropoff.id,
    estimatedMiles,
    weightLbs,
    rush,
    signatureRequired,
    stops,
    scheduledAt,
  });

  // ✅ THIS IS WHAT WAS MISSING
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    deliveryId: delivery.id,
  };
}
