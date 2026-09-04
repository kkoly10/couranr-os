"use client";

import { call } from "@/components/couranr/requests/client";

export type DriverAccountView = {
  driver: {
    id: string;
    displayName: string;
    driverState: string;
    availabilityState: string;
    availabilityPreference: string;
    active: boolean;
    market: string | null;
    version: number;
  };
  vehicles: DriverVehicleView[];
};

export type DriverVehicleView = {
  id: string;
  name: string;
  vehicleClass: string;
  payloadCapacityLb: number;
  cargoLengthIn: number | null;
  cargoWidthIn: number | null;
  cargoHeightIn: number | null;
  enclosed: boolean;
  hasRamp: boolean;
  hasDolly: boolean;
  hasTieDowns: boolean;
  weatherProtection: boolean;
  active: boolean;
  availabilityState: string;
  version: number;
};

export function fetchMyDriverProfile() {
  return call<DriverAccountView>("/api/couranr/driver/profile");
}

export function setMyDriverAvailability(input: {
  expectedVersion: number;
  preference: "available" | "unavailable";
}) {
  return call<{ driver: DriverAccountView["driver"] }>("/api/couranr/driver/availability", {
    method: "PATCH",
    body: input,
  });
}
