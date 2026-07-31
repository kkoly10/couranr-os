# Couranr Logo System — Canonical v1.0

This package is the only approved source for the Couranr logo. Do not recreate the logo with text, AI generation, CSS, or a different icon.

## Canonical design

- **Wordmark:** lowercase `couranr`, outlined from Inter Display ExtraBold.
- **Motion accent:** one Couranr Gold forward-motion mark integrated with the final `r`.
- **App mark:** white `C` with the same gold motion accent on a Couranr Navy rounded square.
- **Tagline lockup:** optional `DELIVERY MADE SIMPLE`. Do not use the tagline inside small headers.
- **No location-pin logo:** the pin-style marks shown in earlier exploratory mocks are retired.

## Colors

| Token | Hex | Use |
|---|---|---|
| Couranr Navy | `#0D1525` | Primary wordmark, dark backgrounds |
| Couranr Gold | `#F4B740` | Motion accent and primary brand action |
| White | `#FFFFFF` | Reverse wordmark |
| Route Blue | `#2563EB` | Product UI only, not the logo |

## Approved files

### Light backgrounds
- `svg/couranr-logo-primary.svg`
- `svg/couranr-logo-monochrome-navy.svg`

### Dark/photo backgrounds
- `svg/couranr-logo-reverse.svg`
- `svg/couranr-logo-monochrome-white.svg`

### App/favicon/social mark
- `svg/couranr-app-icon.svg`
- PNG icon sizes under `png/`

### Optional campaign lockup
- `svg/couranr-logo-lockup.svg`
- `svg/couranr-logo-lockup-reverse.svg`

## Website rules

- Public header: primary wordmark on white; reverse wordmark over dark hero/photo.
- Header minimum width: **132 px**; preferred desktop width: **160–180 px**.
- App icon minimum: **24 px**; preferred favicon/PWA sizes are included.
- Preserve the SVG aspect ratio. Never stretch.
- Maintain clear space around the logo equal to the height of the lowercase `o` counter.
- Use the reverse SVG over the dark hero. Do not place the navy logo directly over photography.

## Prohibited

- Do not type `couranr` with a font as a substitute for the outlined SVG.
- Do not use the old `C.` header logo.
- Do not use a map-pin/C symbol.
- Do not move, enlarge, rotate, or recolor the gold accent.
- Do not make the final letter gold.
- Do not add shadows, outlines, gradients, or glow.
- Do not place the logo inside a pill or badge.
- Do not use logo versions generated inside mockup images.

## Suggested repository paths

```text
public/brand/couranr-logo-primary.svg
public/brand/couranr-logo-reverse.svg
public/brand/couranr-logo-monochrome-navy.svg
public/brand/couranr-logo-monochrome-white.svg
public/brand/couranr-app-icon.svg
public/brand/couranr-app-icon-512.png
public/brand/couranr-app-icon-192.png
components/brand/CouranrLogo.tsx
```

Copy the supplied `CouranrLogo.tsx` into the component path and update every public/auth/merchant/driver/Operations surface to use it.
