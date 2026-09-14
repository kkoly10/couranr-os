"use client";

import * as React from "react";
import type { AddressSearchResult, AddressSuggestion } from "@/lib/couranr/sameday/adapters";

/**
 * Consumer Same Day address field.
 *
 * The same interaction contract as `BusinessPlaceAutocomplete` — the funnel is
 * public, so it must be at least as careful — adapted to the consumer seam:
 *
 *  - debounced search (300ms), minimum 3 characters, so a paid provider call
 *    is never made on every keystroke or on a too-short query;
 *  - a monotonic sequence guard so a slow earlier response can never overwrite
 *    a newer one (stale-response protection);
 *  - a SELECTED canonical Place ID is tracked; editing the text after a
 *    selection invalidates that identity immediately, so a stale Place ID can
 *    never describe a new trip;
 *  - a provider/service FAILURE is a distinct `error` state, separate from a
 *    genuine "no matching address" (`empty`) and from `rate-limited`;
 *  - combobox/listbox roles and aria wiring for the mobile picker.
 *
 * Unlike the Business component there is no separate resolve step: the consumer
 * estimate takes the Google Place ID directly and re-verifies it with Place
 * Details server-side, so selecting a suggestion IS the canonical identity.
 */

export type ConsumerAddressValue = { value: string; placeId: string | null };

type FieldState = "idle" | "searching" | "results" | "empty" | "rate-limited" | "error";

export function ConsumerAddressField({
  id,
  label,
  hint,
  value,
  onChange,
  search,
}: {
  id: string;
  label: string;
  hint: string | null;
  value: ConsumerAddressValue;
  onChange: (next: ConsumerAddressValue) => void;
  search: (query: string) => Promise<AddressSearchResult>;
}) {
  const [query, setQuery] = React.useState(value.value);
  const [results, setResults] = React.useState<AddressSuggestion[]>([]);
  const [state, setState] = React.useState<FieldState>("idle");
  const selectedPlaceId = React.useRef<string | null>(value.placeId);
  const searchSeq = React.useRef(0);

  // Keep the input in sync when the PARENT resets the value (e.g. a resumed
  // page rehydrating, or a programmatic clear). Guarded on the place id so
  // ordinary keystroke round-trips do not fight the local input state.
  React.useEffect(() => {
    if (value.placeId && value.placeId !== selectedPlaceId.current) {
      selectedPlaceId.current = value.placeId;
      setQuery(value.value);
      setResults([]);
      setState("idle");
    } else if (!value.placeId && selectedPlaceId.current && value.value === "") {
      selectedPlaceId.current = null;
      setQuery("");
      setResults([]);
      setState("idle");
    }
  }, [value.placeId, value.value]);

  React.useEffect(() => {
    const trimmed = query.trim();
    // A selected identity or a sub-3 query never calls the provider.
    if (selectedPlaceId.current || trimmed.length < 3) {
      if (!selectedPlaceId.current) setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = window.setTimeout(() => {
      setState("searching");
      void search(trimmed).then((r) => {
        // Stale-response guard: only the newest query's answer may land.
        if (seq !== searchSeq.current) return;
        if (r.status === "rate-limited") {
          setResults([]);
          setState("rate-limited");
          return;
        }
        if (r.status === "error") {
          setResults([]);
          setState("error");
          return;
        }
        setResults(r.suggestions);
        setState(r.suggestions.length ? "results" : "empty");
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, search]);

  function edit(next: string) {
    searchSeq.current += 1; // cancel any in-flight response
    selectedPlaceId.current = null; // editing invalidates the selected identity
    setQuery(next);
    setResults([]);
    setState(next.trim().length >= 3 ? "searching" : "idle");
    onChange({ value: next, placeId: null });
  }

  function choose(s: AddressSuggestion) {
    searchSeq.current += 1;
    selectedPlaceId.current = s.id;
    const shown = s.detail ? `${s.label}, ${s.detail}` : s.label;
    setQuery(shown);
    setResults([]);
    setState("idle");
    onChange({ value: shown, placeId: s.id });
  }

  const listId = React.useId();

  return (
    <div className="cr-send-field cr-place-search" data-couranr-address={id} data-state={state}>
      <label className="cr-send-field__label" htmlFor={id}>
        {label}
      </label>
      {hint ? <p className="cr-send-field__hint">{hint}</p> : null}
      <input
        id={id}
        className="cr-input"
        type="text"
        inputMode="search"
        autoComplete="off"
        placeholder="Start typing a street address"
        value={query}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        onChange={(e) => edit(e.target.value)}
      />
      {state === "searching" ? (
        <p className="cr-send-field__note" aria-live="polite">
          Searching addresses…
        </p>
      ) : null}
      {state === "empty" ? (
        <p className="cr-send-field__note">No matching street addresses yet.</p>
      ) : null}
      {state === "rate-limited" ? (
        <p className="cr-send-field__note" role="status">
          Too many address searches. Wait a moment, then try again.
        </p>
      ) : null}
      {state === "error" ? (
        <p className="cr-field__error" role="alert">
          Address lookup is unavailable. Try again.
        </p>
      ) : null}
      {results.length > 0 ? (
        <ul id={listId} className="cr-send-suggestions" role="listbox" aria-label={`${label} suggestions`}>
          {results.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="cr-send-suggestion"
                role="option"
                aria-selected="false"
                onClick={() => choose(s)}
              >
                <span className="cr-send-suggestion__label">{s.label}</span>
                {s.detail ? <span className="cr-send-suggestion__detail">{s.detail}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
