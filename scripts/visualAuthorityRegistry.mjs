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

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "docs/couranr-mvp/ui-reference/VISUAL_AUTHORITY_REGISTRY.json";
const MAP = "docs/couranr-mvp/MOCK_TO_SCREEN_MAP.md";
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
 */
function compositionRegions() {
  const doc = readFileSync(join(repo, SPEC), "utf8");
  const table = doc.match(/## 27\.0 Governed section identifiers[\s\S]*?\n\n(\| # [\s\S]*?)\n\n/);
  if (!table) throw new Error(`${SPEC}: §27.0 normative table not found`);
  const ids = table[1]
    .trim()
    .split("\n")
    .filter((r) => /^\|\s*\d+\s*\|/.test(r))
    .map((r) => r.replace(/^\||\|$/g, "").split("|")[1].trim().replace(/`/g, ""));
  if (!ids.length) throw new Error(`${SPEC}: §27.0 table parsed to zero rows`);
  return ["navigation", ...ids];
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
      "PUB-001 and the photography it renders. §34.1 defers the remaining 65 " +
      "screens until after PUB-001 is approved; this file is intentionally " +
      "incomplete and the validator reports the gap.",
    screens: [
      {
        screen_id: "PUB-001",
        surface_family: "public_marketing",
        route: "/",
        canonical_sources: measured.map((m) => ({
          path: m.path,
          role: m.role,
          width_px: m.width,
          height_px: m.height,
          source_kind: "design_artboard",
        })),
        registry_declared_viewport_intent: "responsive",
        visual_authority: "canonical",
        // Parsed from §27.0's normative table, not transcribed from it.
        composition_regions: compositionRegions(),
        mobile_reference: mobile?.path ?? null,
        gate_a_review: "docs/couranr-mvp/brand/PUB-001_GATE_A_REGION_REVIEW.md",
        notes: [
          "The artboards are design exports, not browser screenshots. §26's " +
            "pixel-diff policy therefore does not apply; Gate A is a named-region " +
            "review and Gate B verifies real browser widths separately.",
          "Gate A recorded six intentional deviations, two of which close when " +
            "the photography in PUB-001_PHOTOGRAPHY_BRIEF.md exists.",
        ],
      },
    ],
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
    ],
    pending_photography: [
      {
        slot: "PUB-001 section 3 (category-breadth)",
        assets: ["IMG-01", "IMG-02", "IMG-03", "IMG-04"],
        brief: "docs/couranr-mvp/brand/PUB-001_PHOTOGRAPHY_BRIEF.md",
        blocks: "Gate A deviation D-1",
      },
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

  if (!Array.isArray(reg.screens) || reg.screens.length === 0) {
    return ["registry declares no screens"];
  }

  const ids = reg.screens.map((s) => s.screen_id);
  if (new Set(ids).size !== ids.length) fail.push("duplicate screen_id in the registry");

  for (const s of reg.screens) {
    if (!Array.isArray(s.canonical_sources) || s.canonical_sources.length === 0) {
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
    if (s.screen_id === "PUB-001") {
      const want = compositionRegions();
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
  ];
  for (const c of controls) {
    const broken = JSON.parse(JSON.stringify(reg));
    c.plant(broken);
    const fail = validate(broken);
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

const fail = validate(reg);
if (fail.length) {
  console.error(`check-visual-registry: ${fail.length} problem(s)\n`);
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
const total = Object.keys(mockMap()).length;
console.log(
  `check-visual-registry: ok — ${reg.screens.length}/${total} screens recorded ` +
    `(§34.1 defers the rest), every dimension matches its file, ` +
    `${reg.photography.length} photography asset(s) with provenance, ` +
    `${reg.pending_photography.length} slot(s) pending`,
);
