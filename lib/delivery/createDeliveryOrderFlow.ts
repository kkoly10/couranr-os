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

  // 1️⃣ Create order (explicit service type)
  const order = await createOrder({
    customerId,
    totalCents,
    serviceType: "delivery",
  });

  // 2️⃣ Create pickup + dropoff addresses
  const pickup = await createAddresses({
    pickup: pickupAddress,
    dropoff: dropoffAddress,
  });

  // 3️⃣ Create delivery record
  const delivery = await createDelivery({
    orderId: order.id,
    pickupAddressId: pickup.pickup.id,
    dropoffAddressId: pickup.dropoff.id,
    estimatedMiles,
    weightLbs,
    rush,
    signatureRequired,
    stops,
    scheduledAt,
  });

  // ✅ Explicit return (NO Stripe here)
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    deliveryId: delivery.id,
  };
}
