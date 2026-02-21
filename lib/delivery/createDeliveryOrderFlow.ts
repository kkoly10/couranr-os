import { createOrder } from "./createOrder";
import { createAddress } from "./createAddresses";
import { createDelivery } from "./createDelivery";

export type DeliveryOrderInput = {
  customerId: string;
  pickupAddress: {
    address_line: string;
    city?: string;
    state?: string;
    zip?: string;
    is_business?: boolean;
  };
  dropoffAddress: {
    address_line: string;
    city?: string;
    state?: string;
    zip?: string;
    is_business?: boolean;
  };
  estimatedMiles: number;
  weightLbs: number;
  rush: boolean;
  signatureRequired: boolean;
  stops: number;
  scheduledAt: string | null;
  totalCents: number;

  // New recipient fields added here
  recipientName: string;
  recipientPhone: string;
  deliveryNotes: string | null;
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
    // Extracting the new fields
    recipientName,
    recipientPhone,
    deliveryNotes,
  } = input;

  // 1️⃣ Create order
  const order = await createOrder({
    customerId,
    totalCents,
    serviceType: "delivery",
  });

  // 2️⃣ Create pickup & dropoff addresses (SEPARATELY)
  const pickup = await createAddress(pickupAddress);
  const dropoff = await createAddress(dropoffAddress);

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
    // Passing the new fields down to createDelivery
    recipientName,
    recipientPhone,
    deliveryNotes,
  });

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    deliveryId: delivery.id,
  };
}
