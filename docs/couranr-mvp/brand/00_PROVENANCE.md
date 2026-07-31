# Provenance — Couranr logo system

`couranr_logo_system/` is unpacked verbatim from
`Couranr_Canonical_Logo_System_v1.zip`, tracked at the repo root since
2026-07-28 (`f19d9d5`) and never opened until now. Nothing was edited during
extraction; the zip itself is unchanged.

## Which copy does the app actually serve?

`public/brand/` — the **approved subset** named in `couranr_logo_system/BRAND_GUIDE.md`
under "Approved files", byte-identical to the copies here:

| Serving from `public/brand/` | Purpose |
|---|---|
| `couranr-logo-primary.svg` | light backgrounds |
| `couranr-logo-reverse.svg` | dark and photographic backgrounds |
| `couranr-logo-monochrome-navy.svg` / `-white.svg` | single-colour contexts |
| `couranr-app-icon.svg` + 192/256/512 PNG | favicon, PWA, Apple touch |

The 192px PNG is the only generated file: it was downscaled from the supplied
512 because the package ships 128 and 256 but not 192, and the guide asks for
192. Everything else is the delivered artifact untouched.

This directory additionally keeps what the app does not serve — the `@800` and
`@1600` rasters, the optional campaign lockups, the brand board, and the
original `CouranrLogo.tsx` — so the package is inspectable without unzipping
anything.

## The rules live in BRAND_GUIDE.md

`couranr_logo_system/BRAND_GUIDE.md` is the authority. Its prohibitions are
enforced in code by `tests/brand-logo.test.ts`:

- never type `couranr` in a font as a substitute for the outlined SVG
- never use the retired `C.` header logo or a map-pin mark
- never recolor, rotate or redraw the gold accent
- never stretch — the wordmark is fixed at the supplied 900×250 viewBox

Every one of those was being violated before the package was opened, which is
the whole reason the guard exists.

## Colour and type

Couranr Navy `#0D1525`, Couranr Gold `#F4B740`, White `#FFFFFF`, and Route Blue
`#2563EB` for **product UI only, never the logo**. Inter / Geist Sans.

Note for anyone reading the mock set: several of the 91 root PNGs contain
logo treatments generated inside the mockups. `BRAND_GUIDE.md` retires them
explicitly — "Do not use logo versions generated inside mockup images" and "the
pin-style marks shown in earlier exploratory mocks are retired". The mocks
remain the authority for **layout**; this package is the authority for **the
logo**.
