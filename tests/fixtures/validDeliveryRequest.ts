/* The canonical valid merchant request, lifted verbatim from
   tests/couranr-request-input.test.ts so two suites cannot drift apart on what
   'otherwise valid' means. */
export const VALID = {
  pickupAddress: {
    googlePlaceId: "ChIJ-pickup",
    formattedAddress: "10 Market St, Stafford, VA 22554, USA",
    line1: "10 Market St",
    line2: null,
    city: "Stafford",
    region: "VA",
    postalCode: "22554",
    countryCode: "US",
    latitude: 38.422,
    longitude: -77.408,
    addressSource: "google_places_new",
    instructions: null,
  },
  dropoffAddress: {
    googlePlaceId: "ChIJ-dropoff",
    formattedAddress: "9 Elm Ave, Fredericksburg, VA 22401, USA",
    line1: "9 Elm Ave",
    line2: null,
    city: "Fredericksburg",
    region: "VA",
    postalCode: "22401",
    countryCode: "US",
    latitude: 38.303,
    longitude: -77.46,
    addressSource: "google_places_new",
    instructions: null,
  },
  weightLb: "12.5",
};
