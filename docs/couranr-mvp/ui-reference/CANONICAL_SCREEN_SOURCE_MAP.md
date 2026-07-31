# Canonical screen → source image map

Maps each of the 91 root PNGs to the canonical screen it depicts.

**Why this file exists.** `UI_SCREEN_REGISTRY.md` references
`canonical-mvp-images/**` 124 times and **zero of those files have ever been
committed** — the extraction workflow that was to produce them from
`Couranr_Canonical_MVP_UI_Package.zip` failed on both of its runs on 2026-07-30,
and `.upload-status` still reads "Canonical image upload pending binary commit".
The mocks themselves survived as the 91 UUID-named PNGs at the repo root, but
nothing connected them to screen ids. This file is that connection.

**This mapping was built by opening all 91 images.** It is non-destructive: no
PNG is renamed, moved, converted or deleted. The existing
`materialize-canonical-ui-images` workflow ends with `-delete` on every
UUID-named root PNG and must still never be run.

## Coverage: 50 of 66 screens

- 69 images map to a canonical screen (several screens have desktop + mobile or state variants)
- 19 images depict surfaces with **no screen id in the registry**
- 3 are brand assets, not screens
- **16 canonical screens have no mock at all**

## Screens with a mock

| Screen | Name | Source PNG | Variant |
|---|---|---|---|
| CUS-001 | Address-change request | `6C497840-4A07-46CC-B5F3-49D8E32885BF.png` | desktop |
|  |  | `EB2D3712-19D9-4611-A801-575DCA894C0F.png` | duplicate of 41 |
| CUS-002 | Cancellation and return request | `B9EA1FCA-CEF2-4577-900F-EB6315DA5018.png` | desktop |
| CUS-003 | Recipient unavailable resolution | `7945BB0F-4051-4FB3-A900-DCF95F1BD7BE.png` | desktop |
| CUS-004 | Delivery problem report | `2905409D-3BD4-47CA-AE53-093BB3B3E21D.png` | desktop |
| CUS-005 | Revised quote approval | `74EAB167-FDAE-477C-896A-A64B59BC8A1C.png` | desktop |
| CUS-006 | Proof-of-delivery viewer | `95A1E901-A1E9-4513-94EA-1E1DA97192E4.png` | desktop |
| CUS-007 | Return and refund status | `7E90D5F2-A71E-479A-A33F-D4E8D7F8801B.png` | desktop |
| DRV-001 | Driver dashboard | `3C8B6C70-5641-4041-97DC-FAF90344A1CC.png` | mobile |
| DRV-003 | Pickup PIN and proof | `253D4868-0724-4A5D-ADBC-583E80DFDA37.png` | mobile |
| DRV-004 | Package discrepancy | `7C2BDE48-4216-43BA-8F10-10D8609855BF.png` | mobile |
| DRV-005 | Driving Mode | `B2866999-DA54-447B-A056-B3B0D89AEFCE.png` | mobile |
| DRV-006 | Drop-off proof | `62765A9A-D258-43EB-8B59-144E493F7854.png` | mobile |
| DRV-007 | Offline proof sync | `E1C020D4-EDA9-476A-A83B-542FB054F902.png` | mobile |
| DRV-008 | Driver messages | `15101AAC-958E-4712-9FA6-5DDB8E6422A4.png` | mobile |
| DRV-009 | Driver availability | `0097C629-46A9-4341-9C6E-F66DDA9F3929.png` | mobile |
|  |  | `B1037D75-E40A-4DF1-896F-68E9426AB6AE.png` | desktop variant |
| DRV-010 | Vehicle profile | `84D76CDC-2678-4033-AB16-315923E38126.png` | mobile |
| MER-001 | Merchant dashboard | `D20A6432-D9BF-42C3-B65B-06954D771E37.png` | mobile |
|  |  | `E7CE45F8-2C85-4256-93AC-48BCC7F95FD4.png` | desktop |
| MER-002 | Merchant onboarding | `E12C72B2-9DB9-427D-B47A-3021EBA56E85.png` | desktop |
| MER-003 | Live activation checklist | `F6BD39AA-E03A-4B31-9A7C-2DB765889B42.png` | desktop |
| MER-004 | Deliveries list | `1691E20B-A9D7-45E8-AA68-D180D99D6FBC.png` | desktop |
| MER-005 | Create delivery with Smart Intake | `69961CD8-3B66-4544-8053-8EAE1AD3BEE5.png` | desktop |
|  |  | `B40D5F72-9A62-4737-B85D-9601DF0E7D2B.png` | variant B |
| MER-006 | Delivery review and quote | `04DF2721-97D2-472C-A3F1-CB6047E5298B.png` | desktop |
| MER-007 | Delivery detail | `05C42ED1-7AD9-4A55-88CB-7784FD8F52E5.png` | desktop |
|  |  | `63B3950D-FC9E-4BB0-A896-F65EF4B03393.png` | variant B |
|  |  | `BFAD28C4-1596-43D8-A9DD-233A6254127D.png` | variant C - merchant proof viewer |
| MER-009 | Customer detail | `0392E7FD-E057-4C5D-9886-94D09DEB2CC8.png` | desktop |
| MER-011 | Preset builder | `935A5590-C4F0-410C-860C-1498AB9062AA.png` | desktop |
|  |  | `DCFBA4C8-D2C7-4E7F-99D6-91B824D7EB89.png` | variant B |
| MER-012 | Merchant messages and support | `76A4F41E-4C1E-4A75-8860-AB0A0AEFDD86.png` | desktop |
| MER-013 | Website tools | `05AC4274-C24F-4D52-8E6A-76C9573E0429.png` | desktop |
|  |  | `288BA2E3-B6CF-40DC-8442-9CD55BD87BF5.png` | variant B |
|  |  | `4E254F81-3608-48FD-A6F1-2E529A2D42EA.png` | variant C |
|  |  | `A2961811-7DB6-441A-A63D-FBCFA5603312.png` | variant D |
| MER-014 | Merchant settings | `031480FD-EE0D-4371-9A71-DACFD0DF926F.png` | desktop |
|  |  | `6C50B445-2B6B-4544-B84A-74E722F2B51C.png` | variant B |
| MER-015 | Team and permissions | `838119C6-6DE5-4381-A4FC-A3AFE9839164.png` | desktop |
|  |  | `CFC37EF0-ECF0-41FE-A7B4-BA35FC9DFC89.png` | variant B |
| MER-016 | Billing settings | `2EF4F6B4-803D-487A-846B-178DAEEE1957.png` | desktop |
|  |  | `88802AA2-1520-405B-906C-0BDC02B64B5E.png` | variant B |
| OPS-002 | Queue and managed dispatch | `5CF6F81A-C1E3-4F69-B04E-C89552AE336B.png` | desktop |
|  |  | `71149E76-4674-441D-A490-D868FC2E0724.png` | variant B - shows Confirm as quoted / Request info / Requote / Decline |
| OPS-003 | Delivery review workspace | `FE8171A0-DCFC-4C17-8FDD-8BE16A0AB4BC.png` | desktop - Approve quote / Send revised quote / Assign vehicle |
| OPS-004 | Requote and promotional credit | `14B61228-795E-4BE9-9E23-F45DB9BB7A73.png` | desktop |
| OPS-006 | Couranr Ghost Operations | `892BDA6D-1BD9-4EDA-AD2B-8E9BDD07B5F3.png` | AMBIGUOUS - rendered in a merchant shell |
|  |  | `B3F68382-797C-4AFB-B539-5A65C26F8853.png` | desktop |
| OPS-007 | Merchant management | `6A18B250-C883-41B6-8281-A426BE1CD45C.png` | desktop |
| OPS-009 | Payments and reconciliation | `D0713863-D737-426F-AC13-EDB791475D2D.png` | desktop |
| OPS-010 | Payment authorization review | `8E9685FE-86A0-426A-B613-EF0510DEFA44.png` | desktop |
| OPS-011 | Refund management | `09A95BF3-BDCB-4942-B03C-85E586CC5236.png` | desktop |
| OPS-012 | Incidents and claims | `6519CBA3-8AAA-45AB-941B-01B842703529.png` | desktop |
|  |  | `FBE79206-956C-436E-B4C7-3B15BCB664F2.png` | variant B |
| OPS-017 | Policy and pricing registry | `35621D0A-5CD3-468F-8532-9C32C5F3CBCF.png` | desktop |
| OPS-018 | Notification template manager | `B1C34AC0-0B14-4A55-AE2D-0F3233EC6D71.png` | desktop |
| OPS-019 | Ghost auto-reply controls and kill switches | `1E706B14-7209-47E6-A7E7-6C70F1958AAC.png` | desktop |
| OPS-020 | Activity and audit log | `E2947AC0-485C-4C1D-ADDB-F18B8148DBA0.png` | desktop |
| PUB-001 | Marketing homepage | `0E4F029F-22C3-4497-A00F-E355DCB3164D.png` | desktop |
|  |  | `22D9363D-248B-41C0-8C4F-2D38CB3BF3D3.png` | mobile |
| PUB-002 | Sign in | `E3473C54-A4FF-41AD-BFF8-191C4F0F28AF.png` | desktop |
| PUB-003 | Business sign up | `77CC8223-1475-4C8E-A51B-E189F88AA261.png` | desktop |
| PUB-005 | Secure delivery payment | `04089370-CE60-45CA-9C07-00F2D06966EF.png` | desktop |
|  |  | `719032FB-C2D3-42C8-A460-537DDA7733EE.png` | variant B |
| PUB-006 | Secure live tracking | `0013FABA-3A96-48F9-B71C-B4BB0F08E8B4.png` | desktop |
|  |  | `5D1A5F04-7525-43E6-9586-BA9187C1E171.png` | variant B |
| PUB-007 | Delivery Help | `7079F03E-DEEE-449B-881F-8ED05FEE524A.png` | desktop |
| PUB-009 | Businesses page | `5780C3C2-8EFC-4BDC-87AA-85CE667921D8.png` | desktop, long-form |

## Screens with NO mock — design still missing

| Screen | Name |
|---|---|
| PUB-004 | Delivery estimate and hosted request |
| PUB-008 | Pricing page |
| PUB-010 | Service areas page |
| PUB-011 | How Couranr works |
| MER-008 | Customers list |
| MER-010 | Presets list |
| DRV-002 | Assigned delivery detail |
| OPS-001 | Operations dashboard |
| OPS-005 | Operations messages and support inbox |
| OPS-008 | Vehicle management |
| OPS-013 | Operations analytics |
| OPS-014 | Unmet demand analytics |
| OPS-015 | Operations settings |
| OPS-016 | Availability controls |
| OPS-021 | Ask Couranr lead inbox |
| CUS-008 | Delivery preferences and access instructions |

## Out-of-registry mocks

Designed surfaces with no screen id. Each is either a genuine registry gap or
out of scope — **an owner decision, not a mapping decision.** They are recorded
rather than discarded so nothing is silently lost.

| Slug | Title | Note |
|---|---|---|
| `merchant-analytics` | Merchant Analytics | no MER analytics screen in registry |
| `notifications-center` | Notifications Center | customer-facing; not in registry |
| `merchant-automations` | Automations | not in registry |
| `address-book` | Address Book & Locations | not in registry |
| `route-saver-builder` | Route Saver Builder | Route Saver named in spec S9; no screen id |
| `bulk-deliveries` | Bulk Deliveries | not in registry |
| `customer-account-settings` | Account Settings | customer account; CUS screens are token-scoped |
| `reports-export` | Reports & Export | not in registry |
| `merchant-availability-schedule` | Availability Schedule | merchant-scoped; OPS-016 is the operations one |
| `driver-performance` | Driver Performance | not in registry |
| `driver-incentives` | Driver Incentives & Rewards | not in registry |
| `subscription-plan` | Subscription & Plan | EXCLUDED - spec: no subscription controls in pilot |
| `merchant-notifications` | Notifications | not in registry |
| `driver-earnings` | Earnings & Payouts | not in registry |
| `api-integrations` | API & Integrations | not in registry |
| `exceptions-resolutions` | Exceptions & resolutions | not in registry |
| `sla-coverage-map` | SLA & Coverage Map | not in registry |
| `customer-deliveries-home` | Customer deliveries home | not in registry |
| `driver-documents` | Driver Documents & Compliance | not in registry |

## Brand assets

| Slug | Source PNG | Note |
|---|---|---|
| `photo-storefront-handoff` | `0C5CBF3B-0280-4DBB-AAB2-ECDD0020A927.png` | not a screen |
| `logo-and-palette` | `258F4C57-12C2-493B-AC91-5DA3C6BA4F66.png` | DESIGN AUTHORITY - not a screen |
| `photo-storefront-handoff-2` | `44B6E1FB-2987-4067-896A-28A7D33C5518.png` | not a screen |

`logo-and-palette` is the design authority for colour and type:
`#0D1525` navy, `#F4B740` gold, `#2563EB` blue, `#15803D` green, `#667085` grey,
`#E3E7ED` border; Inter / Geist Sans.

