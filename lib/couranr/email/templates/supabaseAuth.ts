/**
 * Supabase Auth email templates, on the Couranr brand.
 *
 * These are the emails Supabase Auth sends (signup confirmation / welcome,
 * magic link, password reset, email change, invite, reauthentication). They are
 * NOT sent from repo code — they're pasted into the Supabase dashboard
 * (Authentication → Emails), so the body is HTML containing Supabase's Go
 * template variables verbatim: {{ .ConfirmationURL }}, {{ .Token }},
 * {{ .Email }}, {{ .NewEmail }}, {{ .SiteURL }}.
 *
 * The variables contain no HTML-special characters, so passing them through the
 * normal primitives (which HTML-escape) leaves them intact. To make these come
 * from the Couranr domain too, set Resend as the project's custom SMTP in the
 * Supabase Auth settings.
 */

import { EmailConfig } from "../theme";
import {
  layout,
  eyebrow,
  h1,
  paragraph,
  small,
  button,
  fallbackLink,
  panel,
  codeChip,
} from "../primitives";

export interface AuthEmail {
  key: string;
  /** Set this as the template's "Subject heading" in the Supabase dashboard. */
  subject: string;
  /** Paste as the template "Message body" (source/HTML) in the dashboard. */
  html: string;
}

function render(
  config: EmailConfig,
  key: string,
  subject: string,
  preheader: string,
  contentHtml: string,
): AuthEmail {
  return { key, subject, html: layout({ config, previewText: preheader, contentHtml }) };
}

const TOKEN = "{{ .Token }}";
const NEW_EMAIL = "{{ .NewEmail }}";
const DASHBOARD = "/app/business";

/**
 * Build a CROSS-BROWSER confirmation link.
 *
 * Points at our /auth/confirm route (which calls `verifyOtp` on the emailed
 * `token_hash`), NOT `{{ .ConfirmationURL }}`. `{{ .ConfirmationURL }}` uses the
 * PKCE `code` flow, whose exchange needs the `code_verifier` from the browser
 * that started signup — so it silently fails when the link is opened in another
 * browser or on a phone. `token_hash` + verifyOtp validates server-side and
 * signs the user in wherever they click. `{{ .SiteURL }}` and `{{ .TokenHash }}`
 * are Supabase variables, substituted at send time.
 */
function confirmUrl(type: string, next: string): string {
  return `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=${type}&next=${next}`;
}

/** Confirm signup — the welcome email. */
export function authConfirmSignup(config: EmailConfig): AuthEmail {
  const content = [
    eyebrow(`Welcome to ${config.brandName}`),
    h1("Confirm your email to get started"),
    paragraph(
      "You're one step from your Couranr account. Confirm your email and you can set up your business and start booking local deliveries.",
    ),
    button({ label: "Confirm email", href: confirmUrl("email", DASHBOARD) }),
    fallbackLink(confirmUrl("email", DASHBOARD)),
    panel({
      tone: "neutral",
      html: "Couranr is local delivery for local businesses — keep taking orders your way, and Couranr handles the delivery, from quote and payment to tracking and proof.",
    }),
    small("If you didn't create a Couranr account, you can safely ignore this email."),
  ].join("\n");
  return render(config, "confirm_signup", "Confirm your email · Couranr", "Confirm your email to activate your Couranr account.", content);
}

/** Magic link sign-in. */
export function authMagicLink(config: EmailConfig): AuthEmail {
  const content = [
    eyebrow(config.brandName),
    h1("Your sign-in link"),
    paragraph("Use the button below to sign in to Couranr. For your security, it can be used once and expires shortly."),
    button({ label: "Sign in to Couranr", href: confirmUrl("email", DASHBOARD) }),
    fallbackLink(confirmUrl("email", DASHBOARD)),
    small("If you didn't request this link, you can safely ignore this email."),
  ].join("\n");
  return render(config, "magic_link", "Sign in to Couranr", "Your one-time sign-in link for Couranr.", content);
}

/** Password reset. */
export function authResetPassword(config: EmailConfig): AuthEmail {
  const content = [
    eyebrow(config.brandName),
    h1("Reset your password"),
    paragraph("We received a request to reset your Couranr password. Choose a new one with the button below."),
    button({ label: "Choose a new password", href: confirmUrl("recovery", "/auth/update-password") }),
    fallbackLink(confirmUrl("recovery", "/auth/update-password")),
    small("If you didn't request this, you can safely ignore it — your password won't change."),
  ].join("\n");
  return render(config, "reset_password", "Reset your Couranr password", "Choose a new password for your Couranr account.", content);
}

/** Change email address. */
export function authChangeEmail(config: EmailConfig): AuthEmail {
  const content = [
    eyebrow(config.brandName),
    h1("Confirm your new email"),
    paragraph(`You asked to change the email on your Couranr account to <strong style="color:#0D1525;">${NEW_EMAIL}</strong>. Confirm to finish the change.`),
    button({ label: "Confirm new email", href: confirmUrl("email_change", DASHBOARD) }),
    fallbackLink(confirmUrl("email_change", DASHBOARD)),
    small("If you didn't request this change, please contact Couranr Support right away."),
  ].join("\n");
  return render(config, "change_email", "Confirm your new email · Couranr", "Confirm the new email for your Couranr account.", content);
}

/** Invite a user. */
export function authInvite(config: EmailConfig): AuthEmail {
  const content = [
    eyebrow(config.brandName),
    h1("You're invited to Couranr"),
    paragraph("You've been invited to join a business on Couranr. Accept the invitation to set up your account."),
    button({ label: "Accept invitation", href: confirmUrl("invite", "/app/business/onboarding") }),
    fallbackLink(confirmUrl("invite", "/app/business/onboarding")),
    small("If you weren't expecting this invitation, you can ignore this email."),
  ].join("\n");
  return render(config, "invite", "You're invited to Couranr", "Accept your invitation to join Couranr.", content);
}

/** Reauthentication code. */
export function authReauthentication(config: EmailConfig): AuthEmail {
  const content = [
    eyebrow(config.brandName),
    h1("Your verification code"),
    paragraph("Enter this code to confirm it's you:"),
    `<p style="margin:2px 0 18px 0;">${codeChip(TOKEN)}</p>`,
    small("This code expires shortly. If you didn't request it, you can ignore this email."),
  ].join("\n");
  return render(config, "reauthentication", "Your Couranr verification code", "Your one-time Couranr verification code.", content);
}

export function allAuthEmails(config: EmailConfig): AuthEmail[] {
  return [
    authConfirmSignup(config),
    authMagicLink(config),
    authResetPassword(config),
    authChangeEmail(config),
    authInvite(config),
    authReauthentication(config),
  ];
}
