/**
 * §33 — ACTIVE timing-truth regression.
 *
 * The authority is HRS/TMZ-001: Monday–Friday, 6:00 AM–6:00 PM Eastern,
 * same-day cutoff 4:00 PM, overnight request-only. This scan walks the ACTIVE
 * delivery surfaces — canonical (couranr) pages and the delivery policy page —
 * and fails on claims that contradict it:
 *
 *   - 9 AM as a normal opening time (the drift this batch actually found and
 *     fixed on the delivery policy page);
 *   - weekend standard delivery;
 *   - automatically accepted overnight;
 *   - normal same-day fulfillment promised after the 4 PM cutoff.
 *
 * Deliberately NOT scanned: legacy auto/docs pages (quarantine targets whose
 * rental-office hours are a different product's claim, not Couranr delivery
 * doctrine) and archived/historical evidence, which §24 forbids rewriting.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OPERATING_DAYS_COPY,
  OPERATING_WINDOW_COPY,
  SAME_DAY_CUTOFF_COPY,
} from "@/lib/couranr/public/governed";

const ROOT = path.resolve(__dirname, "..");

/** Active delivery surfaces only. */
const ACTIVE_DIRS = ["app/(couranr)", "app/policy/delivery", "components/couranr"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

const activeFiles = ACTIVE_DIRS.flatMap((d) => {
  const full = path.join(ROOT, d);
  try {
    return walk(full);
  } catch {
    return [];
  }
});

describe("active pages tell the truth about timing", () => {
  it("finds the surfaces it polices", () => {
    expect(activeFiles.length).toBeGreaterThan(50);
  });

  it("no active delivery surface claims a 9 AM opening", () => {
    const offenders: string[] = [];
    for (const file of activeFiles) {
      const text = readFileSync(file, "utf8");
      if (/9(?::00)?\s?(?:AM|am)\s?(?:–|-|to)/.test(text)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no active delivery surface promises weekend standard delivery", () => {
    const offenders: string[] = [];
    for (const file of activeFiles) {
      const text = readFileSync(file, "utf8");
      if (/(?:seven days a week|7 days a week|weekends? included|Saturday and Sunday delivery)/i.test(text)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no active delivery surface offers overnight without Couranr confirmation", () => {
    // Wherever overnight is rendered as bookable copy, the request-only rule
    // must be nearby. Heuristic but real: every current overnight mention
    // pairs with request/confirmation language; a page that adds "book
    // overnight now" without it fails here.
    const offenders: string[] = [];
    for (const file of activeFiles) {
      const text = readFileSync(file, "utf8");
      if (/book overnight|overnight (?:available now|guaranteed)/i.test(text)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no active delivery surface promises same-day after the cutoff", () => {
    const offenders: string[] = [];
    for (const file of activeFiles) {
      const text = readFileSync(file, "utf8");
      if (/same.day (?:until|through) (?:6|7|8|9|10)\s?PM/i.test(text)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the delivery policy page renders governed constants, not restated hours", () => {
    const text = readFileSync(path.join(ROOT, "app/policy/delivery/page.tsx"), "utf8");
    expect(text).toContain("OPERATING_WINDOW_COPY");
    expect(text).toContain("SAME_DAY_CUTOFF_COPY");
    expect(text).not.toMatch(/9:00 AM/);
  });

  it("the governed constants agree with the timing doctrine module", () => {
    expect(OPERATING_WINDOW_COPY).toBe("6:00 AM to 6:00 PM Eastern");
    expect(OPERATING_DAYS_COPY).toBe("Monday through Friday");
    expect(SAME_DAY_CUTOFF_COPY).toBe("4:00 PM");
  });
});
