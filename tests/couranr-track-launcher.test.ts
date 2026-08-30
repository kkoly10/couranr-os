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

describe("a real Couranr tracking link is accepted", () => {
  it.each([
    ["https://couranr.com/track/abc123", "/track/abc123"],
    ["http://localhost:3000/track/abc123", "/track/abc123"],
    ["https://couranr.com/track/abc123/", "/track/abc123"],
    ["/track/abc123", "/track/abc123"],
    ["track/abc123", "/track/abc123"],
    ["  https://couranr.com/track/abc123  ", "/track/abc123"],
    ["https://couranr.com/track/A-b_9.~", "/track/A-b_9.~"],
  ])("accepts %s", (input, want) => {
    expect(parseTrackingPath(input)).toBe(want);
  });

  it("keeps the token percent-encoded exactly as pasted", () => {
    /* The path handed to the router must be the ENCODED form: decoding it and
       re-inserting would change which token the page receives. */
    expect(parseTrackingPath("https://couranr.com/track/a%2Fb")).toBe("/track/a%2Fb");
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
    expect(parseTrackingPath(input)).toBeNull();
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
    const out = parseTrackingPath(input);
    expect(out === null || out.startsWith("/track/")).toBe(true);
    /* A scheme or an authority must never survive into the destination. */
    if (out !== null) {
      expect(out).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
      expect(out.startsWith("//")).toBe(false);
    }
  });

  it("refuses a protocol-relative URL outright rather than repairing it", () => {
    expect(parseTrackingPath("//evil.test/track/abc")).toBeNull();
  });

  /* An ABSOLUTE URL on another host resolves to its own pathname. That is
     deliberate and safe — only the path is used and the host is discarded, so
     a link from anywhere lands on THIS site's /track/[token]. Asserted so the
     behaviour is a decision rather than an accident. */
  it("takes only the path from an absolute URL, never the host", () => {
    expect(parseTrackingPath("https://evil.test/track/abc")).toBe("/track/abc");
    expect(parseTrackingPath("https://evil.test/track/abc")).not.toContain("evil.test");
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
    expect(code).not.toContain("window.location");
  });
});
