export type RentalPostPaymentStatusInput = {
  verification_status?: string | null;
  agreement_signed?: boolean | null;
  docs_complete?: boolean | null;
  lockbox_code_released_at?: string | null;
};

export function resolveRentalStatusAfterPayment(
  input: RentalPostPaymentStatusInput
) {
  const verificationApproved =
    String(input.verification_status || "").toLowerCase() === "approved";
  const agreementSigned = !!input.agreement_signed;
  const docsComplete = !!input.docs_complete;
  const lockboxReleased = !!input.lockbox_code_released_at;

  if (verificationApproved && agreementSigned && docsComplete && lockboxReleased) {
    return "pickup_ready";
  }

  return "paid_pending_review";
}