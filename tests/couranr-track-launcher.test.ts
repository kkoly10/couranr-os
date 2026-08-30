/**
 * The consumer header's tracking-link launcher.
 *
 * It exists because there is NO canonical generic `/track` route — PUB-006 is
 * `/track/[token]` and the header has no token — so "Track a delivery" cannot
 * be a link without being a 404 with a friendly label. What it does instead is
 * parse a link the visitor already holds and navigate locally.
 *
 * That makes `parseTrackingPath` a security boundary, not a convenience: it
 * takes hostile text from a paste and turns it into a router destination. An
 * `href` it got wrong is an open redirect. It shipped with no test at all,
 * which is what this file fixes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseTrackingPath } from "@/components/couranr/shell/TrackDeliveryLauncher";

const ROOT = path.join(__dirname, "..");

/* The host the page is being served from, in these tests. An absolute URL is
   accepted only when it matches this; every case below passes it explicitly,
   because in node there is no `window` for the default to read. */
const SELF = "couranr.com";

describe("a real Couranr tracking link is accepted", () => {
  it.each([
    ["https://couranr.com/track/abc123", "/track/abc123"],
    ["https://couranr.com/track/abc123/", "/track/abc123"],
    ["/track/abc123", "/track/abc123"],
    ["track/abc123", "/track/abc123"],
    ["  https://couranr.com/track/abc123  ", "/track/abc123"],
    ["https://couranr.com/track/A-b_9.~", "/track/A-b_9.~"],
  ])("accepts %s", (input, want) => {
    expect(parseTrackingPath(input, SELF)).toBe(want);
  });

  it("accepts an absolute link on whatever host the page is actually served from", () => {
    /* Preview deployments and localhost are the reason the guard compares
       against the page's own host instead of a hardcoded couranr.com. */
    expect(parseTrackingPath("http://localhost:3000/track/abc123", "localhost:3000")).toBe(
      "/track/abc123",
    );
    expect(
      parseTrackingPath("https://couranr-os-git-x.vercel.app/track/abc123", "couranr-os-git-x.vercel.app"),
    ).toBe("/track/abc123");
  });

  it("keeps the token percent-encoded exactly as pasted", () => {
    /* The path handed to the router must be the ENCODED form: decoding it and
       re-inserting would change which token the page receives. */
    expect(parseTrackingPath("https://couranr.com/track/a%2Fb", SELF)).toBe("/track/a%2Fb");
  });
});

describe("anything that is not a tracking link is refused", () => {
  it.each([
    ["", "empty"],
    ["   ", "whitespace"],
    ["hello", "not a path"],
    ["/business", "another route"],
    ["/track", "no token"],
    ["/track/", "empty token"],
    ["/track/a/b", "two segments after track"],
    ["/track/abc?next=/admin", "query after the token"],
    ["/track/abc#frag", "fragment after the token"],
    ["/pay/abc", "a different token surface"],
    ["https://couranr.com/pay/abc", "a different token surface, absolute"],
    ["/track/..", "traversal"],
    ["/track/.", "dot segment"],
  ])("refuses %s (%s)", (input) => {
    expect(parseTrackingPath(input, SELF)).toBeNull();
  });

  /* The ones that would be an open redirect or a script execution if they got
     through. Each is refused BEFORE any path shape is considered. */
  it.each([
    "javascript:alert(1)",
    "javascript:/track/abc",
    "data:text/html,<script>alert(1)</script>",
    "mailto:someone@example.test",
    "//evil.test/track/abc",
    "https://evil.test@couranr.com/track/abc",
    "\\\\evil.test/track/abc",
  ])("refuses the hostile input %s", (input) => {
    const out = parseTrackingPath(input, SELF);
    expect(out === null || out.startsWith("/track/")).toBe(true);
    /* A scheme or an authority must never survive into the destination. */
    if (out !== null) {
      expect(out).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
      expect(out.startsWith("//")).toBe(false);
    }
  });

  it("refuses a protocol-relative URL outright rather than repairing it", () => {
    expect(parseTrackingPath("//evil.test/track/abc", SELF)).toBeNull();
  });
});

/**
 * Gate H: "external/non-Couranr URL is refused."
 *
 * THIS FILE ASSERTED THE OPPOSITE AND PASSED. The retired test read:
 *
 *     it("takes only the path from an absolute URL, never the host", () => {
 *       expect(parseTrackingPath("https://evil.test/track/abc")).toBe("/track/abc");
 *
 * with a comment calling the host-discarding "deliberate and safe". It was
 * neither: the gate requires refusal, and a pasted link that silently becomes a
 * different link is wrong even when the destination is our own origin. The
 * behaviour was never reviewed against the gate — it was reviewed against
 * itself, which is what an assertion written from the implementation does.
 */
describe("gate H — an absolute URL is accepted only on the page's own host", () => {
  it.each([
    "https://evil.test/track/abc",
    "http://evil.test/track/abc",
    "https://couranr.com.evil.test/track/abc",
    "https://sub.couranr.com/track/abc",
    "https://couranr.com:8443/track/abc",
    "https://evil.test@couranr.com.evil.test/track/abc",
  ])("refuses %s", (input) => {
    expect(parseTrackingPath(input, SELF)).toBeNull();
  });

  it("refuses an absolute URL when there is no host to compare against", () => {
    /* SSR, or a caller with no `window`. Fail closed: a relative path still
       works, so refusing costs nothing and guessing costs the guarantee. */
    expect(parseTrackingPath("https://couranr.com/track/abc", null)).toBeNull();
    expect(parseTrackingPath("/track/abc", null)).toBe("/track/abc");
  });

  it("matches the host exactly, including the port", () => {
    expect(parseTrackingPath("http://localhost:3000/track/abc", "localhost:3000")).toBe("/track/abc");
    expect(parseTrackingPath("http://localhost:3001/track/abc", "localhost:3000")).toBeNull();
  });

  it("reads the page's own host by default", () => {
    /* The default argument is what the component actually uses. Proven by
       comparing the no-argument result against the explicit one for the same
       host, under whatever `window` this environment has (none, in node). */
    const host = typeof window === "undefined" ? null : window.location.host;
    expect(parseTrackingPath("https://couranr.com/track/abc")).toBe(
      parseTrackingPath("https://couranr.com/track/abc", host),
    );
  });
});

describe("the launcher sends the pasted link nowhere", () => {
  const src = readFileSync(
    path.join(ROOT, "components/couranr/shell/TrackDeliveryLauncher.tsx"),
    "utf8",
  );
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  /* A delivery access token is exactly the value that must never reach a log,
     an analytics call or a server. The guarantee is that the component has no
     mechanism to send one — asserted as an absence, because a test that only
     checks the happy path cannot see an added `fetch`. */
  it.each(["fetch(", "XMLHttpRequest", "navigator.sendBeacon", "localStorage", "sessionStorage", "document.cookie", "console.log"])(
    "contains no %s",
    (banned) => {
      expect(code).not.toContain(banned);
    },
  );

  it("navigates with the router and nothing else", () => {
    expect(code).toContain("router.push");
    /* Reading `window.location.host` is the same-origin guard and is required.
       What must never appear is a NAVIGATION through location — that would
       leave the SPA, and an assignment form would also bypass the parse. */
    for (const banned of [
      "location.href =",
      "location.href=",
      "location.assign",
      "location.replace",
      "window.open",
    ]) {
      expect(code, `navigates outside the router via ${banned}`).not.toContain(banned);
    }
  });
});
