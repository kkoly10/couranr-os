import { createOrder } from "./createOrder";
import { createAddresses } from "./createAddresses";
import { createDelivery } from "./createDelivery";

export type AddressInput = {
  address_line: string;
  city: string;
  state: string;
  zip: string;
  is_business: boolean;
};

export type DeliveryOrderInput = {
  customerId: string;
  pickupAddress: AddressInput;
  dropoffAddress: AddressInput;
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

  // 2️⃣ Create pickup + dropoff addresses (FULL objects)
  const addresses = await createAddresses({
    pickup: pickupAddress,
    dropoff: dropoffAddress,
  });

  // 3️⃣ Create delivery record
  const delivery = await createDelivery({
    orderId: order.id,
    pickupAddressId: addresses.pickup.id,
    dropoffAddressId: addresses.dropoff.id,
    estimatedMiles,
    weightLbs,
    rush,
    signatureRequired,
    stops,
    scheduledAt,
  });

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    deliveryId: delivery.id,
  };
}