"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SEND_COPY } from "@/lib/couranr/public/masterSameDayCopy";
import {
  getSameDayAdapters,
  type AddressSuggestion,
  type AvailabilityVerdict,
  type IntakeReading,
  type QuoteReading,
} from "@/lib/couranr/sameday/adapters";
import type { AdapterMode } from "@/lib/couranr/sameday/adapterMode";

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
};

const emptyAddress: AddressState = { value: "", status: "blank", results: [] };

export function SendFlow({ mode, productionStop }: { mode: AdapterMode; productionStop: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const adapters = React.useMemo(
    /* The mode comes from the server. Passing it back in means the client
       resolver agrees with the server's decision instead of re-deriving it
       from an environment the browser cannot see. */
    () => getSameDayAdapters(mode === "fixture" ? { nodeEnv: "test" } : { nodeEnv: "production" }),
    [mode],
  );

  const [intent, setIntent] = React.useState<Intent | null>(() => parseIntent(params.get("intent")));
  const [phase, setPhase] = React.useState<Phase>("trip");

  const [pickup, setPickup] = React.useState<AddressState>(emptyAddress);
  const [destination, setDestination] = React.useState<AddressState>(emptyAddress);
  const [availability, setAvailability] = React.useState<AvailabilityVerdict | null>(null);

  const [item, setItem] = React.useState("");
  const [intake, setIntake] = React.useState<IntakeReading | { state: "untouched" } | { state: "analyzing" }>({ state: "untouched" });
  const [readiness, setReadiness] = React.useState<"yes" | "no" | null>(null);
  const [reference, setReference] = React.useState("");

  const [timing, setTiming] = React.useState<"asap" | "today" | "schedule" | null>(null);

  const [quote, setQuote] = React.useState<QuoteReading | { state: "calculating" } | { state: "stale" } | null>(null);
  const [contact, setContact] = React.useState({ name: "", mobile: "", email: "" });
  const [acknowledged, setAcknowledged] = React.useState(false);

  const [payment, setPayment] = React.useState<
    "not-available" | "preparing" | "form-shell" | "processing" | "authorized-fixture" | "failed"
  >(mode === "fixture" ? "form-shell" : "not-available");
  const [received, setReceived] = React.useState(false);

  /* An edit that would change a quote marks the existing one STALE rather than
     leaving a number on screen that no longer describes the trip. */
  const invalidateQuote = React.useCallback(() => {
    setQuote((q) => (q && "state" in q && q.state === "fixture-available" ? { state: "stale" } : q));
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
    set((s) => ({ ...s, value, status: value ? "typing" : "blank", results: [] }));
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
    set({ value: `${s.label}, ${s.detail}`, status: "selected", results: [] });
    invalidateQuote();
  }

  async function checkAvailability() {
    setAvailability(null);
    const verdict = await adapters.checkAvailability(pickup.value, destination.value);
    setAvailability(verdict);
  }

  async function readItem() {
    setIntake({ state: "analyzing" });
    setIntake(await adapters.readIntake(item));
    invalidateQuote();
  }

  async function computeQuote() {
    setQuote({ state: "calculating" });
    setQuote(
      await adapters.quote({
        pickup: pickup.value,
        destination: destination.value,
        timing: timing ?? "asap",
      }),
    );
  }

  async function submit() {
    setPayment("processing");
    const outcome = await adapters.submitRequest();
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
        <p className="cr-mkt-editorial__body cr-type-lead">{SEND_COPY.received_support}</p>
        {/* NO confirmation number, driver, ETA or tracking token. None exists —
            no request was created — and inventing one would be a fabricated
            record on a customer's screen. */}
        <p className="cr-send-note">Preview only. No delivery was requested.</p>
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
          </div>

          {intent === "pickup" ? (
            <fieldset className="cr-send-field">
              <legend className="cr-send-field__label">{SEND_COPY.readiness_question}</legend>
              {([["yes", SEND_COPY.readiness_yes], ["no", SEND_COPY.readiness_no]] as const).map(([v, label]) => (
                <label key={v} className="cr-send-choice">
                  <input type="radio" name="readiness" checked={readiness === v} onChange={() => setReadiness(v)} />
                  <span>{label}</span>
                </label>
              ))}
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
            </fieldset>
          ) : null}

          <div className="cr-send-actions">
            <button type="button" className="cr-button cr-button--ghost" onClick={() => setPhase("trip")}>
              Back
            </button>
            <button type="button" className="cr-button cr-button--primary" onClick={() => setPhase("timing")}>
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {phase === "timing" ? (
        <div className="cr-send-panel">
          <fieldset className="cr-send-field">
            <legend className="cr-send-field__label">{SEND_COPY.timing_question}</legend>
            {(
              [
                ["asap", SEND_COPY.timing_asap],
                ["today", SEND_COPY.timing_today],
                ["schedule", SEND_COPY.timing_schedule],
              ] as const
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
          {/* These choices are PRESENTATION. They map to no service level and
              no price: SUR-001's amounts describe the business quote, and this
              flow computes nothing. */}
          <p className="cr-send-note">Couranr confirms timing before anything is scheduled.</p>

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
                ...(intent === "pickup" ? [["Ready", readiness === "yes" ? SEND_COPY.readiness_yes : SEND_COPY.readiness_no] as const] : []),
                ["When", timing ?? ""],
                ["Contact", contact.name],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="cr-send-summary__row">
                <dt>{k}</dt>
                <dd>{v || "—"}</dd>
                <button type="button" className="cr-send-edit" onClick={() => setPhase(k === "Item" || k === "Ready" ? "item" : k === "When" ? "timing" : "trip")}>
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
              <p className="cr-send-note">A payment form appears here when Same Day ordering opens.</p>
              <button type="button" className="cr-button cr-button--primary" onClick={() => void submit()}>
                Request this delivery
              </button>
            </>
          ) : null}

          {payment === "processing" ? <p className="cr-send-note">Working…</p> : null}
          {payment === "failed" ? (
            <p className="cr-field__error" role="alert">
              That did not go through. Nothing was charged.
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
