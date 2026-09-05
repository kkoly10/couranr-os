"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SEND_COPY } from "@/lib/couranr/public/masterSameDayCopy";
import {
  getSameDayAdapters,
  type AddressSuggestion,
  type AvailabilityVerdict,
  type IntakeProposal,
  type IntakeReading,
  type QuoteReading,
} from "@/lib/couranr/sameday/adapters";
import type { AdapterMode } from "@/lib/couranr/sameday/adapterMode";
import { GUEST_STORAGE_KEY } from "@/lib/couranr/sameday/liveAdapters";
import { WEIGHT_BAND_LABELS } from "@/lib/couranr/shipment/weightBandLabels";
import { CouranrPaymentElement } from "@/components/couranr/payments/CouranrPaymentElement";
import { formatCents } from "@/lib/couranr/requests/view";

/**
 * PUB-004's `/send` flow — presentation and state only.
 *
 * WHAT IT NEVER DOES: create a request, search a real address, check a real
 * service area, run real Smart Intake, price a real delivery, or take a
 * payment. Every one of those is an adapter call, and in production every
 * adapter refuses. The `mode` prop is resolved SERVER-side; this component
 * cannot turn fixtures on and reads nothing from the URL that could.
 *
 * `?intent=` IS read from the URL, and only `send` or `pickup` are accepted —
 * anything else falls back to the intent choice. An invalid intent must not
 * unlock anything, which is why the parse is an allow-list rather than a cast.
 *
 * NO CONTACT DATA IN THE URL. Name, mobile and email live in component state
 * and are never pushed to a query, a hash or a history entry. A delivery's
 * contact details in a URL end up in a referrer header and a browser history.
 */

type Intent = "send" | "pickup";
type Phase = "trip" | "item" | "timing" | "review" | "payment";

const PHASES: { key: Phase; label: string }[] = [
  { key: "trip", label: "Trip" },
  { key: "item", label: "Item" },
  { key: "timing", label: "Timing" },
  { key: "review", label: "Review" },
  { key: "payment", label: "Payment" },
];

function parseIntent(raw: string | null): Intent | null {
  return raw === "send" || raw === "pickup" ? raw : null;
}

type AddressState = {
  value: string;
  status: "blank" | "focused" | "typing" | "loading" | "results" | "selected" | "empty" | "error";
  results: AddressSuggestion[];
  /**
   * ADDITIVE, live mode: the Google Place ID of the SELECTED suggestion. The
   * canonical estimate takes place identities, never free text — typing after
   * a selection clears it, so a stale identity can never describe a new trip.
   */
  placeId?: string;
};

const emptyAddress: AddressState = { value: "", status: "blank", results: [] };

/**
 * The shipment-safety declaration options — SAME closed vocabulary and SAME
 * merchant-facing copy as `NewDeliveryFlow`'s select, held in parity by
 * tests/couranr-sameday-live.test.ts. "unknown" until the sender actively
 * confirms: an automatic price needs their affirmation, and Couranr reviews
 * everything else.
 */
const RESTRICTED_CLASS_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["alcohol", "alcohol"],
  ["tobacco", "tobacco"],
  ["vaping_nicotine", "vape or nicotine products"],
  ["cannabis_thc", "cannabis or THC products"],
  ["firearms", "firearms"],
  ["ammunition", "ammunition"],
  ["prescription_medication", "prescription medication"],
  ["controlled_substances", "controlled substances"],
  ["fuel", "fuel"],
  ["compressed_gas", "compressed gas"],
  ["corrosive_hazmat", "corrosive materials"],
  ["toxic_hazmat", "toxic materials"],
  ["infectious_material", "infectious material"],
  ["regulated_dangerous_goods", "regulated dangerous goods"],
  ["fireworks", "fireworks"],
  ["explosives", "explosives"],
  ["illegal_goods", "illegal goods"],
  ["stolen_goods", "stolen goods"],
  ["cash", "cash"],
  ["negotiable_instruments", "checks or other negotiable instruments"],
  ["biological_specimens", "biological specimens"],
  ["live_animals", "live animals"],
  ["people", "people"],
];

export function SendFlow({ mode, productionStop }: { mode: AdapterMode; productionStop: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const adapters = React.useMemo(
    /* The mode comes from the server. Passing it back in means the client
       resolver agrees with the server's decision instead of re-deriving it
       from an environment the browser cannot see. `live` mirrors the same
       trick: the server armed it (two-key arming in adapterMode.ts), so the
       client hands the resolver an input that resolves the same answer. */
    () =>
      getSameDayAdapters(
        mode === "fixture"
          ? { nodeEnv: "test" }
          : mode === "live"
            ? { nodeEnv: "development", consumerSendFlag: "live" }
            : { nodeEnv: "production" },
      ),
    [mode],
  );

  const [intent, setIntent] = React.useState<Intent | null>(() => parseIntent(params.get("intent")));
  const [phase, setPhase] = React.useState<Phase>("trip");

  const [pickup, setPickup] = React.useState<AddressState>(emptyAddress);
  const [destination, setDestination] = React.useState<AddressState>(emptyAddress);
  const [availability, setAvailability] = React.useState<AvailabilityVerdict | null>(null);

  const [item, setItem] = React.useState("");
  const [packageCount, setPackageCount] = React.useState("");
  /* The three structured inputs the canonical quote requires (SUR-001 /
     PRC-005): an honest weight statement — exact pounds OR a governed band,
     never both, never an invention — and the shipment-safety declaration. */
  const [weightMode, setWeightMode] = React.useState("exact");
  const [weightLb, setWeightLb] = React.useState("");
  const [restrictedClass, setRestrictedClass] = React.useState("unknown");
  const [intake, setIntake] = React.useState<IntakeReading | { state: "untouched" } | { state: "analyzing" }>({ state: "untouched" });
  const [readiness, setReadiness] = React.useState<"yes" | "no" | null>(null);
  const [reference, setReference] = React.useState("");

  const [timing, setTiming] = React.useState<"asap" | "today" | "schedule" | null>(null);

  const [quote, setQuote] = React.useState<QuoteReading | { state: "calculating" } | { state: "stale" } | null>(null);
  const [contact, setContact] = React.useState({ name: "", mobile: "", email: "" });
  const [acknowledged, setAcknowledged] = React.useState(false);

  const [payment, setPayment] = React.useState<
    | "not-available"
    | "preparing"
    | "form-shell"
    | "processing"
    | "authorized-fixture"
    | "authorization-required"
    | "failed"
  >(mode === "disabled" ? "not-available" : "form-shell");
  const [received, setReceived] = React.useState(false);

  /* Live mode only. The clientSecret and the amount are the SERVER's — the
     amount is displayed and never sent anywhere; the intent already carries
     it. The tracking token comes from the request GET, once, when one exists. */
  const [livePayment, setLivePayment] = React.useState<{
    clientSecret: string;
    amountCents: number;
  } | null>(null);
  const [liveNote, setLiveNote] = React.useState<string | null>(null);
  const [trackingToken, setTrackingToken] = React.useState<string | null>(null);
  /* True when the server says the payment is authorized while Couranr review
     is still pending — the CAP-001 posture the received screen must state. */
  const [authorizedPending, setAuthorizedPending] = React.useState(false);
  /* True when the server says the request is confirmed (resume path). */
  const [confirmed, setConfirmed] = React.useState(false);
  /* Final closure §5: a resumed request is ALREADY SUBMITTED — the payment
     button must go straight to /pay and never POST /submit again. */
  const [resumePay, setResumePay] = React.useState(false);

  /* An edit that would change a quote marks the existing one STALE rather than
     leaving a number on screen that no longer describes the trip. */
  const invalidateQuote = React.useCallback(() => {
    setQuote((q) =>
      q && "state" in q && (q.state === "fixture-available" || q.state === "live-available")
        ? { state: "stale" }
        : q,
    );
  }, []);

  function chooseIntent(next: Intent) {
    setIntent(next);
    /* Intent MAY stay in the URL — it names a mode, not a person. Replace
       rather than push so Back does not walk through intent choices. */
    router.replace(`?intent=${next}`, { scroll: false });
  }

  async function searchInto(
    set: React.Dispatch<React.SetStateAction<AddressState>>,
    value: string,
  ) {
    /* Typing clears the selected place identity — free text is never one. */
    set((s) => ({ ...s, value, status: value ? "typing" : "blank", results: [], placeId: undefined }));
    invalidateQuote();
    if (value.trim().length < 2) return;
    set((s) => ({ ...s, status: "loading" }));
    const results = await adapters.searchAddress(value);
    set((s) => ({ ...s, status: results.length ? "results" : "empty", results }));
  }

  function selectSuggestion(
    set: React.Dispatch<React.SetStateAction<AddressState>>,
    s: AddressSuggestion,
  ) {
    set({
      value: s.detail ? `${s.label}, ${s.detail}` : s.label,
      status: "selected",
      results: [],
      placeId: s.id,
    });
    invalidateQuote();
  }

  async function checkAvailability() {
    setAvailability(null);
    const verdict = await adapters.checkAvailability(pickup.value, destination.value);
    setAvailability(verdict);
  }

  /* INT-002: STRUCTURED suggestions from Consumer Smart Intake. A material
     suggestion (weight, band, restricted class) changes the form ONLY through
     the guest's explicit "Use this" — never a silent prefill; the rest is
     read-only context. Nothing here is authority: the server re-derives
     everything on the estimate, and the model's free text never renders.

     Held in their OWN state, not derived from `intake`: while a re-read is in
     flight the last suggestions stay on screen. A read that blanked them would
     eat the very click that chose one — clicking "Use this" blurs the textarea,
     and the blur is what triggers the read. */
  const [intakeProposals, setIntakeProposals] = React.useState<IntakeProposal[]>([]);
  const lastIntakeRead = React.useRef("");
  const intakeReadSeq = React.useRef(0);

  async function readItem() {
    const t = item.trim();
    /* Same words, same answer: the server converges on the same revision and
       spends nothing — so the browser does not even ask. */
    if (t === lastIntakeRead.current) return;
    lastIntakeRead.current = t;
    const seq = ++intakeReadSeq.current;
    setIntake({ state: "analyzing" });
    const reading = await adapters.readIntake(item);
    /* Two reads in flight (the words changed twice): only the NEWEST answer
       may land. A slower, earlier answer describes words no longer typed. */
    if (seq !== intakeReadSeq.current) return;
    setIntake(reading);
    setIntakeProposals("proposals" in reading && Array.isArray(reading.proposals) ? reading.proposals : []);
    invalidateQuote();
  }

  function describeProposal(p: IntakeProposal): string {
    const v = p.value;
    const word = (x: unknown) => String(x).replace(/_/g, " ");
    switch (p.key) {
      case "quantity":
        return `Quantity: ${String(v)}`;
      case "package_count":
        return `Packages: ${String(v)}`;
      case "weight_lb_exact":
        return `Weight: ${String(v)} lb`;
      case "weight_band":
        return `Weight: ${
          typeof v === "string" && Object.prototype.hasOwnProperty.call(WEIGHT_BAND_LABELS, v)
            ? WEIGHT_BAND_LABELS[v as keyof typeof WEIGHT_BAND_LABELS]
            : word(v)
        }`;
      case "fragile":
        return v === true ? "Fragile" : "Not fragile";
      case "restricted_class": {
        if (v === "none") return "No restricted items";
        const match = RESTRICTED_CLASS_OPTIONS.find(([value]) => value === v);
        return match ? `Contains: ${match[1]}` : `Restricted: ${word(v)}`;
      }
      default:
        return `${word(p.key)}: ${word(v)}`;
    }
  }

  /** The form action a material suggestion offers, or null for context-only. */
  function suggestionAction(p: IntakeProposal): (() => void) | null {
    const v = p.value;
    if (
      p.key === "package_count" &&
      typeof v === "number" &&
      Number.isInteger(v) &&
      v > 0 &&
      v <= 9999
    ) {
      return () => {
        setPackageCount(String(v));
        invalidateQuote();
      };
    }
    if (p.key === "weight_lb_exact" && typeof v === "number" && Number.isFinite(v) && v > 0) {
      return () => {
        setWeightMode("exact");
        setWeightLb(String(v));
        invalidateQuote();
      };
    }
    if (
      p.key === "weight_band" &&
      typeof v === "string" &&
      (v === "unknown" || Object.prototype.hasOwnProperty.call(WEIGHT_BAND_LABELS, v))
    ) {
      return () => {
        setWeightMode(v);
        invalidateQuote();
      };
    }
    if (
      p.key === "restricted_class" &&
      typeof v === "string" &&
      (v === "none" || v === "unknown" || RESTRICTED_CLASS_OPTIONS.some(([value]) => value === v))
    ) {
      return () => {
        setRestrictedClass(v);
        invalidateQuote();
      };
    }
    return null;
  }

  async function computeQuote(): Promise<QuoteReading> {
    setQuote({ state: "calculating" });
    const reading = await adapters.quote({
        pickup: pickup.value,
        destination: destination.value,
        timing: timing ?? "asap",
        /* Live-only structured inputs; fixtures ignore every one of them. The
           adapter maps the UI's `mobile` to the API/DB key `phone`. */
        pickupPlaceId: pickup.placeId ?? null,
        dropoffPlaceId: destination.placeId ?? null,
        contact: { name: contact.name, mobile: contact.mobile, email: contact.email },
        shipment: {
          description: item,
          packageCount:
            packageCount.trim() === "" ? null : Number(packageCount.trim()),
          orderReference: reference.trim() || null,
          weightLb: weightMode === "exact" && weightLb.trim() !== "" ? Number(weightLb) : null,
          weightBand: weightMode === "exact" ? null : weightMode,
          restrictedClass,
        },
      });

    /*
     * FND-006 readiness parity. The estimate creates/binds the canonical guest
     * request, then the explicit answer is written onto the SAME
     * readiness_state Business uses. No answer is inferred from intent.
     */
    if (
      mode === "live" &&
      readiness !== null &&
      reading.state !== "unavailable" &&
      adapters.setPickupReadiness
    ) {
      const saved = await adapters.setPickupReadiness(
        readiness === "yes" ? "ready" : "not_ready"
      );
      if (!saved.ok) {
        const failed: QuoteReading = {
          state: "unavailable",
          note: saved.note ?? "Couranr could not save pickup readiness.",
        };
        setQuote(failed);
        return failed;
      }
    }

    setQuote(reading);
    return reading;
  }

  /* Live mode: the request GET is the only voice on whether a tracking link
     exists. When it names none, the received screen simply shows none. */
  async function finishLive() {
    const view = adapters.readRequest ? await adapters.readRequest() : null;
    setTrackingToken(view?.trackingToken ?? null);
    setAuthorizedPending(
      view?.paymentState === "authorized" && view?.state === "pending_couranr_review"
    );
    setReceived(true);
  }

  /* RESUMABLE LIVE PATH (review item 2): a reload resumes from the CANONICAL
     request/payment state instead of restarting the funnel. Live-only and
     feature-checked — fixture and disabled adapters have no readRequest and
     gain nothing here — and it runs only when a guest session is ALREADY
     stored, so a first visit never mints one just by loading the page. */
  React.useEffect(() => {
    if (mode !== "live" || !adapters.readRequest) return;
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(GUEST_STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (!stored) return;
    let cancelled = false;
    void (async () => {
      const view = adapters.readRequest ? await adapters.readRequest() : null;
      if (cancelled || !view) return;
      if (view.state === "awaiting_quote_acceptance" || view.state === "quote_revision_required") {
        /* Awaiting the payer: straight to payment, with the server's number.
           The request is already submitted, so the CTA continues payment. */
        setResumePay(true);
        setIntent((v) => v ?? "send");
        setPhase("payment");
        if (typeof view.totalCents === "number") {
          setQuote({
            state: "live-available",
            totalCents: view.totalCents,
            quoteVersionId: null,
            requestId: "",
            expiresAt: null,
          });
        }
        setLiveNote(
          view.state === "quote_revision_required"
            ? "Couranr updated the price — please approve the new total."
            : null
        );
        setPayment("form-shell");
        return;
      }
      if (view.state === "pending_couranr_review") {
        setAuthorizedPending(view.paymentState === "authorized");
        setReceived(true);
        return;
      }
      if (view.state === "confirmed") {
        /* The raw tracking token is shown once by doctrine; a later resume
           may not get it back. The STATUS is still the truth to show. */
        setConfirmed(true);
        setTrackingToken(view.trackingToken ?? null);
        setReceived(true);
        return;
      }
      /* draft (or anything else): the funnel starts normally and the stored
         session simply keeps owning the same request. */
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only by design: the canonical state is re-read per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* QVL-001 recovery (final closure §5): the price aged out. A resumed page
     has NO form state, so re-posting local inputs would fabricate an
     estimate — the server re-prices the SAME bound request from its STORED
     canonical facts instead. Quote N+1 comes back; the visitor confirms the
     fresh total and pays THAT, never the stale number. */
  async function refreshExpiredQuote() {
    let fresh: QuoteReading;
    if (adapters.refreshQuote) {
      setQuote({ state: "calculating" });
      fresh = await adapters.refreshQuote();
      setQuote(fresh);
    } else {
      fresh = await computeQuote();
    }
    if (fresh.state === "live-available" || fresh.state === "fixture-available") {
      setLiveNote("The price was refreshed — please confirm the new total.");
      setPayment("form-shell");
      return;
    }
    /* The stored facts could not be re-priced, or the request moved on. Show
       the server's reason — never a "refreshed" total that does not exist. */
    setLiveNote("note" in fresh ? fresh.note : "Couranr could not refresh the price right now.");
    setPayment("failed");
  }

  /* Final closure §5: the RESUMED payment action. The request already exists
     and was already submitted — this calls /pay directly and NEVER /submit. */
  async function continuePayment() {
    setPayment("processing");
    setLiveNote(null);
    const auth = await adapters.authorizePayment();
    if (auth.state === "authorization-required") {
      setLivePayment({ clientSecret: auth.clientSecret, amountCents: auth.amountCents });
      setPayment("authorization-required");
      return;
    }
    if (auth.state === "quote-expired") {
      await refreshExpiredQuote();
      return;
    }
    if (auth.state === "not-payable") {
      await finishLive();
      return;
    }
    setLiveNote("note" in auth ? auth.note : null);
    setPayment("failed");
  }

  async function submit() {
    setPayment("processing");
    setLiveNote(null);
    const outcome = await adapters.submitRequest();

    if (mode === "live") {
      if (outcome.state !== "received") {
        setLiveNote(outcome.state === "unavailable" ? outcome.note : null);
        setPayment("failed");
        return;
      }
      const auth = await adapters.authorizePayment();
      if (auth.state === "authorization-required") {
        /* The server minted the intent; the one Payment Element confirms it,
           and only the server's reconcile can call it authorized. */
        setLivePayment({ clientSecret: auth.clientSecret, amountCents: auth.amountCents });
        setPayment("authorization-required");
        return;
      }
      if (auth.state === "quote-expired") {
        await refreshExpiredQuote();
        return;
      }
      if (auth.state === "not-payable") {
        /* The manual-review path: the request is in Couranr review with no
           payable price yet, and the received screen says exactly that. */
        await finishLive();
        return;
      }
      setLiveNote("note" in auth ? auth.note : null);
      setPayment("failed");
      return;
    }

    if (outcome.state !== "received-preview") {
      /* The production path stops HERE. A disabled adapter cannot return
         success, so this branch is what a real visitor reaches. */
      setPayment("not-available");
      return;
    }
    const auth = await adapters.authorizePayment();
    if (auth.state !== "authorized-fixture") {
      setPayment("failed");
      return;
    }
    setPayment("authorized-fixture");
    setReceived(true);
  }

  const addressField = (
    label: string,
    hint: string | null,
    state: AddressState,
    set: React.Dispatch<React.SetStateAction<AddressState>>,
    id: string,
  ) => (
    <div className="cr-send-field" data-couranr-address={id} data-state={state.status}>
      <label className="cr-send-field__label" htmlFor={id}>
        {label}
      </label>
      {hint ? <p className="cr-send-field__hint">{hint}</p> : null}
      <input
        id={id}
        className="cr-input"
        type="text"
        autoComplete="off"
        value={state.value}
        onFocus={() => set((s) => (s.status === "blank" ? { ...s, status: "focused" } : s))}
        onChange={(e) => void searchInto(set, e.target.value)}
      />
      {state.status === "loading" ? <p className="cr-send-field__note">Searching…</p> : null}
      {state.status === "empty" ? <p className="cr-send-field__note">No matches.</p> : null}
      {state.status === "error" ? (
        <p className="cr-field__error" role="alert">
          Address lookup is unavailable.
        </p>
      ) : null}
      {state.status === "results" ? (
        <ul className="cr-send-suggestions">
          {state.results.map((s) => (
            <li key={s.id}>
              <button type="button" className="cr-send-suggestion" onClick={() => selectSuggestion(set, s)}>
                <span className="cr-send-suggestion__label">{s.label}</span>
                <span className="cr-send-suggestion__detail">{s.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  if (!intent) {
    return (
      <section className="cr-mkt-section cr-send" aria-labelledby="send-h" data-couranr-send="intent">
        <h1 id="send-h" className="cr-type-statement">
          What do you need?
        </h1>
        <div className="cr-sd-intents">
          <button type="button" className="cr-sd-intent" onClick={() => chooseIntent("send")}>
            <span className="cr-sd-intent__title">Send something I have</span>
            <span className="cr-sd-intent__support">From me, my home, work, a friend or family member.</span>
          </button>
          <button type="button" className="cr-sd-intent" onClick={() => chooseIntent("pickup")}>
            <span className="cr-sd-intent__title">Pick something up for me</span>
            <span className="cr-sd-intent__support">Something you’ve already bought, ordered or arranged.</span>
          </button>
        </div>
      </section>
    );
  }

  if (received) {
    return (
      <section className="cr-mkt-section cr-send" aria-labelledby="send-h" data-couranr-send="received">
        <h1 id="send-h" className="cr-type-statement">
          {SEND_COPY.received_heading}
        </h1>
        <p className="cr-mkt-editorial__body cr-type-lead">
          {mode === "live" && confirmed ? "Couranr confirmed your delivery." : SEND_COPY.received_support}
        </p>
        {/* CAP-001 truth: authorized is not charged. Shown only when the
            server says the payment is authorized and review is pending. */}
        {mode === "live" && authorizedPending ? (
          <p className="cr-send-note">
            Your payment is authorized. You&apos;ll only be charged after Couranr
            confirms your delivery.
          </p>
        ) : null}
        {/* Live mode: the tracking link renders ONLY when the request GET
            returned a token — the server is the one voice on whether tracking
            exists, and nothing here invents a reference. In every other mode
            no request was created, and saying so is the only honest line;
            inventing a confirmation would be a fabricated record on a
            customer's screen. */}
        {mode === "live" && trackingToken ? (
          <p className="cr-send-note">
            <a href={`/track/${trackingToken}`}>Track this delivery</a>
          </p>
        ) : null}
        {mode === "live" ? null : (
          <p className="cr-send-note">Preview only. No delivery was requested.</p>
        )}
      </section>
    );
  }

  return (
    <section className="cr-mkt-section cr-send" aria-labelledby="send-h" data-couranr-send={phase}>
      <h1 id="send-h" className="cr-type-statement">
        {intent === "send" ? "Send something" : "Pick something up"}
      </h1>

      <ol className="cr-send-rail" aria-label="Delivery steps">
        {PHASES.map((p) => (
          <li
            key={p.key}
            className="cr-send-rail__step"
            aria-current={p.key === phase ? "step" : undefined}
            data-current={p.key === phase ? "true" : "false"}
          >
            {p.label}
          </li>
        ))}
      </ol>

      {phase === "trip" ? (
        <div className="cr-send-panel">
          {addressField(
            intent === "send" ? SEND_COPY.trip_send_origin : SEND_COPY.trip_pickup_origin,
            intent === "pickup" ? SEND_COPY.trip_pickup_hint : null,
            pickup,
            setPickup,
            "send-pickup",
          )}
          {addressField(SEND_COPY.trip_destination, null, destination, setDestination, "send-destination")}

          <button type="button" className="cr-button cr-button--secondary" onClick={() => void checkAvailability()}>
            Check this trip
          </button>
          {availability ? (
            <p className="cr-send-note" data-couranr-availability={availability.state}>
              {availability.state === "eligible"
                ? "Couranr covers this trip."
                : availability.note}
            </p>
          ) : null}

          <button type="button" className="cr-button cr-button--primary" onClick={() => setPhase("item")}>
            Continue
          </button>
        </div>
      ) : null}

      {phase === "item" ? (
        <div className="cr-send-panel">
          <div className="cr-send-field">
            <label className="cr-send-field__label" htmlFor="send-item">
              {SEND_COPY.item_question}
            </label>
            {/* INT-002 disclosure: at the START of the item step, before any
                description is read — always visible in live mode. */}
            {mode === "live" ? (
              <p className="cr-send-field__hint" data-couranr-ai-disclosure="true">
                {SEND_COPY.item_ai_disclosure}
              </p>
            ) : null}
            <textarea
              id="send-item"
              className="cr-input cr-send-textarea"
              rows={4}
              placeholder={SEND_COPY.item_example}
              value={item}
              onChange={(e) => setItem(e.target.value)}
              onBlur={() => item.trim() && void readItem()}
            />
            <p className="cr-send-note" data-couranr-intake={intake.state}>
              {intake.state === "analyzing" ? "Reading…" : null}
              {intake.state === "interpreted" ? intake.summary : null}
              {intake.state === "needs-follow-up" ? intake.question : null}
              {intake.state === "unavailable" ? "Couranr will read this when you submit." : null}
            </p>
            {mode === "live" && intakeProposals.length > 0 ? (
              <ul
                className="cr-send-suggestions"
                data-couranr-intake-suggestions="true"
                aria-label="Suggestions from your description"
              >
                {intakeProposals.map((p) => {
                  const action = suggestionAction(p);
                  return (
                    <li key={p.key} className="cr-send-suggestion__row" data-couranr-suggestion={p.key}>
                      <span>{describeProposal(p)}</span>
                      {action ? (
                        <button
                          type="button"
                          className="cr-button cr-button--secondary"
                          onClick={action}
                          aria-label={`Use this: ${describeProposal(p)}`}
                        >
                          Use this
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          <div className="cr-send-field">
            <label className="cr-send-field__label" htmlFor="send-package-count">
              How many packages?
            </label>
            <p className="cr-send-field__hint">
              Optional if you genuinely do not know. The driver sees this expectation and does not re-enter it.
            </p>
            <input
              id="send-package-count"
              className="cr-input"
              type="number"
              min="1"
              max="9999"
              step="1"
              inputMode="numeric"
              value={packageCount}
              onChange={(e) => {
                setPackageCount(e.target.value);
                invalidateQuote();
              }}
            />
          </div>

          {/* The structured inputs the canonical quote requires (SUR-001):
              an honest weight statement and the shipment-safety declaration.
              Band labels come from WEIGHT_BAND_LABELS so the 25 lb boundary
              can only ever be described one way. */}
          <div className="cr-send-field">
            <label className="cr-send-field__label" htmlFor="send-weight">
              Weight
            </label>
            <select
              id="send-weight"
              className="cr-input"
              value={weightMode}
              onChange={(e) => {
                setWeightMode(e.target.value);
                invalidateQuote();
              }}
            >
              <option value="exact">I know the exact weight</option>
              <option value="0_25_lb">{WEIGHT_BAND_LABELS["0_25_lb"]}</option>
              <option value="over_25_to_50_lb">{WEIGHT_BAND_LABELS.over_25_to_50_lb}</option>
              <option value="over_50_lb">{WEIGHT_BAND_LABELS.over_50_lb}</option>
              <option value="unknown">Not sure yet</option>
            </select>
            {weightMode === "exact" ? (
              <>
                <label className="cr-send-field__label" htmlFor="send-weight-lb">
                  Weight (lb)
                </label>
                <input
                  id="send-weight-lb"
                  className="cr-input"
                  type="number"
                  min="0"
                  step="0.1"
                  inputMode="decimal"
                  value={weightLb}
                  onChange={(e) => {
                    setWeightLb(e.target.value);
                    invalidateQuote();
                  }}
                />
              </>
            ) : null}
          </div>

          <div className="cr-send-field">
            <label className="cr-send-field__label" htmlFor="send-restricted">
              Restricted items
            </label>
            <p className="cr-send-field__hint">
              An automatic price needs your confirmation that none of these are in the shipment.
              Anything else goes to Couranr review.
            </p>
            <select
              id="send-restricted"
              className="cr-input"
              value={restrictedClass}
              onChange={(e) => {
                setRestrictedClass(e.target.value);
                invalidateQuote();
              }}
            >
              <option value="unknown">Not sure yet — Couranr will review</option>
              <option value="none">None of these — I confirm</option>
              {RESTRICTED_CLASS_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  Contains: {label}
                </option>
              ))}
            </select>
          </div>

          {intent === "pickup" || mode === "live" ? (
            <fieldset className="cr-send-field">
              <legend className="cr-send-field__label">{SEND_COPY.readiness_question}</legend>
              {([
                ["yes", intent === "send" ? "Yes, it’s ready to hand over" : SEND_COPY.readiness_yes],
                ["no", SEND_COPY.readiness_no],
              ] as const).map(([v, label]) => (
                <label key={v} className="cr-send-choice">
                  <input type="radio" name="readiness" checked={readiness === v} onChange={() => setReadiness(v)} />
                  <span>{label}</span>
                </label>
              ))}
              {intent === "pickup" ? (
                <>
                  <label className="cr-send-field__label" htmlFor="send-ref">
                    Pickup or order reference (optional)
                  </label>
                  <input
                    id="send-ref"
                    className="cr-input"
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </>
              ) : null}
            </fieldset>
          ) : null}

          <div className="cr-send-actions">
            <button type="button" className="cr-button cr-button--ghost" onClick={() => setPhase("trip")}>
              Back
            </button>
            <button
              type="button"
              className="cr-button cr-button--primary"
              disabled={mode === "live" && readiness === null}
              onClick={() => setPhase("timing")}
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {phase === "timing" ? (
        <div className="cr-send-panel">
          <fieldset className="cr-send-field">
            <legend className="cr-send-field__label">{SEND_COPY.timing_question}</legend>
            {/* LIVE mode is ASAP ONLY (review item 5): the backend prices and
                dispatches every consumer request as ASAP, so rendering a
                choice it ignores would be a control that lies. Consumer
                scheduled timing is DEFERRED, not hidden behind a dead radio.
                Fixture/preview keeps the three choices for visual
                preservation of the shipped design. */}
            {(mode === "live"
              ? ([["asap", SEND_COPY.timing_asap]] as const)
              : ([
                  ["asap", SEND_COPY.timing_asap],
                  ["today", SEND_COPY.timing_today],
                  ["schedule", SEND_COPY.timing_schedule],
                ] as const)
            ).map(([v, label]) => (
              <label key={v} className="cr-send-choice">
                <input
                  type="radio"
                  name="timing"
                  checked={timing === v}
                  onChange={() => {
                    setTiming(v);
                    invalidateQuote();
                  }}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <p className="cr-send-note">
            {mode === "live" ? SEND_COPY.timing_live_note : "Couranr confirms timing before anything is scheduled."}
          </p>

          <div className="cr-send-actions">
            <button type="button" className="cr-button cr-button--ghost" onClick={() => setPhase("item")}>
              Back
            </button>
            <button
              type="button"
              className="cr-button cr-button--primary"
              onClick={() => {
                setPhase("review");
                void computeQuote();
              }}
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {phase === "review" ? (
        <div className="cr-send-panel">
          <h2 className="cr-type-marketing-section">{SEND_COPY.review_heading}</h2>
          <dl className="cr-send-summary">
            {(
              [
                [intent === "send" ? "From" : "Pick up from", pickup.value],
                ["To", destination.value],
                ["Item", item],
                ["Packages", packageCount.trim() || "Not specified"],
                ...(reference.trim() ? [["Pickup reference", reference] as const] : []),
                ...(intent === "pickup" || mode === "live"
                  ? [[
                      "Ready",
                      readiness === "yes"
                        ? intent === "send"
                          ? "Yes, it’s ready to hand over"
                          : SEND_COPY.readiness_yes
                        : SEND_COPY.readiness_no,
                    ] as const]
                  : []),
                ["When", timing ?? ""],
                ["Contact", contact.name],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="cr-send-summary__row">
                <dt>{k}</dt>
                <dd>{v || "—"}</dd>
                <button type="button" className="cr-send-edit" onClick={() => setPhase(
                  k === "Item" || k === "Packages" || k === "Pickup reference" || k === "Ready"
                    ? "item"
                    : k === "When"
                      ? "timing"
                      : "trip"
                )}>
                  Edit
                </button>
              </div>
            ))}
          </dl>

          <p className="cr-send-note" data-couranr-quote={quote?.state ?? "none"}>
            {!quote ? null : null}
            {quote?.state === "calculating" ? "Calculating…" : null}
            {quote?.state === "stale" ? "You changed the trip — check the price again." : null}
            {quote?.state === "manual-review" ? quote.note : null}
            {quote?.state === "unavailable" ? quote.note : null}
            {quote?.state === "fixture-available" ? quote.note : null}
            {/* The live price is the SERVER's number, echoed. Nothing here
                computed it and nothing here can change it. */}
            {quote?.state === "live-available" ? `Total: ${formatCents(quote.totalCents)}` : null}
          </p>

          <div className="cr-send-field">
            <p className="cr-send-field__label">{SEND_COPY.contact_heading}</p>
            {(
              [
                ["name", "Name", "text"],
                ["mobile", "Mobile", "tel"],
                ["email", "Email", "email"],
              ] as const
            ).map(([k, label, type]) => (
              <label key={k} className="cr-send-field__inline">
                <span>{label}</span>
                <input
                  className="cr-input"
                  type={type}
                  value={contact[k]}
                  onChange={(e) => setContact((c) => ({ ...c, [k]: e.target.value }))}
                  onBlur={() => {
                    /* Live mode: the FIRST estimate needs contact (it freezes
                       the draft's contact snapshot), so the price is fetched
                       once the visitor provides a way to reach them. A quote
                       already standing is left alone — contact never moves a
                       price. */
                    if (
                      mode === "live" &&
                      quote?.state !== "live-available" &&
                      quote?.state !== "calculating"
                    ) {
                      void computeQuote();
                    }
                  }}
                />
              </label>
            ))}
            {/* No password and no account creation. Customer accounts are
                optional at MVP and this flow creates none. */}
          </div>

          <label className="cr-send-choice">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            <span>{SEND_COPY.acknowledgement}</span>
          </label>

          <div className="cr-send-actions">
            <button type="button" className="cr-button cr-button--ghost" onClick={() => setPhase("timing")}>
              Back
            </button>
            <button
              type="button"
              className="cr-button cr-button--primary"
              disabled={!acknowledged}
              onClick={() => setPhase("payment")}
            >
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {phase === "payment" ? (
        <div className="cr-send-panel" data-couranr-payment={payment}>
          <h2 className="cr-type-marketing-section">Payment</h2>

          {payment === "not-available" ? (
            <>
              {/* The production path. MKT-005's exact stop, and no control that
                  could take it further. */}
              <p className="cr-send-stop" role="status">
                {productionStop}
              </p>
              <p className="cr-send-note">Couranr will open Same Day ordering when it is ready.</p>
            </>
          ) : null}

          {payment === "form-shell" ? (
            <>
              {mode === "live" ? (
                quote?.state === "live-available" ? (
                  <p className="cr-send-note">Total: {formatCents(quote.totalCents)}</p>
                ) : null
              ) : (
                <p className="cr-send-note">A payment form appears here when Same Day ordering opens.</p>
              )}
              {/* The resume/refresh note: "Couranr updated the price" or
                  "The price was refreshed" — the server's reason the total
                  on screen may differ from the one the visitor last saw. */}
              {mode === "live" && liveNote ? (
                <p className="cr-send-note" role="status">
                  {liveNote}
                </p>
              ) : null}
              <button
                type="button"
                className="cr-button cr-button--primary"
                onClick={() => void (resumePay ? continuePayment() : submit())}
              >
                {resumePay ? "Continue to payment" : "Request this delivery"}
              </button>
            </>
          ) : null}

          {payment === "authorization-required" && livePayment ? (
            /* The ONE Stripe Payment Element. The amount is the server's echo
               of its stored obligation; authorization is a fact only the
               server's reconcile may establish, and the element enforces that. */
            <CouranrPaymentElement
              clientSecret={livePayment.clientSecret}
              amountCents={livePayment.amountCents}
              reconcile={async () =>
                adapters.reconcilePayment ? adapters.reconcilePayment() : {}
              }
              onAuthorized={() => void finishLive()}
            />
          ) : null}

          {payment === "processing" ? <p className="cr-send-note">Working…</p> : null}
          {payment === "failed" ? (
            <p className="cr-field__error" role="alert">
              {liveNote ?? "That did not go through. Nothing was charged."}
            </p>
          ) : null}

          <div className="cr-send-actions">
            <button type="button" className="cr-button cr-button--ghost" onClick={() => setPhase("review")}>
              Back
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
