import { createAddresses } from "./createAddresses";
import { createOrder } from "./createOrder";
import { createDelivery } from "./createDelivery";
import { authorizeDeliveryPayment } from "./authorizeDeliveryPayment";

type CreateDeliveryOrderFlowInput = {
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
  rush: boolean;
  signatureRequired: boolean;

  totalCents: number;
};

export async function createDeliveryOrderFlow({
  customerId,
  pickupAddress,
  dropoffAddress,
  estimatedMiles,
  weightLbs,
  rush,
  signatureRequired,
  totalCents,
}: CreateDeliveryOrderFlowInput) {
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
    rush,
    signatureRequired,
  });

  /**
   * 4. Authorize payment (manual capture)
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