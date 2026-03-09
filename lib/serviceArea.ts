export const SERVICE_HUB = "22554 Stafford, VA";
export const DOCS_SERVICE_RADIUS_MILES = 30;
export const COURIER_SERVICE_RADIUS_MILES = 60;
export const COURIER_INSTANT_QUOTE_MAX_MILES = COURIER_SERVICE_RADIUS_MILES;
export const PRIMARY_SERVICE_TOWNS = ["Stafford", "Fredericksburg", "Woodbridge"] as const;

export const SERVICE_AREA_NOTE = `${PRIMARY_SERVICE_TOWNS.join(", ")} and surrounding towns, centered near ${SERVICE_HUB}.`;
