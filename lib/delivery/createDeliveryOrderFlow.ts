import { createDeliveryOrder } from "./createOrder";
import { createAddress } from "./createAddresses";
import { createDelivery } from "./createDelivery";

/**
 * Orchestrates the full delivery order creation flow.
 * This is the ONLY place where a delivery order is created.
 *
 * Flow:
 * 1. Create order
 * 2. Create pickup address
 * 3. Create dropoff address
 * 4. Create delivery record
 * 5. Authorize payment with Stripe (manual capture)
 * 6. Return clientSecret for Stripe Elements
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
  // =========================
  // 1️⃣ CREATE ORDER
  // =========================
  const order = await createDeliveryOrder({
    customerId,
    subtotalCents: pricing.subtotalCents,
    feesCents: pricing.feesCents,
    totalCents: pricing.totalCents,
  });

  // =========================
  // 2️⃣ CREATE PICKUP ADDRESS
  // =========================
  const pickup = await createAddress({
    ...pickupAddress,
    label: pickupAddress.label ?? "Pickup",
  });

  // =========================
  // 3️⃣ CREATE DROPOFF ADDRESS
  // =========================
  const dropoff = await createAddress({
    ...dropoffAddress,
    label: dropoffAddress.label ?? "Dropoff",
  });

  // =========================
  // 4️⃣ CREATE DELIVERY RECORD
  // =========================
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

  // =========================
  // 5️⃣ AUTHORIZE PAYMENT (STRIPE – MANUAL CAPTURE)
  // =========================
  const paymentRes = await fetch("/api/delivery/authorize-payment", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      orderId: order.id,
      amountCents: pricing.totalCents,
      currency: "usd",
    }),
  });

  if (!paymentRes.ok) {
    throw new Error("Failed to authorize payment");
  }

  const paymentData = await paymentRes.json();

  if (!paymentData.clientSecret) {
    throw new Error("Missing Stripe client secret");
  }

  // =========================
  // 6️⃣ RETURN CHECKOUT DATA
  // =========================
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    totalCents: pricing.totalCents,
    clientSecret: paymentData.clientSecret,
  };
}