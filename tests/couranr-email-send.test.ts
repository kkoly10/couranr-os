import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  htmlToPlainText,
  looksLikeAnAddress,
  sendRenderedEmail,
} from "@/lib/couranr/email/send";
import { defaultEmailConfig } from "@/lib/couranr/email/theme";
import { bizQuoteReady } from "@/lib/couranr/email/templates/business";
import { buildSamples } from "@/lib/couranr/email/sampleData";
import type { RenderedEmail } from "@/lib/couranr/email/types";

/**
 * These tests drive the REAL `sendRenderedEmail` against an injected fetch.
 *
 * That distinction is the point. The email subsystem already had 11 green tests
 * while being completely unsendable, because every one of them asserted on
 * rendered HTML and nothing asserted that a send could happen. A test that
 * mocks the sender away would reproduce exactly that failure. Every case here
 * runs the actual function and asserts on the request that would have left the
 * process, or on the result it returns when it refuses.
 */

const ENV_KEYS = [
  "RESEND_API_KEY",
  "VERCEL_ENV",
  "COURANR_EMAIL_SEND",
  "COURANR_EMAIL_REDIRECT_TO",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  // A deterministic baseline: keyed, in production, no redirect.
  process.env.RESEND_API_KEY = "re_test_key_not_a_real_credential";
  process.env.VERCEL_ENV = "production";
  delete process.env.COURANR_EMAIL_SEND;
  delete process.env.COURANR_EMAIL_REDIRECT_TO;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

/** A real rendered email, not a hand-built stub. */
function rendered(): RenderedEmail {
  const samples = buildSamples(defaultEmailConfig);
  return bizQuoteReady(defaultEmailConfig, samples.business.quoteReady);
}

function okFetch(captured: any[]): typeof fetch {
  return (async (url: any, init: any) => {
    captured.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "resend-message-id-1" }),
    } as any;
  }) as any;
}

describe("sendRenderedEmail — the request it actually builds", () => {
  it("POSTs to the Resend endpoint with bearer auth and JSON", async () => {
    const calls: any[] = [];
    const result = await sendRenderedEmail(rendered(), {
      to: "merchant@example.com",
      fetchImpl: okFetch(calls),
    });

    expect(result.sent).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Authorization).toBe(
      "Bearer re_test_key_not_a_real_credential"
    );
    expect(calls[0].init.headers["Content-Type"]).toBe("application/json");
  });

  it("uses snake_case reply_to — the REST field name, not the SDK's camelCase", () => {
    // Guarding the exact bug class that makes a send silently lose its reply
    // address: the SDK accepts `replyTo`, the REST endpoint ignores it.
    const calls: any[] = [];
    return sendRenderedEmail(rendered(), {
      to: "merchant@example.com",
      fetchImpl: okFetch(calls),
    }).then(() => {
      const body = JSON.parse(calls[0].init.body);
      expect(body.reply_to).toBe(defaultEmailConfig.replyToEmail);
      expect(body).not.toHaveProperty("replyTo");
    });
  });

  it("sends a plain-text alternative alongside the HTML", async () => {
    const calls: any[] = [];
    await sendRenderedEmail(rendered(), {
      to: "merchant@example.com",
      fetchImpl: okFetch(calls),
    });
    const body = JSON.parse(calls[0].init.body);
    expect(body.html.length).toBeGreaterThan(0);
    expect(body.text.length).toBeGreaterThan(0);
    expect(body.text).not.toContain("<table");
  });

  it("passes the idempotency key through, truncated to the provider limit", async () => {
    const calls: any[] = [];
    await sendRenderedEmail(rendered(), {
      to: "merchant@example.com",
      idempotencyKey: "x".repeat(400),
      fetchImpl: okFetch(calls),
    });
    expect(calls[0].init.headers["Idempotency-Key"]).toHaveLength(256);
  });

  it("omits the idempotency header entirely when none is given", async () => {
    const calls: any[] = [];
    await sendRenderedEmail(rendered(), {
      to: "merchant@example.com",
      fetchImpl: okFetch(calls),
    });
    expect(calls[0].init.headers).not.toHaveProperty("Idempotency-Key");
  });
});

describe("sendRenderedEmail — it refuses loudly instead of pretending", () => {
  it("returns no_api_key rather than silently doing nothing", async () => {
    delete process.env.RESEND_API_KEY;
    const calls: any[] = [];
    const result = await sendRenderedEmail(rendered(), {
      to: "merchant@example.com",
      fetchImpl: okFetch(calls),
    });
    expect(result).toMatchObject({ sent: false, reason: "no_api_key" });
    expect(calls).toHaveLength(0);
  });

  it("rejects a malformed recipient before touching the network", async () => {
    const calls: any[] = [];
    for (const bad of ["", "   ", "not-an-address", "a@b", "two @spaces.com"]) {
      const result = await sendRenderedEmail(rendered(), {
        to: bad,
        fetchImpl: okFetch(calls),
      });
      expect(result, `should reject ${JSON.stringify(bad)}`).toMatchObject({
        sent: false,
        reason: "invalid_recipient",
      });
    }
    expect(calls).toHaveLength(0);
  });

  it("surfaces a provider rejection WITH the provider's message", async () => {
    // This is the notify.ts bug: Resend answers 403 "domain is not verified"
    // and the legacy mailer swallows it. The message must reach the caller.
    const fetchImpl = (async () => ({
      ok: false,
      status: 403,
      json: async () => ({ message: "The mail.couranr.com domain is not verified." }),
    })) as any;

    const result = await sendRenderedEmail(rendered(), {
      to: "merchant@example.com",
      fetchImpl,
    });

    expect(result.sent).toBe(false);
    if (result.sent === false) {
      expect(result.reason).toBe("provider_rejected");
      expect(result.detail).toContain("not verified");
      expect(result.correlationId).toBeTruthy();
    }
  });

  it("treats a 200 with no id as a failure, not a success", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    })) as any;
    const result = await sendRenderedEmail(rendered(), {
      to: "merchant@example.com",
      fetchImpl,
    });
    expect(result).toMatchObject({ sent: false, reason: "provider_rejected" });
  });

  it("does not throw when the network throws", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNRESET");
    }) as any;
    const result = await sendRenderedEmail(rendered(), {
      to: "merchant@example.com",
      fetchImpl,
    });
    expect(result).toMatchObject({ sent: false, reason: "provider_unreachable" });
  });
});

describe("sendRenderedEmail — environment posture", () => {
  it("will not mail a real address from outside production unless armed", async () => {
    process.env.VERCEL_ENV = "preview";
    const calls: any[] = [];
    const result = await sendRenderedEmail(rendered(), {
      to: "a-real-customer@example.com",
      fetchImpl: okFetch(calls),
    });
    expect(result).toMatchObject({
      sent: false,
      reason: "disabled_outside_production",
    });
    expect(calls).toHaveLength(0);
  });

  it("redirects every message to the test inbox when armed with a redirect", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.COURANR_EMAIL_SEND = "live";
    process.env.COURANR_EMAIL_REDIRECT_TO = "founder@example.com";

    const calls: any[] = [];
    const result = await sendRenderedEmail(rendered(), {
      to: "a-real-customer@example.com",
      fetchImpl: okFetch(calls),
    });

    const body = JSON.parse(calls[0].init.body);
    expect(body.to).toBe("founder@example.com");
    // The real recipient has to stay visible or a redirected test is unreadable.
    expect(body.subject).toContain("a-real-customer@example.com");
    expect(result).toMatchObject({ sent: true, redirected: true });
  });

  it("arming requires the exact string 'live', not a truthy value", async () => {
    process.env.VERCEL_ENV = "preview";
    const calls: any[] = [];
    for (const value of ["1", "true", "yes", "LIVE", "live "]) {
      process.env.COURANR_EMAIL_SEND = value;
      const result = await sendRenderedEmail(rendered(), {
        to: "customer@example.com",
        fetchImpl: okFetch(calls),
      });
      expect(result, `"${value}" must not arm sending`).toMatchObject({
        sent: false,
        reason: "disabled_outside_production",
      });
    }
    expect(calls).toHaveLength(0);
  });

  it("production sends to the real recipient with no redirect", async () => {
    const calls: any[] = [];
    const result = await sendRenderedEmail(rendered(), {
      to: "merchant@example.com",
      fetchImpl: okFetch(calls),
    });
    expect(JSON.parse(calls[0].init.body).to).toBe("merchant@example.com");
    expect(result).toMatchObject({ sent: true, redirected: false });
  });
});

describe("the from address must stay on the verified domain", () => {
  /**
   * lib/notify.ts sends from `no-reply@couranr.com`. The apex domain is NOT
   * verified in the Resend account — only the `mail.couranr.com` subdomain is —
   * so every one of those sends is rejected and swallowed. This fails if anyone
   * moves the canonical sender back to the apex.
   */
  it("defaultEmailConfig sends from mail.couranr.com, never the apex", () => {
    expect(defaultEmailConfig.fromEmail).toBe("no-reply@mail.couranr.com");
    expect(defaultEmailConfig.fromEmail).not.toMatch(/@couranr\.com$/);
  });

  it("every rendered template inherits that sender", () => {
    const email = rendered();
    expect(email.from).toContain("@mail.couranr.com");
  });
});

describe("htmlToPlainText", () => {
  it("drops the hidden preheader so the text part does not open with padding", () => {
    const email = rendered();
    const text = htmlToPlainText(email.html);
    // The preheader is padded with dozens of zero-width non-joiners.
    expect(text).not.toContain("‌");
    expect(text).not.toContain("&zwnj;");
    expect(text.slice(0, 40).trim().length).toBeGreaterThan(0);
  });

  it("keeps the human sentences and drops the markup", () => {
    const text = htmlToPlainText(
      "<table><tr><td><h1>Your quote is ready</h1><p>Review it &amp; approve.</p></td></tr></table>"
    );
    expect(text).toContain("Your quote is ready");
    expect(text).toContain("Review it & approve.");
    expect(text).not.toContain("<");
  });
});

describe("the never-throws contract holds for inputs the types do not stop", () => {
  /**
   * `"strict": false` plus row types of Record<string, any> means the `to`
   * annotation stops nothing. The original looksLikeAnAddress called .trim()
   * with no typeof guard, OUTSIDE any try/catch, so `{ to: row.recipient_email }`
   * on a NULL column threw a TypeError — breaking send.ts's own headline. These
   * assert a RESULT, never a throw.
   */
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["an object", { audience: "merchant", address: "a@b.com" }],
    ["an array", ["a@b.com"]],
  ])("refuses %s instead of throwing", async (_label, bad) => {
    const calls: any[] = [];
    const result = await sendRenderedEmail(rendered(), {
      to: bad as any,
      fetchImpl: okFetch(calls),
    });
    expect(result).toMatchObject({ sent: false, reason: "invalid_recipient" });
    expect(calls).toHaveLength(0);
  });

  it("the shape check itself is total", () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(() => looksLikeAnAddress(bad as any)).not.toThrow();
      expect(looksLikeAnAddress(bad as any)).toBe(false);
    }
  });

  it("time-boxes the request — the signal is actually passed", async () => {
    // Nothing asserted the timeout existed; a grep for signal/Abort across all
    // three email test files returned nothing before this.
    const calls: any[] = [];
    await sendRenderedEmail(rendered(), { to: "m@example.com", fetchImpl: okFetch(calls) });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("an aborted request is provider_unreachable, not a throw", async () => {
    const fetchImpl = (async () => {
      const err: any = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    }) as any;
    const result = await sendRenderedEmail(rendered(), { to: "m@example.com", fetchImpl });
    expect(result).toMatchObject({ sent: false, reason: "provider_unreachable" });
  });
});
