import { createOrder } from "./createOrder";
import { createDelivery } from "./createDelivery";
import { createAddresses } from "./createAddresses";
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
  totalCents: number;
};

export async function createDeliveryOrderFlow({
  customerId,
  pickupAddress,
  dropoffAddress,
  totalCents,
}: CreateDeliveryOrderFlowInput) {
  /**
   * 1. Create pickup + dropoff addresses
   */
  const { pickupAddressId, dropoffAddressId } =
    await createAddresses({
      pickup: pickupAddress,
      dropoff: dropoffAddress,
    });

  /**
   * 2. Create order
   */
  const {
    orderId,
    orderNumber,
  } = await createOrder({
    customerId,
    totalCents,
    serviceType: "delivery",
  });

  /**
   * 3. Create delivery record
   */
  const { deliveryId } = await createDelivery({
    orderId,
    pickupAddressId,
    dropoffAddressId,
  });

  /**
   * 4. Authorize payment (Stripe manual capture)
   */
  const { clientSecret } = await authorizeDeliveryPayment({
    orderId,
    amountCents: totalCents,
  });

  /**
   * ✅ FINAL RETURN (LOCKED CONTRACT)
   */
  return {
    orderId,
    deliveryId,
    orderNumber,
    totalCents,
    clientSecret,
  };
}