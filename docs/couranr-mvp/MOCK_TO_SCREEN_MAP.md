# Mock → screen map

**GENERATED FILE — DO NOT EDIT.** Rendered from the `sources` section of
`docs/couranr-mvp/ui-reference/VISUAL_REGISTRY.json` by
`npm run governance:generate`. Every count in the census table below is
derived at render time; `npm run check:governance` regenerates this document
in memory and fails on a byte of difference.

The 91 PNGs at the repo root are the approved design mocks. Nothing in the
codebase referenced them, and thirteen of the 62 `canonical-mvp-images/**` paths
the screen registry cites exist on disk — so most canonical screens built so far
were built from the registry's *prose* (route, purpose, states) rather than from
its *design*. This file closes that gap: it is the missing filename↔screen
index.

**Built by looking.** Every root PNG was opened and identified visually; the
`image` field in `ui_screen_registry.json` (the descriptive slug, e.g.
`couranr_local_delivery_service_landing_page.png`) was matched to the UUID
filename on disk by matching what the mock depicts. No root PNG was moved,
renamed, or deleted, and none will be.

## What the census found

| | count |
|---|---|
| PNGs at repo root | 91 |
| …that map to one of the 68 registry screens | 69 |
| …that depict a screen **not** in the registry, or are photography | 22 |
| …unaccounted for | **0** |
| Registry screens with at least one mock | 50 of 68 |
| Registry screens with **no** mock | 18 |
| …of which "no mock" is correct by design | 6 (PUB-008…013) |
| …leaving real design gaps | **12** |

Those counts are produced, not asserted: `npm run check:mocks`
re-derives them from disk and fails if any filename in this document does not
exist, if any root PNG is unclaimed, or if a file is claimed twice.

`PUB-008` /pricing · `PUB-009` /businesses · `PUB-010` /service-areas ·
`PUB-011` /how-it-works · `PUB-012` / · `PUB-013` /sameday carry `"image": null`
and derive their design from the PUB-001 public family rather than from a
separate approved mock. Those six are not gaps.

## Authority — what a mock does and does not decide

The mock is authority for **visual design**: layout, photography, colour, type
scale, spacing, component shape, and which affordances appear on the screen.

The mock is **not** authority for **copy, numbers, claims or states**. Those
come from the authority chain, and where the two disagree the chain wins:

- PUB-001's mock headline reads *"Your customers order from you. Couranr handles
  delivery."* The shipped headline is *"Your customers want delivery. Now you can
  say yes."* — `02_DECISION_REGISTRY.json:2477` (`headline`), restated in
  `docs/couranr-mvp/MARKETING_POSITIONING_AND_HOMEPAGE_BLUEPRINT.md:145`. **Rank-1
  registry copy wins; the mock's visual design is adopted.**
- `9462C97D-6075` "Subscription & Plan" contradicts the PUB-001 constraint *"no
  … subscriptions"*. **Do not build it.**
- Mocks show illustrative metrics (`98.2% on-time`, `4.8 rating`). Nothing
  measures those and TRM-001/MKT-002 prohibit publishing them. Reproduce the
  *card shape*, never the *number*.
- Mocks are dated 2025 and show San Francisco / Austin addresses. Neither is a
  service area. Fixture text only.

## Registry screens → mock files

Primary mock first; later entries are approved variants or alternate states of
the same screen.

```json
{
  "PUB-001": [
    "0E4F029F-22C3-4497-A00F-E355DCB3164D.png",
    "5780C3C2-8EFC-4BDC-87AA-85CE667921D8.png",
    "22D9363D-248B-41C0-8C4F-2D38CB3BF3D3.png"
  ],
  "PUB-002": [
    "E3473C54-A4FF-41AD-BFF8-191C4F0F28AF.png"
  ],
  "PUB-003": [
    "77CC8223-1475-4C8E-A51B-E189F88AA261.png"
  ],
  "PUB-004": [],
  "PUB-005": [
    "04089370-CE60-45CA-9C07-00F2D06966EF.png",
    "719032FB-C2D3-42C8-A460-537DDA7733EE.png"
  ],
  "PUB-006": [
    "5D1A5F04-7525-43E6-9586-BA9187C1E171.png",
    "0013FABA-3A96-48F9-B71C-B4BB0F08E8B4.png"
  ],
  "PUB-007": [
    "7079F03E-DEEE-449B-881F-8ED05FEE524A.png"
  ],
  "PUB-008": [],
  "PUB-009": [],
  "PUB-010": [],
  "PUB-011": [],
  "PUB-012": [],
  "PUB-013": [],
  "MER-001": [
    "E7CE45F8-2C85-4256-93AC-48BCC7F95FD4.png",
    "D20A6432-D9BF-42C3-B65B-06954D771E37.png"
  ],
  "MER-002": [
    "E12C72B2-9DB9-427D-B47A-3021EBA56E85.png"
  ],
  "MER-003": [
    "F6BD39AA-E03A-4B31-9A7C-2DB765889B42.png"
  ],
  "MER-004": [
    "1691E20B-A9D7-45E8-AA68-D180D99D6FBC.png"
  ],
  "MER-005": [
    "69961CD8-3B66-4544-8053-8EAE1AD3BEE5.png",
    "B40D5F72-9A62-4737-B85D-9601DF0E7D2B.png"
  ],
  "MER-006": [
    "04DF2721-97D2-472C-A3F1-CB6047E5298B.png"
  ],
  "MER-007": [
    "05C42ED1-7AD9-4A55-88CB-7784FD8F52E5.png",
    "63B3950D-FC9E-4BB0-A896-F65EF4B03393.png"
  ],
  "MER-008": [],
  "MER-009": [
    "0392E7FD-E057-4C5D-9886-94D09DEB2CC8.png"
  ],
  "MER-010": [],
  "MER-011": [
    "DCFBA4C8-D2C7-4E7F-99D6-91B824D7EB89.png",
    "935A5590-C4F0-410C-860C-1498AB9062AA.png"
  ],
  "MER-012": [
    "76A4F41E-4C1E-4A75-8860-AB0A0AEFDD86.png"
  ],
  "MER-013": [
    "05AC4274-C24F-4D52-8E6A-76C9573E0429.png",
    "288BA2E3-B6CF-40DC-8442-9CD55BD87BF5.png",
    "4E254F81-3608-48FD-A6F1-2E529A2D42EA.png",
    "A2961811-7DB6-441A-A63D-FBCFA5603312.png"
  ],
  "MER-014": [
    "031480FD-EE0D-4371-9A71-DACFD0DF926F.png",
    "6C50B445-2B6B-4544-B84A-74E722F2B51C.png"
  ],
  "MER-015": [
    "CFC37EF0-ECF0-41FE-A7B4-BA35FC9DFC89.png",
    "838119C6-6DE5-4381-A4FC-A3AFE9839164.png"
  ],
  "MER-016": [
    "2EF4F6B4-803D-487A-846B-178DAEEE1957.png",
    "88802AA2-1520-405B-906C-0BDC02B64B5E.png"
  ],
  "DRV-001": [
    "3C8B6C70-5641-4041-97DC-FAF90344A1CC.png"
  ],
  "DRV-002": [],
  "DRV-003": [
    "253D4868-0724-4A5D-ADBC-583E80DFDA37.png"
  ],
  "DRV-004": [
    "7C2BDE48-4216-43BA-8F10-10D8609855BF.png"
  ],
  "DRV-005": [
    "B2866999-DA54-447B-A056-B3B0D89AEFCE.png"
  ],
  "DRV-006": [
    "62765A9A-D258-43EB-8B59-144E493F7854.png"
  ],
  "DRV-007": [
    "E1C020D4-EDA9-476A-A83B-542FB054F902.png"
  ],
  "DRV-008": [
    "15101AAC-958E-4712-9FA6-5DDB8E6422A4.png"
  ],
  "DRV-009": [
    "0097C629-46A9-4341-9C6E-F66DDA9F3929.png",
    "B1037D75-E40A-4DF1-896F-68E9426AB6AE.png"
  ],
  "DRV-010": [
    "84D76CDC-2678-4033-AB16-315923E38126.png"
  ],
  "OPS-001": [],
  "OPS-002": [
    "71149E76-4674-441D-A490-D868FC2E0724.png",
    "5CF6F81A-C1E3-4F69-B04E-C89552AE336B.png"
  ],
  "OPS-003": [
    "FE8171A0-DCFC-4C17-8FDD-8BE16A0AB4BC.png"
  ],
  "OPS-004": [
    "14B61228-795E-4BE9-9E23-F45DB9BB7A73.png"
  ],
  "OPS-005": [
    "892BDA6D-1BD9-4EDA-AD2B-8E9BDD07B5F3.png"
  ],
  "OPS-006": [
    "B3F68382-797C-4AFB-B539-5A65C26F8853.png"
  ],
  "OPS-007": [
    "6A18B250-C883-41B6-8281-A426BE1CD45C.png"
  ],
  "OPS-008": [],
  "OPS-009": [
    "D0713863-D737-426F-AC13-EDB791475D2D.png"
  ],
  "OPS-010": [
    "8E9685FE-86A0-426A-B613-EF0510DEFA44.png"
  ],
  "OPS-011": [
    "09A95BF3-BDCB-4942-B03C-85E586CC5236.png"
  ],
  "OPS-012": [
    "FBE79206-956C-436E-B4C7-3B15BCB664F2.png",
    "6519CBA3-8AAA-45AB-941B-01B842703529.png"
  ],
  "OPS-013": [],
  "OPS-014": [],
  "OPS-015": [],
  "OPS-016": [],
  "OPS-017": [
    "35621D0A-5CD3-468F-8532-9C32C5F3CBCF.png"
  ],
  "OPS-018": [
    "B1C34AC0-0B14-4A55-AE2D-0F3233EC6D71.png"
  ],
  "OPS-019": [
    "1E706B14-7209-47E6-A7E7-6C70F1958AAC.png"
  ],
  "OPS-020": [
    "E2947AC0-485C-4C1D-ADDB-F18B8148DBA0.png"
  ],
  "OPS-021": [],
  "CUS-001": [
    "6C497840-4A07-46CC-B5F3-49D8E32885BF.png",
    "EB2D3712-19D9-4611-A801-575DCA894C0F.png"
  ],
  "CUS-002": [
    "B9EA1FCA-CEF2-4577-900F-EB6315DA5018.png"
  ],
  "CUS-003": [
    "7945BB0F-4051-4FB3-A900-DCF95F1BD7BE.png"
  ],
  "CUS-004": [
    "2905409D-3BD4-47CA-AE53-093BB3B3E21D.png"
  ],
  "CUS-005": [
    "74EAB167-FDAE-477C-896A-A64B59BC8A1C.png"
  ],
  "CUS-006": [
    "95A1E901-A1E9-4513-94EA-1E1DA97192E4.png",
    "BFAD28C4-1596-43D8-A9DD-233A6254127D.png"
  ],
  "CUS-007": [
    "7E90D5F2-A71E-479A-A33F-D4E8D7F8801B.png"
  ],
  "CUS-008": []
}
```

> The filenames above are the on-disk UUIDs. Resolve any of them with
> `ls <first-13-chars>*` — the leading 13 characters are unique across all 91
> files. A round-trip check is in `scripts/checkMockMap.mjs`.

## Photography assets (not screens)

Two root PNGs are photographs, not UI. Both depict the same brand scene — a
merchant handing a Couranr-branded parcel to a Couranr driver — and both are
PUB-001 hero candidates.

| File | Size | Use |
|---|---|---|
| `0C5CBF3B-0280-4DBB-AAB2-ECDD0020A927.png` | 1672×941 | PUB-001 desktop hero (florist, matches the landing mock) |
| `44B6E1FB-2987-4067-896A-28A7D33C5518.png` | 1122×1402 | PUB-001 portrait / mobile hero crop |

## Brand sheet

`258F4C57-12C2-493B-AC91-5DA3C6BA4F66.png` is the brand sheet, and it is the
source of the design tokens already in `app/(couranr)/couranr.css`. Verified
identical, token by token:

| Brand sheet | Token | Value |
|---|---|---|
| navy | `--couranr-navy` | `#0D1525` |
| gold | `--couranr-gold` | `#F4B740` |
| route blue | `--couranr-route-blue` | `#2563EB` |
| success green | `--couranr-success` | `#15803D` |
| muted text | `--couranr-text-muted` | `#667085` |
| border | `--couranr-border` | `#E3E7ED` |
| Inter / Geist Sans | `--couranr-font-sans` | `"Geist Sans", "Inter", …` |

The logo variations (primary, reverse, monochrome) and the app mark already ship
as SVG in `public/brand/`.

## Screens the mocks show that the registry does not list

Twenty mocks depict screens outside the 66. They are **not** scope — the
registry is authority for what MVP contains — but they are evidence of intended
direction, and several are obvious post-MVP candidates.

`092B02CA-A2C2` merchant analytics · `16F8151E-A68F` customer notifications
centre · `22880AE9-E81D` merchant automations · `247F06F8-6510` merchant address
book · `52425ED7-2599` route-saver builder · `5BCD7347-3BE8` bulk deliveries ·
`6151A578-6D49` customer account settings · `6E0604B6-2035` merchant reports &
export · `893ADB20-A68F` merchant availability schedule · `8F373006-B293` driver
performance · `928D4C69-7E43` driver incentives · `9462C97D-6075` subscription &
plan **(excluded — contradicts PUB-001 constraints)** · `AC913246-AF03` merchant
notifications · `ACAACA6C-E833` driver earnings & payouts · `DD95F198-DB2D` API &
integrations · `E7FD20C6-1022` merchant exceptions & resolutions ·
`F29A17AA-702A` SLA & coverage map · `F2C4E383-F047` customer dashboard ·
`FE00B26E-7137` driver documents & compliance · plus the two hero photographs.

## Registry screens with no mock

Twelve, excluding the six that are `image: null` by design:

`PUB-004` /send, /estimate and /request/[merchantSlug] · `MER-008`
/app/business/customers · `MER-010` /app/business/presets · `DRV-002`
/driver/deliveries/[id] · `OPS-001` /operations · `OPS-008` /operations/vehicles
· `OPS-013` /operations/analytics · `OPS-014`
/operations/analytics?tab=unmet-demand · `OPS-015` /operations/settings ·
`OPS-016` /operations/settings?tab=availability · `OPS-021`
/operations/ghost?tab=leads · `CUS-008` /track/[token]#access.

Each of these has a close visual relative among the mocks (the merchant
customers list is `MER-009`'s parent view; `OPS-013` can follow the merchant
analytics mock's layout; `OPS-016` can follow the merchant availability mock).
Build them from the nearest same-surface mock plus the registry's declared
states — and say which mock was used.
