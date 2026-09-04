"use client";

import * as React from "react";
import {
  isApiFailure,
  resolveBusinessPlace,
  searchBusinessPlaces,
  type BusinessPlaceSuggestion,
} from "@/components/couranr/requests/client";
import type { GoogleAddressSnapshot } from "@/lib/couranr/routing/address";

type LookupState = "idle" | "searching" | "results" | "empty" | "resolving" | "error";

export function BusinessPlaceAutocomplete({
  businessAccountId,
  value,
  onChange,
}: {
  businessAccountId: string;
  value: GoogleAddressSnapshot | null;
  onChange: (address: GoogleAddressSnapshot | null) => void;
}) {
  const [query, setQuery] = React.useState(value?.formattedAddress ?? "");
  const [results, setResults] = React.useState<BusinessPlaceSuggestion[]>([]);
  const [state, setState] = React.useState<LookupState>("idle");
  const [message, setMessage] = React.useState<string | null>(null);
  const selectedPlaceId = React.useRef<string | null>(value?.googlePlaceId ?? null);
  const searchSeq = React.useRef(0);

  React.useEffect(() => {
    if (value?.googlePlaceId && value.googlePlaceId !== selectedPlaceId.current) {
      selectedPlaceId.current = value.googlePlaceId;
      setQuery(value.formattedAddress);
      setResults([]);
      setState("idle");
      setMessage(null);
    }
  }, [value]);

  React.useEffect(() => {
    if (!businessAccountId) return;
    const trimmed = query.trim();
    if (selectedPlaceId.current || trimmed.length < 3) {
      if (!selectedPlaceId.current) setResults([]);
      return;
    }

    const seq = ++searchSeq.current;
    const timer = window.setTimeout(() => {
      setState("searching");
      setMessage(null);
      void searchBusinessPlaces({ businessAccountId, query: trimmed }).then((result) => {
        if (seq !== searchSeq.current) return;
        if (isApiFailure(result)) {
          setResults([]);
          setState("error");
          setMessage(result.error || "Address lookup is unavailable.");
          return;
        }
        const suggestions = result.value.suggestions ?? [];
        setResults(suggestions);
        setState(suggestions.length ? "results" : "empty");
      });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [businessAccountId, query]);

  function edit(next: string) {
    searchSeq.current += 1;
    selectedPlaceId.current = null;
    setQuery(next);
    setResults([]);
    setState(next.trim().length >= 3 ? "searching" : "idle");
    setMessage(null);
    onChange(null);
  }

  async function choose(suggestion: BusinessPlaceSuggestion) {
    searchSeq.current += 1;
    setState("resolving");
    setMessage(null);
    const result = await resolveBusinessPlace({
      businessAccountId,
      placeId: suggestion.placeId,
      line2: value?.line2 ?? null,
      instructions: value?.instructions ?? null,
    });
    if (isApiFailure(result)) {
      selectedPlaceId.current = null;
      setState("error");
      setMessage(result.error || "Couranr could not verify that address.");
      onChange(null);
      return;
    }

    selectedPlaceId.current = result.value.address.googlePlaceId;
    setQuery(result.value.address.formattedAddress);
    setResults([]);
    setState("idle");
    setMessage(null);
    onChange(result.value.address);
  }

  const listId = React.useId();

  return (
    <div className="cr-place-search" data-state={state}>
      <input
        className="cr-input"
        type="text"
        inputMode="search"
        autoComplete="street-address"
        placeholder="Start typing a street address"
        value={query}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        onChange={(event) => edit(event.target.value)}
      />

      {state === "searching" || state === "resolving" ? (
        <p className="cr-send-field__note" aria-live="polite">
          {state === "resolving" ? "Verifying address…" : "Searching addresses…"}
        </p>
      ) : null}
      {state === "empty" ? (
        <p className="cr-send-field__note">No matching street addresses yet.</p>
      ) : null}
      {state === "error" ? (
        <p className="cr-field__error" role="alert">{message ?? "Address lookup is unavailable."}</p>
      ) : null}

      {results.length > 0 ? (
        <ul id={listId} className="cr-send-suggestions" role="listbox">
          {results.map((suggestion) => (
            <li key={suggestion.placeId}>
              <button
                type="button"
                className="cr-send-suggestion"
                role="option"
                aria-selected="false"
                onClick={() => void choose(suggestion)}
              >
                <span className="cr-send-suggestion__label">{suggestion.text}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
