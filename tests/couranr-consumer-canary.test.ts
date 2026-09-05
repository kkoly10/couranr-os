import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  consumerSendProductionEnvironment,
  consumerSendServerLive,
} from "@/lib/couranr/sameday/serverGate";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const CONSUMER_ROUTES = [
  "app/api/couranr/consumer/canary/activate/route.ts",
  "app/api/couranr/consumer/session/route.ts",
  "app/api/couranr/consumer/places/route.ts",
  "app/api/couranr/consumer/estimate/route.ts",
  "app/api/couranr/consumer/submit/route.ts",
  "app/api/couranr/consumer/pay/route.ts",
  "app/api/couranr/consumer/request/route.ts",
  "app/api/couranr/consumer/readiness/route.ts",
  "app/api/couranr/consumer/interpret/route.ts",
  "app/api/couranr/consumer/refresh-quote/route.ts",
  "app/api/couranr/consumer/reconcile-payment/route.ts",
] as const;

const SQL = read(
  "supabase/migrations/20260905080000_couranr_consumer_canary_access.sql"
);
const ROLLBACK = read(
  "supabase/rollbacks/20260905080000_couranr_consumer_canary_access.rollback.sql"
);
const PLACES_ROUTE = read("app/api/couranr/consumer/places/route.ts");
const ESTIMATE_ROUTE = read("app/api/couranr/consumer/estimate/route.ts");
const REFRESH_ROUTE = read("app/api/couranr/consumer/refresh-quote/route.ts");
const SEND_FLOW = read("components/couranr/sameday/SendFlow.tsx");
const LIVE_ADAPTERS = read("lib/couranr/sameday/liveAdapters.ts");

describe("Consumer Same Day server kill switch", () => {
  it("does not arm production with only the ordinary live key", () => {
    expect(
      consumerSendServerLive({
        nodeEnv: "production",
        vercelEnv: "production",
        consumerSendFlag: "live",
      })
    ).toBe(false);
  });

  it("requires both exact live keys in production", () => {
    expect(
      consumerSendServerLive({
        nodeEnv: "production",
        vercelEnv: "production",
        consumerSendFlag: "live",
        consumerSendProductionFlag: "live",
      })
    ).toBe(true);
    expect(
      consumerSendServerLive({
        nodeEnv: "production",
        vercelEnv: "production",
        consumerSendFlag: "true",
        consumerSendProductionFlag: "live",
      })
    ).toBe(false);
  });

  it("does not mistake a Vercel preview for production", () => {
    expect(
      consumerSendProductionEnvironment({
        nodeEnv: "production",
        vercelEnv: "preview",
      })
    ).toBe(false);
    expect(
      consumerSendProductionEnvironment({
        nodeEnv: "production",
        vercelEnv: "production",
      })
    ).toBe(true);
  });

  it("every consumer API fails closed before guest redemption or provider work", () => {
    for (const routePath of CONSUMER_ROUTES) {
      const src = read(routePath);
      const gate = src.indexOf(
        "consumerSendServerLive()",
        src.indexOf("export async function")
      );
      expect(gate, routePath).toBeGreaterThanOrEqual(0);

      for (const later of [
        "redeemGuestSessionToken(",
        "createGuestSession(",
        "createConsumerCanaryGuestSession(",
        "autocompleteConsumerPlaces(",
        "estimateConsumerSend(",
        "payConsumerSend(",
        "reconcileConsumerPayment(",
      ]) {
        const at = src.indexOf(later, src.indexOf("export async function"));
        if (at >= 0) expect(gate, `${routePath}: ${later}`).toBeLessThan(at);
      }
    }
  });
});

describe("production canary containment", () => {
  it("keeps ordinary production visitors on the disabled page state", () => {
    const page = read(
      "app/(couranr)/(public)/(consumer-public)/send/page.tsx"
    );
    expect(page).toContain("consumerCanaryCookieValid");
    expect(page).toContain('mode = "disabled"');
    expect(page.indexOf("consumerCanaryCookieValid")).toBeLessThan(
      page.indexOf('mode = "disabled"')
    );
  });

  it("accepts the one-time canary code only in a POST body and replaces it with an HttpOnly cookie", () => {
    const route = read(
      "app/api/couranr/consumer/canary/activate/route.ts"
    );
    expect(route).toContain("await req.formData()");
    expect(route).toContain('form.get("token")');
    expect(route).not.toContain("searchParams.get");
    expect(route).not.toContain("nextUrl.searchParams");
    expect(route).toContain('req.headers.get("origin")');
    expect(route).toContain("new URL(req.url).origin");
    expect(route.indexOf('req.headers.get("origin")')).toBeLessThan(
      route.indexOf("await req.formData()")
    );
    expect(route).toContain("httpOnly: true");
    expect(route).toContain("secure: true");
    expect(route).toContain('sameSite: "strict"');
    expect(route).toContain('headers.set("Referrer-Policy", "no-referrer")');
  });

  it("never exposes the canary code-entry state to search engines", () => {
    const page = read(
      "app/(couranr)/(public)/(consumer-public)/send/canary/page.tsx"
    );
    expect(page).toContain("robots: { index: false, follow: false }");
    expect(page).toContain('type="password"');
    expect(page).toContain('method="post"');
  });

  it("keeps the forward migration as one non-duplicated SQL program", () => {
    expect((SQL.match(/^begin;$/gm) ?? [])).toHaveLength(1);
    expect((SQL.match(/^commit;$/gm) ?? [])).toHaveLength(1);
    for (const fn of [
      "couranr_issue_consumer_canary_access",
      "couranr_redeem_consumer_canary_access",
      "couranr_resolve_consumer_canary_cookie",
      "couranr_create_consumer_canary_guest_session",
      "couranr_claim_consumer_canary_place_search",
      "couranr_claim_consumer_canary_estimate",
      "couranr_revoke_consumer_canary_access",
    ]) {
      expect(
        (SQL.match(new RegExp(`create or replace function public\\\\.${fn}\\\\(`, "g")) ?? [])
          .length,
        fn
      ).toBe(1);
    }
  });

  it("stores only hashes and permits one guest session per canary access", () => {
    expect(SQL).toContain("create table if not exists public.couranr_consumer_canary_access");
    expect(SQL).toContain("token_hash text not null");
    expect(SQL).toContain("cookie_hash text");
    expect(SQL).not.toMatch(/raw_token|raw_cookie|access_token\s+text/i);
    expect(SQL).toContain("constraint couranr_cca_guest_session_uniq unique (guest_session_id)");
    expect(SQL).toContain("canary_guest_session_already_created");
    expect(SQL).toContain("couranr_create_consumer_canary_guest_session");
    expect(SQL).toContain("public.couranr_create_consumer_guest_session(");
    expect(SQL).not.toMatch(/insert into public\.couranr_consumer_guest_sessions\s*\(/i);
    expect(SQL).toContain("set expires_at=least(expires_at,v_access.expires_at)");
    expect(SQL).toContain("pg_advisory_xact_lock(hashtext('couranr-consumer-send-canary'))");
    expect(SQL).toContain("consumer_canary_already_active");
  });

  it("caps production paid-provider entrypoints per canary before provider work", () => {
    expect(SQL).toContain("c_places_per_hour constant integer:=12");
    expect(SQL).toContain("c_estimates_per_hour constant integer:=6");
    expect(SQL).toContain("couranr_claim_consumer_canary_place_search");
    expect(SQL).toContain("couranr_claim_consumer_canary_estimate");

    const placeClaim = PLACES_ROUTE.indexOf("claimConsumerCanaryPlaceSearch");
    const google = PLACES_ROUTE.indexOf("autocompleteConsumerPlaces(query)");
    expect(placeClaim).toBeGreaterThanOrEqual(0);
    expect(google).toBeGreaterThanOrEqual(0);
    expect(placeClaim).toBeLessThan(google);

    const estimateClaim = ESTIMATE_ROUTE.indexOf("claimConsumerCanaryEstimate");
    const estimate = ESTIMATE_ROUTE.indexOf("estimateConsumerSend");
    expect(estimateClaim).toBeGreaterThanOrEqual(0);
    expect(estimate).toBeGreaterThanOrEqual(0);
    // Use the call inside POST, not the import.
    expect(ESTIMATE_ROUTE.indexOf("await claimConsumerCanaryEstimate")).toBeLessThan(
      ESTIMATE_ROUTE.indexOf("await estimateConsumerSend")
    );

    expect(REFRESH_ROUTE.indexOf("await claimConsumerCanaryEstimate")).toBeLessThan(
      REFRESH_ROUTE.indexOf("await refreshConsumerSendQuote")
    );
  });

  it("debounces autocomplete and requires three characters before any request", () => {
    expect(SEND_FLOW).toContain("addressSearchSeq");
    expect(SEND_FLOW).toContain("setTimeout(resolve, 350)");
    expect(SEND_FLOW).toContain("value.trim().length < 3");
    expect(SEND_FLOW).toContain("seq !== addressSearchSeq.current");
    expect(LIVE_ADAPTERS).toContain("if (q.length < 3) return []");
    expect(PLACES_ROUTE).toContain("query.trim().length < 3");
  });

  it("keeps canary storage service-role-only", () => {
    expect(SQL).toContain("alter table public.couranr_consumer_canary_access enable row level security");
    expect(SQL).toContain(
      "revoke all on public.couranr_consumer_canary_access from public,anon,authenticated,service_role"
    );
    expect(SQL).toContain(
      "grant select,insert,update on public.couranr_consumer_canary_access to service_role"
    );
    expect(SQL).toContain(
      "grant execute on function public.couranr_redeem_consumer_canary_access(text,text)"
    );
    expect(SQL).toContain("to service_role;");
  });

  it("rollback refuses to destroy real canary evidence", () => {
    expect(ROLLBACK).toContain(
      "refusing to drop consumer canary access with evidence"
    );
    expect(ROLLBACK).toContain(
      "exists (select 1 from public.couranr_consumer_canary_access)"
    );
  });
});
