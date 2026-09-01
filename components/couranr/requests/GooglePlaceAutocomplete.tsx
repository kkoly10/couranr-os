"use client";

import * as React from "react";
import {
  normalizeGooglePlaceSelection,
  type GoogleAddressSnapshot,
  type GooglePlaceLike,
} from "@/lib/couranr/routing/address";

declare global {
  interface Window {
    google?: {
      maps?: {
        importLibrary?: (name: string) => Promise<{
          PlaceAutocompleteElement?: new (options?: Record<string, unknown>) => HTMLElement;
        }>;
      };
    };
  }
}

type PlaceSelectEvent = Event & {
  placePrediction?: {
    toPlace?: () => GooglePlaceLike & {
      fetchFields?: (options: { fields: string[] }) => Promise<void>;
    };
  };
};

export function GooglePlaceAutocomplete({
  ready,
  value,
  onChange,
  onInvalidSelection,
}: {
  ready: boolean;
  value: GoogleAddressSnapshot | null;
  onChange: (address: GoogleAddressSnapshot) => void;
  onInvalidSelection: () => void;
}) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const callbackRef = React.useRef({ value, onChange, onInvalidSelection });
  callbackRef.current = { value, onChange, onInvalidSelection };

  React.useEffect(() => {
    if (!ready || !hostRef.current || hostRef.current.childElementCount > 0) return;
    let disposed = false;
    let element: HTMLElement | null = null;
    let listener: ((event: Event) => void) | null = null;
    let editListener: (() => void) | null = null;

    void window.google?.maps
      ?.importLibrary?.("places")
      .then(({ PlaceAutocompleteElement }) => {
        if (disposed || !hostRef.current || !PlaceAutocompleteElement) return;
        element = new PlaceAutocompleteElement({});
        element.setAttribute("aria-label", "Search for an address");
        element.classList.add("cr-google-place-autocomplete");

        listener = (rawEvent: Event) => {
          const event = rawEvent as PlaceSelectEvent;
          const place = event.placePrediction?.toPlace?.();
          if (!place?.fetchFields) {
            callbackRef.current.onInvalidSelection();
            return;
          }
          void place
            .fetchFields({
              fields: [
                "id",
                "displayName",
                "formattedAddress",
                "addressComponents",
                "location",
              ],
            })
            .then(() => {
              const normalized = normalizeGooglePlaceSelection(place, callbackRef.current.value);
              if (!normalized) {
                callbackRef.current.onInvalidSelection();
                return;
              }
              callbackRef.current.onChange(normalized);
            })
            .catch(callbackRef.current.onInvalidSelection);
        };
        // Once the merchant edits the widget, the previous Place is no longer
        // evidence for what is visible. A fresh gmp-select restores authority.
        editListener = () => callbackRef.current.onInvalidSelection();
        element.addEventListener("input", editListener);
        element.addEventListener("gmp-select", listener);
        hostRef.current.appendChild(element);
      })
      .catch(callbackRef.current.onInvalidSelection);

    return () => {
      disposed = true;
      if (element && editListener) element.removeEventListener("input", editListener);
      if (element && listener) element.removeEventListener("gmp-select", listener);
      element?.remove();
    };
  }, [ready]);

  return <div ref={hostRef} />;
}
