import { createOrder } from "./createOrder";
import { createAddresses } from "./createAddresses";
import { createDelivery } from "./createDelivery";

/**
 * Input required to create a delivery order
 */
export type DeliveryOrderInput = {
  customerId: string;

  pickupAddress: {
    address_line: string;
    city?: string;
    state?: string;
    zip?: string;
    notes?: string;
  };

  dropoffAddress: {
    address_line: string;
    city?: string;
    state?: string;
    zip?: string;
    notes?: string;
  };

  estimatedMiles: number;
  weightLbs: number;
  stops: number;
  rush: boolean;
  signatureRequired: boolean;

  scheduledAt: string | null; // ISO string or null
  totalCents: number;
};

/**
 * Orchestrates the full delivery order creation:
 * 1. Create order
 * 2. Create addresses
 * 3. Create delivery record
 */
export async function createDeliveryOrderFlow(input: DeliveryOrderInput) {
  const {
    customerId,
    pickupAddress,
    dropoffAddress,
    estimatedMiles,
    weightLbs,
    stops,
    rush,
    signatureRequired,
    scheduledAt,
    totalCents,
  } = input;

  // 1️⃣ Create order
  const order = await createOrder({
    customerId,
    totalCents,
    serviceType: "delivery",
  });

  // 2️⃣ Create addresses
  const pickup = await createAddresses({
    ...pickupAddress,
    type: "pickup",
    orderId: order.id,
  });

  const dropoff = await createAddresses({
    ...dropoffAddress,
    type: "dropoff",
    orderId: order.id,
  });

  // 3️⃣ Create delivery
  const delivery = await createDelivery({
    orderId: order.id,
    customerId,
    pickupAddressId: pickup.id,
    dropoffAddressId: dropoff.id,
    estimatedMiles,
    weightLbs,
    stops,
    rush,
    signatureRequired,
    scheduledAt,
  });

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    deliveryId: delivery.id,
    totalCents: order.total_cents,
  };
}