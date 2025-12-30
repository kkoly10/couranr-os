import { createAddresses, AddressInput } from "./createAddresses";
import { createOrder } from "./createOrder";
import { createDelivery } from "./createDelivery";
import { authorizeDeliveryPayment } from "./authorizeDeliveryPayment";

/**
 * ✅ CANONICAL MVP CONTRACT (FROZEN)
 */
export type DeliveryOrderInput = {
  customerId: string;

  pickupAddress: AddressInput;
  dropoffAddress: AddressInput;

  estimatedMiles: number;
  weightLbs: number;
  stops: number;

  rush: boolean;
  signatureRequired: boolean;
  scheduledAt: string | null;

  totalCents: number;
};

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

  // 1) addresses
  const { pickupAddressId, dropoffAddressId } = await createAddresses({
    pickup: pickupAddress,
    dropoff: dropoffAddress,
  });

  // 2) order
  const { orderId, orderNumber } = await createOrder({
    customerId,
    totalCents,
    serviceType: "delivery",
  });

  // 3) delivery
  const { deliveryId } = await createDelivery({
    orderId,
    pickupAddressId,
    dropoffAddressId,
    estimatedMiles,
    weightLbs,
    stops,
    rush,
    signatureRequired,
    scheduledAt,
  });

  // 4) authorize payment (manual capture)
  const { clientSecret } = await authorizeDeliveryPayment({
    orderId,
    amountCents: totalCents,
  });

  return {
    orderId,
    deliveryId,
    orderNumber,
    totalCents,
    clientSecret,
  };
}