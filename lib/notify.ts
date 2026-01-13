import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

type NotifyEmailParams = {
  to: string;
  subject: string;
  html: string;
};

export async function sendEmail({
  to,
  subject,
  html,
}: NotifyEmailParams) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set — email skipped");
    return;
  }

  try {
    await resend.emails.send({
      from: "Couranr <no-reply@couranr.com>",
      to,
      subject,
      html,
    });
  } catch (err) {
    console.error("Failed to send email via Resend:", err);
  }
}

/**
 * Placeholder for future SMS support.
 * Intentionally disabled to avoid build/runtime errors.
 */
export async function sendSMS() {
  console.warn("SMS disabled — email-only mode");
}