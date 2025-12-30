import { createAddresses } from "./createAddresses";
import { createOrder } from "./createOrder";
import { createDelivery } from "./createDelivery";
import { authorizeDeliveryPayment } from "./authorizeDeliveryPayment";

export type CreateDeliveryOrderFlowInput = {
  customerId: string;

  pickupAddress: {
    address_line: string;
    city: string;
    state: string;
    zip: string;
    is_business: boolean;
    business_hours?: string;
  };

  dropoffAddress: {
    address_line: string;
    city: string;
    state: string;
    zip: string;
    is_business: boolean;
    business_hours?: string;
  };

  estimatedMiles: number;
  weightLbs: number;
  stops: number;
  rush: boolean;
  signatureRequired: boolean;

  totalCents: number;
};

export async function createDeliveryOrderFlow(
  input: CreateDeliveryOrderFlowInput
) {
  const {
    customerId,
    pickupAddress,
    dropoffAddress,
    estimatedMiles,
    weightLbs,
    stops,
    rush,
    signatureRequired,
    totalCents,
  } = input;

  /**
   * 1. Create addresses
   */
  const { pickupAddressId, dropoffAddressId } =
    await createAddresses({
      pickup: pickupAddress,
      dropoff: dropoffAddress,
    });

  /**
   * 2. Create order
   */
  const { orderId, orderNumber } = await createOrder({
    customerId,
    totalCents,
    serviceType: "delivery",
  });

  /**
   * 3. Create delivery
   */
  const { deliveryId } = await createDelivery({
    orderId,
    pickupAddressId,
    dropoffAddressId,
    estimatedMiles,
    weightLbs,
    stops,
    rush,
    signatureRequired,
  });

  /**
   * 4. Authorize payment (Stripe manual capture)
   */
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
