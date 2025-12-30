export default function PaymentSuccessPage() {
  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: 32 }}>
      <h1>Payment Authorized ✅</h1>
      <p>
        Your payment method has been successfully authorized.
        A driver will be assigned shortly.
      </p>
      <p>
        You will only be charged after delivery is completed and verified.
      </p>
    </div>
  );
}