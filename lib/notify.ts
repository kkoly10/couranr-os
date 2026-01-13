import { Resend } from "resend";
import twilio from "twilio";

function env(name: string) {
  return process.env[name] || "";
}

const resendKey = env("RESEND_API_KEY");
const resend = resendKey ? new Resend(resendKey) : null;

const twilioSid = env("TWILIO_ACCOUNT_SID");
const twilioToken = env("TWILIO_AUTH_TOKEN");
const twilioFrom = env("TWILIO_FROM");
const twilioClient =
  twilioSid && twilioToken ? twilio(twilioSid, twilioToken) : null;

export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}) {
  if (!resend) return { ok: false, skipped: true, reason: "No RESEND_API_KEY" };

  const from =
    args.from || "Couranr Auto <no-reply@couranr.com>"; // you can update domain later

  const res = await resend.emails.send({
    from,
    to: args.to,
    subject: args.subject,
    html: args.html,
  });

  return { ok: true, res };
}

export async function sendSMS(args: { to: string; body: string }) {
  if (!twilioClient || !twilioFrom) {
    return { ok: false, skipped: true, reason: "Twilio not configured" };
  }

  const msg = await twilioClient.messages.create({
    from: twilioFrom,
    to: args.to,
    body: args.body,
  });

  return { ok: true, msgSid: msg.sid };
}