#!/usr/bin/env node
/**
 * `npm run check:visual-registry` — validates
 * docs/couranr-mvp/ui-reference/VISUAL_AUTHORITY_REGISTRY.json.
 * `--write` regenerates it from disk.
 *
 * §25 requires this registry and, more importantly, requires that its
 * dimensions be MEASURED:
 *
 *   "The registry generator must inspect the actual image file and write
 *    numeric width/height values. No width or height from this specification
 *    may be copied into the generated registry."
 *
 * That rule exists because v2.1's own example got PUB-001 wrong — it printed
 * 1448×1086, the size shared by 56 other exports, for a screen whose three
 * artboards are 1055×1491 and 941×1672. So this script never accepts a
 * dimension as input. It reads the PNG IHDR header itself, and the validator
 * re-reads every file and fails on any mismatch.
 *
 * Scope is deliberately narrow. §34.1 defers the remaining 65 screens until
 * after PUB-001 is approved; only the proving surface and the photography it
 * actually uses are non-deferrable, so only those are recorded. The validator
 * reports the gap rather than pretending the registry is complete.
 *
 * `--positive-control` corrupts a dimension in memory and fails if the
 * validator does not catch it.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { governedPages, specRows } from "./compositionContract.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "docs/couranr-mvp/ui-reference/VISUAL_AUTHORITY_REGISTRY.json";
const MAP = "docs/couranr-mvp/MOCK_TO_SCREEN_MAP.md";
const SCREENS = "UI_SCREEN_REGISTRY.md";

/** Which family a screen id belongs to, and that family's golden screen (§29). */
const FAMILY = {
  PUB: { family: "public_marketing", golden: "PUB-001" },
  MER: { family: "merchant", golden: "MER-001" },
  OPS: { family: "operations", golden: "OPS-002" },
  DRV: { family: "driver", golden: "DRV-001" },
  CUS: { family: "customer_token", golden: "CUS-006" },
};

/**
 * The canonical screen table, read from UI_SCREEN_REGISTRY.md.
 *
 * Route and viewport intent come from the registry rather than being typed
 * here — §25 says one visual-authority record per REGISTERED screen, so the
 * registry is what decides which screens exist.
 */
function registeredScreens() {
  const doc = readFileSync(join(repo, SCREENS), "utf8");
  const rows = doc
    .split("\n")
    .filter((l) => /^\|\s*(PUB|MER|DRV|OPS|CUS)-\d+\s*\|/.test(l))
    .map((l) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  if (!rows.length) throw new Error(`${SCREENS}: no screen rows parsed`);
  return rows.map((c) => ({
    screen_id: c[0],
    name: c[1],
    route: c[2].replace(/`/g, ""),
    viewport_intent: (c[5] || "responsive").toLowerCase(),
  }));
}
const SPEC = "docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md";

/** Reads width/height from a PNG's IHDR. No decoding, no dependency. */
function pngSize(file) {
  const fd = readFileSync(join(repo, file));
  if (fd.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} is not a PNG`);
  return { width: fd.readUInt32BE(16), height: fd.readUInt32BE(20) };
}

/**
 * PUB-001's composition regions, PARSED from §27.0's normative table.
 *
 * This list used to be transcribed here with a comment saying §27.0 was the
 * only source for it. It was not: when MKT-003 added `delivery-options` to the
 * table, `--write` regenerated the file with the stale twelve and the validator
 * reported "validated". A transcription that claims to be a derivation is worse
 * than an obvious duplicate, because the comment is what stops anyone checking.
 *
 * `navigation` is prepended because the artboard has a navigation band that the
 * shell renders and that carries no `data-couranr-section` — §27.0 says so
 * explicitly, and it is the one region that is deliberately not on the table.
 *
 * Takes a screen id since V3: §27.1 governs four more pages, and each has its
 * own table.
 */
function compositionRegions(screen) {
  const doc = readFileSync(join(repo, SPEC), "utf8");
  const page = governedPages(doc).find((p) => p.screen === screen);
  if (!page) throw new Error(`${SPEC}: ${screen} is not a governed page`);
  return ["navigation", ...specRows(doc, page).map((r) => r.id)];
}

function mockMap() {
  const doc = readFileSync(join(repo, MAP), "utf8");
  const fence = doc.match(/```json\n([\s\S]*?)\n```/);
  if (!fence) throw new Error(`${MAP}: no json block`);
  return JSON.parse(fence[1]);
}

/**
 * PUB-001's record, plus the photography PUB-001 actually renders. §21.2's
 * shape for the assets; §25's for the screen.
 */
/**
 * The four §27.1 family pages. Declared here rather than derived from the spec
 * index so that adding a page to §27.1 without giving it a visual-authority
 * record is a visible omission rather than a silent one — the validator below
 * reports any governed page missing from this registry.
 */
const GOVERNED_PAGES = new Set(
  governedPages(readFileSync(join(repo, SPEC), "utf8")).map((p) => p.screen),
);

const DERIVED = [
  { screen_id: "PUB-008", route: "/pricing" },
  { screen_id: "PUB-009", route: "/businesses" },
  { screen_id: "PUB-010", route: "/service-areas" },
  { screen_id: "PUB-011", route: "/how-it-works" },
];

/**
 * Every registered screen's visual-authority record.
 *
 * §25: "one visual-authority record per registered screen" and "all canonical
 * screens have a visual authority record by the time the full registry phase is
 * complete". §34.1 allowed the other 65 to be deferred until PUB-001 was
 * approved; this completes them.
 *
 * The hard part is ROLES, and the honest answer is to refuse to guess.
 * PUB-001's three artboards have declared roles because they were opened and
 * identified — two of them are the same 941x1672 and an orientation heuristic
 * got them backwards once already. For the other 65 nobody has done that, so:
 *
 *   - ONE mapped source  -> role "primary". Unambiguous: there is nothing else
 *     it could be, and §25 permits marking a primary when the empirical map
 *     supports the choice.
 *   - TWO OR MORE        -> every source gets role "unclassified" and
 *     `mobile_reference` stays null. §25 says to "mark one primary only when
 *     the current empirical map/authority supports that choice", and with two
 *     undifferentiated exports it does not. A guessed primary would be a wrong
 *     fact in a registry other work is meant to trust, which is the exact
 *     failure the PUB-001 comment above records.
 *
 * Screens with no mapped source at all are `derived` from their family's golden
 * screen (§29's table), which §25 requires to be named explicitly.
 *
 * Dimensions are read from every file's PNG header. None is copied from
 * anywhere.
 */
function buildScreens(pub001Measured, pub001Mobile) {
  const map = mockMap();
  const out = [];

  for (const screen of registeredScreens()) {
    const fam = FAMILY[screen.screen_id.slice(0, 3)];
    if (!fam) throw new Error(`${screen.screen_id}: unknown surface family prefix`);

    // PUB-001 keeps its hand-declared roles and its Gate A record.
    if (screen.screen_id === "PUB-001") {
      out.push({
        screen_id: "PUB-001",
        surface_family: fam.family,
        route: screen.route,
        canonical_sources: pub001Measured.map((m) => ({
          path: m.path,
          role: m.role,
          width_px: m.width,
          height_px: m.height,
          source_kind: "design_artboard",
        })),
        registry_declared_viewport_intent: screen.viewport_intent,
        visual_authority: "canonical",
        composition_regions: compositionRegions("PUB-001"),
        mobile_reference: pub001Mobile?.path ?? null,
        gate_a_review: "docs/couranr-mvp/brand/PUB-001_GATE_A_REGION_REVIEW.md",
        notes: [
          "The artboards are design exports, not browser screenshots. §26's " +
            "pixel-diff policy therefore does not apply; Gate A is a named-region " +
            "review and Gate B verifies real browser widths separately.",
          "Gate A recorded six intentional deviations, two of which close when " +
            "the photography in PUB-001_PHOTOGRAPHY_BRIEF.md exists.",
        ],
      });
      continue;
    }

    const sources = map[screen.screen_id] ?? [];
    const governed = GOVERNED_PAGES.has(screen.screen_id);

    if (sources.length === 0) {
      out.push({
        screen_id: screen.screen_id,
        surface_family: fam.family,
        route: screen.route,
        canonical_sources: [],
        registry_declared_viewport_intent: screen.viewport_intent,
        visual_authority: "derived",
        derived_from: { screen_id: fam.golden, family: fam.family },
        derivation_basis:
          "MOCK_TO_SCREEN_MAP.md maps no canonical source to this screen, so " +
          "§26's Gate A has nothing to compare against. It inherits its family " +
          "grammar from the golden screen named above (§29).",
        ...(governed ? { composition_regions: compositionRegions(screen.screen_id) } : {}),
        mobile_reference: null,
        ...(governed
          ? { gate_a_review: "docs/couranr-mvp/brand/PUB-FAMILY_V3_REVIEW.md" }
          : {}),
        notes: governed
          ? [
              "Composition table and budgets: §27.1 of COURANR_VISUAL_SYSTEM_V2_2.md.",
              "Gate B and Gate C run normally — they need a browser, not a mock.",
            ]
          : ["No Gate A review has been performed for this screen."],
      });
      continue;
    }

    const single = sources.length === 1;
    out.push({
      screen_id: screen.screen_id,
      surface_family: fam.family,
      route: screen.route,
      canonical_sources: sources.map((path) => ({
        path,
        role: single ? "primary" : "unclassified",
        ...(() => {
          const { width, height } = pngSize(path);
          return { width_px: width, height_px: height };
        })(),
        source_kind: "design_artboard",
      })),
      registry_declared_viewport_intent: screen.viewport_intent,
      visual_authority: "canonical",
      mobile_reference: null,
      notes: single
        ? ["No Gate A review has been performed for this screen."]
        : [
            `${sources.length} mapped sources with no declared roles. §25 permits ` +
              "marking a primary only when the empirical map supports the choice, " +
              "and it does not here — open them, identify each, and declare the " +
              "roles rather than inferring them from dimensions.",
            "No Gate A review has been performed for this screen.",
          ],
    });
  }

  return out;
}

function build() {
  const map = mockMap();
  const sources = map["PUB-001"];
  if (!sources?.length) throw new Error("PUB-001 has no mapped sources in the mock map");

  /*
   * Roles cannot be inferred from dimensions, and the first version of this
   * generator tried. Two of PUB-001's three artboards are both 941×1672: one
   * is the FULL DESKTOP PAGE exported as a long scroll, the other is the
   * mobile composition. An orientation heuristic labelled the desktop scroll
   * "mobile" and made it the mobile_reference — a wrong fact in a registry
   * other work is meant to trust.
   *
   * A tall aspect means "this export is long", not "this design is for a
   * phone". So roles are declared from what the artboards were identified as
   * when they were opened, and the declaration is checked against the mock map
   * rather than guessed from the pixels.
   */
  const ROLES = {
    "0E4F029F": "primary",       // desktop, upper page
    "5780C3C2": "full-scroll",   // desktop, whole page exported long
    "22D9363D": "mobile",
  };
  const measured = sources.map((path) => {
    const role = ROLES[path.slice(0, 8)];
    if (!role) {
      throw new Error(
        `${path} has no declared role. Open it, identify it, and add it to ROLES — ` +
          `do not infer a role from its dimensions.`,
      );
    }
    return { path, role, ...pngSize(path) };
  });
  const primary = measured.find((m) => m.role === "primary") ?? measured[0];
  const mobile = measured.find((m) => m.role === "mobile") ?? null;

  return {
    $comment:
      "Generated by scripts/visualAuthorityRegistry.mjs. Every width_px and " +
      "height_px is read from the file's PNG header — §25 forbids copying a " +
      "dimension from any specification. Run `npm run check:visual-registry` " +
      "to re-verify, `-- --write` to regenerate.",
    generator: "scripts/visualAuthorityRegistry.mjs",
    scope:
      "Every registered screen in UI_SCREEN_REGISTRY.md, plus the photography " +
      "PUB-001 renders. Screens with no mapped canonical source are recorded as " +
      "derived from their family's golden screen (§29). A record's presence " +
      "means its sources and dimensions are known — NOT that Gate A has been " +
      "run on it; each record's notes say which.",
    screens: buildScreens(measured, mobile),
    photography: [
      {
        asset_id: "photo-florist-driver-handoff-wide",
        local_path: "public/images/pub-001-hero-wide-1600.webp",
        derived_from: "0C5CBF3B-0280-4DBB-AAB2-ECDD0020A927.png",
        source: "existing-repo",
        source_reference: "Supplied with the original design set; no external provenance recorded.",
        license_record: "Owner-supplied. No third-party licence on file.",
        subject: "A florist hands a Couranr-branded parcel to a Couranr driver outside her shop",
        allowed_surfaces: ["PUB-001"],
        desktop_focal_point: "62% 50%",
        mobile_focal_point: null,
        preferred_aspect: "16:9",
        status: "approved",
      },
      {
        asset_id: "photo-florist-driver-handoff-portrait",
        local_path: "public/images/pub-001-hero-portrait-900.webp",
        derived_from: "44B6E1FB-2987-4067-896A-28A7D33C5518.png",
        source: "existing-repo",
        source_reference: "Supplied with the original design set; no external provenance recorded.",
        license_record: "Owner-supplied. No third-party licence on file.",
        subject: "The same handoff, framed portrait for narrow viewports",
        allowed_surfaces: ["PUB-001"],
        desktop_focal_point: null,
        mobile_focal_point: "center 32%",
        preferred_aspect: "3:4",
        status: "approved",
      },
      /* ── the owner-accepted 2026-08-28 marketing set ──────────────────────
         Eleven frames, transcribed from the handoff package's
         ASSET_PROVENANCE.json. They are recorded HERE, in the generator, and
         not in the JSON it writes: REPO_AUTHORITY_AMENDMENTS.md §4 says not to
         hand-edit generated output, and `validate()` below checks that every
         `local_path` and `derived_from` exists on disk, so a row for a file
         that was never installed fails the gate.

         `local_path` is the WIDEST derivative each asset actually serves;
         `derived_from` is the unmodified accepted source. Two carry
         `allowed_surfaces: []` and `status: "approved-reserve"` — they are
         accepted and deliberately unused by the website batch, which is a
         decision worth recording rather than an omission worth discovering. */
      {
        "asset_id": "couranr-mkt-2026-08-florist",
        "local_path": "public/images/marketing/2026-08/w/mkt-2026-08-florist-wide-800.webp",
        "derived_from": "public/images/marketing/2026-08/01-florist.png",
        "source": "generated-openai-chatgpt-2026-08",
        "source_reference": "Generated with OpenAI image generation in ChatGPT; owner-accepted on 2026-08-28",
        "license_record": "Generated asset; no third-party stock source or external stock license. Preserve generation provenance and follow applicable OpenAI terms.",
        "subject": "Florist selecting stems in a bright independent flower shop",
        "alt": "Florist selecting stems from a wall of flowers in a local shop.",
        "allowed_surfaces": [
          "PUB-001"
        ],
        "desktop_focal_point": "31% 40%",
        "mobile_focal_point": "31% 40%",
        "focal_point_note":
          "The handoff record gives 31% 46%. The crop uses y=40%: at 46% the 3:2 window cut the florist's raised hand. See scripts/buildMarketingImages.mjs.",
        "preferred_aspect": "3:2",
        "status": "approved"
      },
      {
        "asset_id": "couranr-mkt-2026-08-bakery",
        "local_path": "public/images/marketing/2026-08/w/mkt-2026-08-bakery-wide-800.webp",
        "derived_from": "public/images/marketing/2026-08/02-bakery.png",
        "source": "generated-openai-chatgpt-2026-08",
        "source_reference": "Generated with OpenAI image generation in ChatGPT; owner-accepted on 2026-08-28",
        "license_record": "Generated asset; no third-party stock source or external stock license. Preserve generation provenance and follow applicable OpenAI terms.",
        "subject": "Baker pulling fresh loaves from a commercial oven",
        "alt": "Baker removing fresh bread from an oven in a neighborhood bakery.",
        "allowed_surfaces": [
          "PUB-009"
        ],
        "desktop_focal_point": "53% 46%",
        "mobile_focal_point": "53% 46%",
        "preferred_aspect": "3:2",
        "status": "approved"
      },
      {
        "asset_id": "couranr-mkt-2026-08-boutique",
        "local_path": "public/images/marketing/2026-08/w/mkt-2026-08-boutique-wide-800.webp",
        "derived_from": "public/images/marketing/2026-08/03-boutique.png",
        "source": "generated-openai-chatgpt-2026-08",
        "source_reference": "Generated with OpenAI image generation in ChatGPT; owner-accepted on 2026-08-28",
        "license_record": "Generated asset; no third-party stock source or external stock license. Preserve generation provenance and follow applicable OpenAI terms.",
        "subject": "Older boutique owner helping a customer compare clothing",
        "alt": "Boutique owner helping a customer compare clothing in a local shop.",
        "allowed_surfaces": [
          "PUB-001"
        ],
        "desktop_focal_point": "69% 47%",
        "mobile_focal_point": "69% 47%",
        "preferred_aspect": "3:2",
        "status": "approved"
      },
      {
        "asset_id": "couranr-mkt-2026-08-hardware",
        "local_path": "public/images/marketing/2026-08/w/mkt-2026-08-hardware-wide-800.webp",
        "derived_from": "public/images/marketing/2026-08/04-hardware.png",
        "source": "generated-openai-chatgpt-2026-08",
        "source_reference": "Generated with OpenAI image generation in ChatGPT; owner-accepted on 2026-08-28",
        "license_record": "Generated asset; no third-party stock source or external stock license. Preserve generation provenance and follow applicable OpenAI terms.",
        "subject": "Hardware-store worker retrieving stock from a high shelf",
        "alt": "Worker reaching for merchandise on a high shelf in a neighborhood hardware store.",
        "allowed_surfaces": [
          "PUB-001"
        ],
        "desktop_focal_point": "56% 42%",
        "mobile_focal_point": "56% 42%",
        "preferred_aspect": "3:2",
        "status": "approved"
      },
      {
        "asset_id": "couranr-mkt-2026-08-print-sign",
        "local_path": "public/images/marketing/2026-08/w/mkt-2026-08-print-sign-wide-800.webp",
        "derived_from": "public/images/marketing/2026-08/05-print-sign.png",
        "source": "generated-openai-chatgpt-2026-08",
        "source_reference": "Generated with OpenAI image generation in ChatGPT; owner-accepted on 2026-08-28",
        "license_record": "Generated asset; no third-party stock source or external stock license. Preserve generation provenance and follow applicable OpenAI terms.",
        "subject": "Print-shop worker inspecting a large-format print",
        "alt": "Print-shop worker inspecting a large-format print coming off a printer.",
        "allowed_surfaces": [
          "PUB-009"
        ],
        "desktop_focal_point": "60% 48%",
        "mobile_focal_point": "60% 48%",
        "preferred_aspect": "3:2",
        "status": "approved"
      },
      {
        "asset_id": "couranr-mkt-2026-08-specialty-retail",
        "local_path": "public/images/marketing/2026-08/06-specialty-retail.png",
        "derived_from": "public/images/marketing/2026-08/06-specialty-retail.png",
        "source": "generated-openai-chatgpt-2026-08",
        "source_reference": "Generated with OpenAI image generation in ChatGPT; owner-accepted on 2026-08-28",
        "license_record": "Generated asset; no third-party stock source or external stock license. Preserve generation provenance and follow applicable OpenAI terms.",
        "subject": "Home-goods shop worker arranging ceramics on a display wall",
        "alt": "Shop worker arranging ceramics on shelves in a local home-goods store.",
        "allowed_surfaces": [],
        "desktop_focal_point": "79% 45%",
        "mobile_focal_point": "79% 45%",
        "preferred_aspect": "3:2",
        "status": "approved-reserve"
      },
      {
        "asset_id": "couranr-mkt-2026-08-dry-cleaning",
        "local_path": "public/images/marketing/2026-08/w/mkt-2026-08-dry-cleaning-wide-800.webp",
        "derived_from": "public/images/marketing/2026-08/07-dry-cleaning.png",
        "source": "generated-openai-chatgpt-2026-08",
        "source_reference": "Generated with OpenAI image generation in ChatGPT; owner-accepted on 2026-08-28",
        "license_record": "Generated asset; no third-party stock source or external stock license. Preserve generation provenance and follow applicable OpenAI terms.",
        "subject": "Dry-cleaning worker tagging finished garments",
        "alt": "Dry-cleaning worker tagging finished garments beside a rack of clothing.",
        "allowed_surfaces": [
          "PUB-001"
        ],
        "desktop_focal_point": "49% 44%",
        "mobile_focal_point": "49% 44%",
        "preferred_aspect": "3:2",
        "status": "approved"
      },
      {
        "asset_id": "couranr-mkt-2026-08-gift-stationery",
        "local_path": "public/images/marketing/2026-08/w/mkt-2026-08-gift-stationery-wide-800.webp",
        "derived_from": "public/images/marketing/2026-08/08-gift-stationery.png",
        "source": "generated-openai-chatgpt-2026-08",
        "source_reference": "Generated with OpenAI image generation in ChatGPT; owner-accepted on 2026-08-28",
        "license_record": "Generated asset; no third-party stock source or external stock license. Preserve generation provenance and follow applicable OpenAI terms.",
        "subject": "Stationery-shop worker helping an older customer choose an item",
        "alt": "Stationery-shop worker helping an older customer choose an item.",
        "allowed_surfaces": [
          "PUB-009"
        ],
        "desktop_focal_point": "63% 45%",
        "mobile_focal_point": "63% 45%",
        "preferred_aspect": "3:2",
        "status": "approved"
      },
      {
        "asset_id": "couranr-mkt-2026-08-benefit-older-customer",
        "local_path": "public/images/marketing/2026-08/w/mkt-2026-08-older-customer-wide-880.webp",
        "derived_from": "public/images/marketing/2026-08/09-older-customer-home-goods.png",
        "source": "generated-openai-chatgpt-2026-08",
        "source_reference": "Generated with OpenAI image generation in ChatGPT; owner-accepted on 2026-08-28",
        "license_record": "Generated asset; no third-party stock source or external stock license. Preserve generation provenance and follow applicable OpenAI terms.",
        "subject": "Older customer at home arranging a locally purchased home-goods item",
        "alt": "Older customer arranging a newly purchased vase at home.",
        "allowed_surfaces": [
          "PUB-001"
        ],
        "desktop_focal_point": "60% 50%",
        "mobile_focal_point": "60% 28%",
        "focal_point_note":
          "Desktop is the handoff's 60% 50%. Below 900px the frame is a 16:9 letterbox and cover crops vertically; at 50% it took the top of the subject's head off, so the render uses 28%. A focal point describes the subject, not the window.",
        "preferred_aspect": "3:2",
        "status": "approved"
      },
      {
        "asset_id": "couranr-mkt-2026-08-benefit-busy-parent",
        "local_path": "public/images/marketing/2026-08/w/mkt-2026-08-busy-parent-wide-1440.webp",
        "derived_from": "public/images/marketing/2026-08/10-busy-parent-home.png",
        "source": "generated-openai-chatgpt-2026-08",
        "source_reference": "Generated with OpenAI image generation in ChatGPT; owner-accepted on 2026-08-28",
        "license_record": "Generated asset; no third-party stock source or external stock license. Preserve generation provenance and follow applicable OpenAI terms.",
        "subject": "Busy parent at home with children and a local bakery purchase",
        "alt": "Busy parent at home with children and a bakery purchase on the kitchen island.",
        "allowed_surfaces": [
          "PUB-001"
        ],
        "desktop_focal_point": "57% 46%",
        "mobile_focal_point": "57% 46%",
        "preferred_aspect": "4:3",
        "status": "approved"
      },
      {
        "asset_id": "couranr-mkt-2026-08-benefit-office",
        "local_path": "public/images/marketing/2026-08/11-office-local-supplies.png",
        "derived_from": "public/images/marketing/2026-08/11-office-local-supplies.png",
        "source": "generated-openai-chatgpt-2026-08",
        "source_reference": "Generated with OpenAI image generation in ChatGPT; owner-accepted on 2026-08-28",
        "license_record": "Generated asset; no third-party stock source or external stock license. Preserve generation provenance and follow applicable OpenAI terms.",
        "subject": "Professional at work unpacking locally sourced creative materials",
        "alt": "Professional at work reviewing newly received creative materials and supplies.",
        "allowed_surfaces": [],
        "desktop_focal_point": "49% 43%",
        "mobile_focal_point": "49% 43%",
        "preferred_aspect": "4:3",
        "status": "approved-reserve"
      },
      /* ── accepted 2026-08-29 ─────────────────────────────────────────────
         Four more frames. TWO are placed and two are held back, and the split
         is the finding rather than an accident: P2 and P3 are the same SCENES
         as the two already bound into PUB-001 `outcomes`, which the owner's
         decision locks to exactly two photographs. Cropping changes framing,
         not meaning, so they are reserves. */
      {
        asset_id: "couranr-mkt-2026-08-customer-at-home",
        local_path: "public/images/marketing/2026-08/w/mkt-2026-08-customer-at-home-wide-1900.webp",
        derived_from: "public/images/marketing/2026-08/12-customer-at-home-wide.png",
        source: "generated-openai-chatgpt-2026-08",
        source_reference: "Generated with OpenAI image generation in ChatGPT; owner-accepted on 2026-08-29",
        license_record: "Generated asset; no third-party stock source or external stock license.",
        subject: "A person setting a shopping bag and a potted plant on a table just inside her front door",
        alt: "A person setting a shopping bag and a potted plant on a table just inside her front door.",
        allowed_surfaces: ["PUB-011"],
        desktop_focal_point: "66% 34%",
        mobile_focal_point: null,
        preferred_aspect: "16:9",
        focal_point_note:
          "The only native 16:9 frame in the set, and the reason it can hold a full-bleed band. Right of centre because the empty left half is the copy well the band's inverse text sits over. HIGH because the band is a 4.13:1 slot showing 43% of the frame's height at 1440, and a centred window opened below the subject's hairline. ONE focal point at every width: `cover` makes the Y component inert only while the band is narrower than 16:9, which measures as below about 592px, so a separate mobile value would describe nothing. Null rather than a second figure, because a focal point no rule reads is a claim, not a record.",
        status: "approved",
      },
      {
        asset_id: "couranr-mkt-2026-08-merchant-phone-order",
        local_path: "public/images/marketing/2026-08/15-merchant-phone-order.png",
        derived_from: "public/images/marketing/2026-08/15-merchant-phone-order.png",
        source: "generated-openai-chatgpt-2026-08",
        source_reference: "Generated with OpenAI image generation in ChatGPT; owner-accepted on 2026-08-29",
        license_record: "Generated asset; no third-party stock source or external stock license.",
        subject: "A shop owner writing an order in a ledger while taking a call at her counter",
        alt: "A shop owner writing an order in a ledger while taking a call at her counter.",
        allowed_surfaces: [],
        desktop_focal_point: null,
        mobile_focal_point: null,
        preferred_aspect: "4:3",
        focal_point_note:
          "RESERVE. The brief's IMG-06, briefly placed as a 300x132 inset beside PUB-001's order-flow strip and REMOVED the same day on owner instruction 2026-08-29 — the photograph made the section look awkward. `order-channels` is back to tiles, convergence and the flow strip, which is what the artboard shows. No focal point is recorded because nothing crops it.",
        status: "approved-reserve",
      },
      {
        asset_id: "couranr-mkt-2026-08-older-customer-vase",
        local_path: "public/images/marketing/2026-08/13-older-customer-vase.png",
        derived_from: "public/images/marketing/2026-08/13-older-customer-vase.png",
        source: "generated-openai-chatgpt-2026-08",
        source_reference: "Generated with OpenAI image generation in ChatGPT; owner-accepted on 2026-08-29",
        license_record: "Generated asset; no third-party stock source or external stock license.",
        subject: "An older customer placing a newly bought ceramic vase on a console at home",
        alt: "An older customer placing a newly bought ceramic vase on a console at home.",
        allowed_surfaces: [],
        desktop_focal_point: "55% 48%",
        mobile_focal_point: "55% 48%",
        preferred_aspect: "3:2",
        focal_point_note:
          "RESERVE. Same scene as couranr-mkt-2026-08-benefit-older-customer, which is already bound into PUB-001 outcomes; that band is locked to exactly two photographs.",
        status: "approved-reserve",
      },
      {
        asset_id: "couranr-mkt-2026-08-parent-child-kitchen",
        local_path: "public/images/marketing/2026-08/14-parent-child-kitchen.png",
        derived_from: "public/images/marketing/2026-08/14-parent-child-kitchen.png",
        source: "generated-openai-chatgpt-2026-08",
        source_reference: "Generated with OpenAI image generation in ChatGPT; owner-accepted on 2026-08-29",
        license_record: "Generated asset; no third-party stock source or external stock license.",
        subject: "A parent writing at a kitchen island beside a child drawing, with a bakery box on the counter",
        alt: "A parent writing at a kitchen island beside a child drawing, with a bakery box on the counter.",
        allowed_surfaces: [],
        desktop_focal_point: "50% 46%",
        mobile_focal_point: "50% 46%",
        preferred_aspect: "3:2",
        focal_point_note:
          "RESERVE. Same scene as couranr-mkt-2026-08-benefit-busy-parent, already bound into PUB-001 outcomes.",
        status: "approved-reserve",
      },
    ],
    pending_photography: [
      /* PUB-001 section 3 (category-breadth) is NO LONGER PENDING. The owner
         accepted four frames on 2026-08-28 and they are installed; the entry
         that used to sit here would now be a false claim that the page still
         shows a placeholder. */
      {
        slot: "PUB-001 section 7 (product-proof), delivery-photo artifact",
        assets: ["IMG-05 or a product proof frame"],
        brief: "docs/couranr-mvp/brand/PUB-001_PHOTOGRAPHY_BRIEF.md",
        blocks: "Gate A deviation D-2 (partial)",
      },
    ],
  };
}

function validate(reg) {
  const fail = [];
  const map = mockMap();
  const doc = readFileSync(join(repo, SPEC), "utf8");
  const governed = new Set(governedPages(doc).map((p) => p.screen));

  // A page the spec governs but the registry does not record is the §25 gap
  // that matters: the composition contract would be enforced with no record of
  // which visual authority it answers to.
  for (const g of governed) {
    if (!reg.screens?.some((s) => s.screen_id === g)) {
      fail.push(`${g} is governed by §27.0/§27.1 but has no visual-authority record`);
    }
  }

  if (!Array.isArray(reg.screens) || reg.screens.length === 0) {
    return ["registry declares no screens"];
  }

  const ids = reg.screens.map((s) => s.screen_id);
  if (new Set(ids).size !== ids.length) fail.push("duplicate screen_id in the registry");

  for (const s of reg.screens) {
    // §25: "derived screens explicitly name the family/source they derive
    // from", and the validator must check "derived screens declare their
    // derivation". A derived screen legitimately has no canonical source, so
    // the emptiness check applies only to canonical ones — but the derivation
    // it must declare instead is checked here, not assumed.
    if (s.visual_authority === "derived") {
      if (!s.derived_from?.screen_id) {
        fail.push(`${s.screen_id}: visual_authority "derived" but no derived_from.screen_id (§25)`);
      } else if (!reg.screens.some((x) => x.screen_id === s.derived_from.screen_id)) {
        fail.push(`${s.screen_id}: derives from "${s.derived_from.screen_id}", which is not in this registry`);
      }
      if (!s.derivation_basis) {
        fail.push(`${s.screen_id}: visual_authority "derived" but no derivation_basis (§25)`);
      }
      if (Array.isArray(s.canonical_sources) && s.canonical_sources.length) {
        fail.push(`${s.screen_id}: declared derived but also claims a canonical source`);
      }
    } else if (!Array.isArray(s.canonical_sources) || s.canonical_sources.length === 0) {
      fail.push(`${s.screen_id}: no canonical_sources`);
      continue;
    }
    // §25: the mapped sources and the registry's must agree, so a screen cannot
    // quietly cite a different artboard than the mock map records.
    const mapped = new Set(map[s.screen_id] ?? []);
    for (const src of s.canonical_sources) {
      if (!existsSync(join(repo, src.path))) {
        fail.push(`${s.screen_id}: "${src.path}" does not exist`);
        continue;
      }
      if (!mapped.has(src.path)) {
        fail.push(`${s.screen_id}: "${src.path}" is not what MOCK_TO_SCREEN_MAP.md maps to this screen`);
      }
      if (!(src.width_px > 0) || !(src.height_px > 0)) {
        fail.push(`${s.screen_id}: "${src.path}" has a placeholder dimension (${src.width_px}×${src.height_px})`);
        continue;
      }
      const real = pngSize(src.path);
      if (real.width !== src.width_px || real.height !== src.height_px) {
        fail.push(
          `${s.screen_id}: "${src.path}" records ${src.width_px}×${src.height_px} ` +
            `but the file measures ${real.width}×${real.height}`,
        );
      }
    }
    for (const m of mapped) {
      if (!s.canonical_sources.some((x) => x.path === m)) {
        fail.push(`${s.screen_id}: mapped source "${m}" is missing from the registry`);
      }
    }
    if (s.mobile_reference && !existsSync(join(repo, s.mobile_reference))) {
      fail.push(`${s.screen_id}: mobile_reference "${s.mobile_reference}" does not exist`);
    }

    /*
     * The regions on disk must still be §27.0's, in §27.0's order.
     *
     * This check did not exist, and its absence is why `--write` could emit a
     * stale twelve-region list after MKT-003 added a thirteenth section and
     * still print "validated": the validator only ever re-measured PNGs. A
     * region list is exactly as much a derived fact as a dimension is, and gets
     * the same treatment — re-derived from the spec on every run, never trusted
     * because it was correct when it was written.
     */
    if (governed.has(s.screen_id)) {
      const want = compositionRegions(s.screen_id);
      const got = s.composition_regions ?? [];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        fail.push(
          `${s.screen_id}: composition_regions disagree with §27.0 — ` +
            `registry has [${got.join(", ")}], §27.0 gives [${want.join(", ")}]`,
        );
      }
    }
  }

  for (const p of reg.photography ?? []) {
    for (const k of ["asset_id", "local_path", "source", "license_record", "subject", "status"]) {
      if (!p[k]) fail.push(`photography "${p.asset_id ?? "?"}" is missing "${k}" (§21.2/§21.8)`);
    }
    if (p.local_path && !existsSync(join(repo, p.local_path))) {
      fail.push(`photography "${p.asset_id}": ${p.local_path} does not exist`);
    }
    if (p.derived_from && !existsSync(join(repo, p.derived_from))) {
      fail.push(`photography "${p.asset_id}": source ${p.derived_from} does not exist`);
    }
  }

  return fail;
}

/* ------------------------------------------------------------------ main */

if (process.argv.includes("--write")) {
  const reg = build();
  writeFileSync(join(repo, OUT), JSON.stringify(reg, null, 2) + "\n");
  const fail = validate(reg);
  if (fail.length) {
    console.error("generated a registry that does not validate:\n" + fail.map((f) => "  - " + f).join("\n"));
    process.exit(1);
  }
  console.log(`wrote ${OUT} — ${reg.screens.length} screen(s), ${reg.photography.length} asset(s), validated`);
  process.exit(0);
}

if (!existsSync(join(repo, OUT))) {
  console.error(`${OUT} does not exist. Generate it with:\n  npm run check:visual-registry -- --write`);
  process.exit(1);
}
const reg = JSON.parse(readFileSync(join(repo, OUT), "utf8"));

/**
 * THE CHECKED-IN JSON MUST BE WHAT THIS FILE WOULD GENERATE TODAY.
 *
 * Without this, the check reads the JSON off disk and validates THAT — so
 * editing the generator and forgetting `-- --write` leaves a stale file and a
 * green gate. That is not hypothetical: it happened on the commit that added
 * this check. A photograph's `desktop_focal_point` was changed here from
 * `66% 50%` to `66% 34%` to stop a band cropping the subject's head, the
 * committed JSON still said `66% 50%`, and `check:visual-registry` reported
 * "ok — every dimension matches its file".
 *
 * It is the same failure the §27.0 region list already carries a comment about,
 * one level up: there the derivation was fake, here the derivation was real and
 * simply not re-run. Both end with a file that claims to be generated and is
 * not.
 */
function generatorDrift(onDisk) {
  /* build() reads the mock map, §27's tables and every image on disk. If any of
     those is missing or malformed it THROWS, and an uncaught throw here would
     replace validate()'s specific, actionable message with a stack trace — a
     drift check that makes every other failure harder to read is a net loss.
     So a build failure is reported as a finding and the run continues into
     validate(). */
  let fresh;
  try {
    fresh = JSON.stringify(build(), null, 2) + "\n";
  } catch (e) {
    return [
      `the registry generator could not run, so ${OUT} could not be checked for drift — ${e.message}`,
    ];
  }
  const stored = JSON.stringify(onDisk, null, 2) + "\n";
  if (fresh === stored) return [];
  const a = fresh.split("\n");
  const b = stored.split("\n");
  const at = a.findIndex((l, i) => l !== b[i]);
  return [
    `${OUT} is not what this generator produces — first difference at line ${at + 1}: ` +
      `generated ${JSON.stringify((a[at] || "").trim())}, on disk ${JSON.stringify((b[at] || "").trim())}. ` +
      "Run `npm run check:visual-registry -- --write`.",
  ];
}

if (process.argv.includes("--positive-control")) {
  // Two plants, because this file now derives two kinds of fact from outside
  // itself and both have already been wrong once in this repository.
  const controls = [
    {
      what: "a copied dimension (1448, the number v2.1 shipped)",
      plant: (r) => { r.screens[0].canonical_sources[0].width_px = 1448; },
      expect: "but the file measures",
    },
    {
      what: "a dropped composition region",
      plant: (r) => { r.screens[0].composition_regions = r.screens[0].composition_regions.slice(0, -1); },
      expect: "composition_regions disagree with §27.0",
    },
    {
      what: "a stored file that is not what the generator produces",
      plant: (r) => { r.photography[0].desktop_focal_point = "1% 1%"; },
      expect: "is not what this generator produces",
      via: generatorDrift,
    },
  ];
  for (const c of controls) {
    const broken = JSON.parse(JSON.stringify(reg));
    c.plant(broken);
    const fail = (c.via || validate)(broken);
    const hit = fail.find((f) => f.includes(c.expect));
    if (!hit) {
      console.error(`positive control FAILED — ${c.what} was not detected`);
      console.error(fail.length ? fail.join("\n") : "  (the validator reported nothing at all)");
      process.exit(1);
    }
    console.log(`check:visual-registry positive control ok — ${c.what} was rejected: "${hit}"`);
  }
  process.exit(0);
}

const fail = [...generatorDrift(reg), ...validate(reg)];
if (fail.length) {
  console.error(`check-visual-registry: ${fail.length} problem(s)\n`);
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
const total = Object.keys(mockMap()).length;
console.log(
  `check-visual-registry: ok — ${reg.screens.length}/${total} screens recorded ` +
    `(${reg.screens.filter((s) => s.visual_authority === "canonical").length} canonical, ` +
    `${reg.screens.filter((s) => s.visual_authority === "derived").length} derived, ` +
    `${reg.screens.filter((s) => s.gate_a_review).length} with a Gate A record), ` +
    `every dimension matches its file, ` +
    `${reg.photography.length} photography asset(s) with provenance, ` +
    `${reg.pending_photography.length} slot(s) pending`,
);
