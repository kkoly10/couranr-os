#!/usr/bin/env node
/**
 * `npm run check:governance` — proves the authority model holds.
 *
 * Two things it asserts, and the second is the one that matters:
 *
 *   1. the manifest is coherent — every path it names exists, and no domain
 *      declares two writable sources;
 *   2. every GENERATED artifact matches what its generator produces from its
 *      declared AUTHORITY, byte for byte.
 *
 * (2) is what makes de-authorizing a mirror safe. A gate that only validates a
 * source against itself proves nothing about the copies downstream of it, and
 * this repository shipped three mirrors of the same 66 screens for exactly that
 * reason. Regeneration happens IN MEMORY here; this command never writes.
 *
 * `--positive-control` plants drift in each generated family and fails if any
 * goes undetected. Required because a parity check with no control is
 * indistinguishable from a parity check that compares a file to itself.
 *
 * Read-only.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, screenSource, SCREEN_OUTPUTS, SCREEN_SOURCE } from "./screenRegistry.mjs";
import { SCREENS_MODULE_OUTPUT } from "./screensModule.mjs";
import { VISUAL_SOURCE_OUTPUTS, VISUAL_REGISTRY as VISUAL_SOURCE } from "./visualSources.mjs";
import { STATUS_OUTPUT } from "./statusReport.mjs";
import { visualDocDrift } from "./visualRegistry.mjs";

const MANIFEST = "docs/couranr-mvp/authority/AUTHORITY_MANIFEST.json";
const CONTROL = process.argv.includes("--positive-control");

/** Every generated family: which authority produces it, and how. */
function outputs() {
  const src = screenSource();
  return [
    ...SCREEN_OUTPUTS.map((o) => ({ ...o, authority: SCREEN_SOURCE })),
    { ...SCREENS_MODULE_OUTPUT, authority: SCREEN_SOURCE },
    ...VISUAL_SOURCE_OUTPUTS.map((o) => ({ ...o, authority: VISUAL_SOURCE })),
    { ...STATUS_OUTPUT, authority: "the two implementation ledgers" },
  ].map((o) => ({ ...o, source: src }));
}

function firstDiff(want, got) {
  const a = want.split("\n");
  const b = got.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return (
        `line ${i + 1}: checked-in ${JSON.stringify((a[i] ?? "").slice(0, 90))} ` +
        `vs generated ${JSON.stringify((b[i] ?? "").slice(0, 90))}`
      );
    }
  }
  return `identical by line but ${want.length} vs ${got.length} bytes (line endings or trailing newline)`;
}

/**
 * `CLAUDE.md` must not pin a value that can be measured.
 *
 * Every pattern below was live in that file at the consolidation baseline and
 * at least three were already WRONG: it claimed 1629 tests across 51 files in
 * one place and 2013 across 53 in another while the suite ran 2073 across 54,
 * and it claimed 9 of 42 work items verified while the ledger said 17. The file
 * every agent reads first was the least accurate current-state document in the
 * repository, because a hand-pinned number goes stale between the commit that
 * changes it and the commit that remembers it.
 *
 * Prose ABOUT a retired fingerprint is allowed and deliberately so — the file
 * keeps its record of which fingerprints stopped matching — so these patterns
 * match the act of pinning a CURRENT value, not the act of describing an old one.
 */
const MUTABLE_IN_CLAUDE_MD = [
  [/\*\*\d+ decision records\*\*/, "a pinned decision-record count"],
  [/\d+ canonical MVP screens/, "a pinned canonical-screen count"],
  [/\d+ of \d+ work items `complete_verified`/, "a pinned work-item completion count"],
  [/\d+ of \d+\s*\n?screens `functional_verified`/, "a pinned screen completion count"],
  [/\d+ tests across \d+ files/, "a pinned test count"],
  [/vitest run — \d+ files, \d+ tests/, "a pinned test count"],
];

function checkAgentGuidance(fail, text) {
  for (const [rx, what] of MUTABLE_IN_CLAUDE_MD) {
    const m = text.match(rx);
    if (m) {
      fail.push(
        `CLAUDE.md pins ${what} (${JSON.stringify(m[0])}) — point at ` +
          `\`npm run governance:facts\` instead; a hand-pinned count goes stale`,
      );
    }
  }
}

/** Manifest coherence. */
function checkManifest(fail) {
  if (!existsSync(join(ROOT, MANIFEST))) {
    fail.push(`${MANIFEST} does not exist — the authority model has no declaration`);
    return null;
  }
  const m = JSON.parse(readFileSync(join(ROOT, MANIFEST), "utf8"));
  const owners = new Map();

  for (const d of m.domains) {
    if (!existsSync(join(ROOT, d.authority))) {
      fail.push(`${d.domain}: declared authority "${d.authority}" does not exist`);
    }
    if (owners.has(d.authority)) {
      fail.push(
        `"${d.authority}" is declared the writable authority for BOTH ` +
          `${owners.get(d.authority)} and ${d.domain} — one source, one domain`,
      );
    }
    owners.set(d.authority, d.domain);

    for (const g of d.generated ?? []) {
      if (!existsSync(join(ROOT, g))) {
        fail.push(`${d.domain}: generated output "${g}" does not exist`);
      }
      if (owners.has(g)) {
        fail.push(`"${g}" is declared generated by ${d.domain} but is also an authority`);
      }
    }
  }

  const seen = new Set();
  for (const d of m.domains) {
    if (seen.has(d.domain)) fail.push(`domain "${d.domain}" is declared twice`);
    seen.add(d.domain);
  }
  return m;
}

/**
 * Every generated artifact must SAY it is generated, in its own bytes.
 *
 * Parity alone is a check that runs after the damage: someone edits the mirror,
 * the gate reverts them, and the only signal is a failure they have to decode.
 * A marker at the top of the file is the signal BEFORE the edit. §5 of the work
 * order requires it; this is the enforcement.
 */
function checkGeneratedMarkers(fail, m, mutate) {
  const spec = m?.generated_marker;
  if (!spec) {
    fail.push(`${MANIFEST} declares no generated_marker rule`);
    return;
  }
  for (const d of m.domains) {
    for (const g of d.generated ?? []) {
      const p = join(ROOT, g);
      if (!existsSync(p)) continue; // already reported by checkManifest
      let head = readFileSync(p, "utf8").slice(0, spec.window_bytes);
      if (mutate) head = mutate(g, head);
      if (!head.includes(spec.marker)) {
        fail.push(
          `${g} is declared generated by ${d.domain} but does not carry ` +
            `${JSON.stringify(spec.marker)} in its first ${spec.window_bytes} bytes — ` +
            `a mirror that does not say so is a mirror somebody will hand-edit`,
        );
      }
    }
  }
}

/**
 * HISTORICAL and EVIDENCE files cannot be read as authority.
 *
 * Three things, and the third is the one with teeth: a historical file must
 * label itself, so an agent that greps into the middle of a 2026-07 inventory
 * and scrolls up finds "not current status" rather than a confident table.
 */
function checkNonAuthority(fail, m, mutate) {
  const na = m?.non_authority;
  if (!na) {
    fail.push(`${MANIFEST} declares no non_authority block — HISTORICAL and EVIDENCE are unclassified`);
    return;
  }
  const authorities = new Set(m.domains.map((d) => d.authority));
  const generated = new Set(m.domains.flatMap((d) => d.generated ?? []));

  const claimsOverlap = (path, where) => {
    if (authorities.has(path)) {
      fail.push(`${path} is declared ${where} AND is a domain authority — it cannot be both`);
    }
    if (generated.has(path)) {
      fail.push(`${path} is declared ${where} AND is a generated output — it cannot be both`);
    }
  };

  for (const entry of na.historical ?? []) {
    const p = join(ROOT, entry.path);
    if (!existsSync(p)) {
      fail.push(`historical "${entry.path}" does not exist`);
      continue;
    }
    claimsOverlap(entry.path, "HISTORICAL");
    if (entry.marker_exempt) continue;
    let head = readFileSync(p, "utf8").slice(0, na.marker_window_bytes);
    if (mutate) head = mutate(entry.path, head);
    if (!na.accepted_markers.some((k) => head.includes(k))) {
      fail.push(
        `${entry.path} is declared HISTORICAL but carries no de-authorization marker in ` +
          `its first ${na.marker_window_bytes} bytes (one of: ` +
          `${na.accepted_markers.map((k) => JSON.stringify(k)).join(", ")}), and declares no ` +
          `marker_exempt reason`,
      );
    }
  }

  for (const dir of na.evidence_directories ?? []) {
    if (!existsSync(join(ROOT, dir))) fail.push(`evidence directory "${dir}" does not exist`);
    for (const a of authorities) {
      if (a === dir || a.startsWith(dir + "/")) {
        fail.push(`${a} is a domain authority inside declared evidence directory "${dir}"`);
      }
    }
    for (const g of generated) {
      if (g === dir || g.startsWith(dir + "/")) {
        fail.push(`${g} is a generated output inside declared evidence directory "${dir}"`);
      }
    }
  }
  for (const f of na.evidence_files ?? []) {
    if (!existsSync(join(ROOT, f))) fail.push(`evidence file "${f}" does not exist`);
    claimsOverlap(f, "EVIDENCE");
  }
}

/**
 * No authority may point upward at something downstream of it.
 *
 * The concrete case: `02_DECISION_REGISTRY.json` carried
 * `generated_from.authority_order` naming `UI_SCREEN_REGISTRY.md` — a file
 * GENERATED from `ui_screen_registry.json` — as ranking above the rank-1
 * product authority. A test asserted that order, so the cycle was pinned, not
 * merely present.
 *
 * The rule is general: in any JSON domain authority, a key whose name implies
 * PRECEDENCE may not name a path the manifest declares generated. Provenance
 * keys are fine; the registry still records what it was derived from.
 */
const PRECEDENCE_KEY = /authority_order|precedence|source_of_truth|ranks?_above/i;

function checkNoCircularPrecedence(fail, m, inject) {
  const generated = new Set(m.domains.flatMap((d) => d.generated ?? []));
  for (const d of m.domains) {
    if (!d.authority.endsWith(".json")) continue;
    const p = join(ROOT, d.authority);
    if (!existsSync(p)) continue;
    let doc;
    try {
      doc = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      fail.push(`${d.authority} is not parseable JSON`);
      continue;
    }
    if (inject) doc = inject(d.authority, doc);
    const walk = (node, trail) => {
      if (node == null) return;
      if (Array.isArray(node)) return node.forEach((v) => walk(v, trail));
      if (typeof node === "object") {
        for (const [k, v] of Object.entries(node)) walk(v, [...trail, k]);
        return;
      }
      if (typeof node !== "string") return;
      const key = trail[trail.length - 1] ?? "";
      const parent = trail[trail.length - 2] ?? "";
      if (!PRECEDENCE_KEY.test(key) && !PRECEDENCE_KEY.test(parent)) return;
      if (generated.has(node)) {
        fail.push(
          `${d.authority} names generated artifact "${node}" under precedence key ` +
            `"${trail.join(".")}" — a domain authority cannot rank a file below it above itself`,
        );
      }
    };
    walk(doc, []);
  }
}

/**
 * CLS-001's screen classification counts must reconcile to the screen registry.
 *
 * §5 of the work order names this specifically: the counts must reconcile
 * mechanically "rather than a literal in a test". They were a literal in three
 * places — `CLS-001.value`, `tests/couranr-screens.test.ts` and
 * `scripts/checkMockMap.mjs` — and Phase D moves all of them at once.
 *
 * The registry stays the writable owner of the DECISION; this only proves the
 * decision and the screen list describe the same product.
 */
function checkClassificationCounts(fail, src, inject) {
  const registryPath = join(ROOT, "02_DECISION_REGISTRY.json");
  if (!existsSync(registryPath)) return;
  let reg = JSON.parse(readFileSync(registryPath, "utf8"));
  if (inject) reg = inject(reg);
  const cls = (reg.decisions ?? []).find((r) => r.id === "CLS-001");
  if (!cls) {
    fail.push("02_DECISION_REGISTRY.json has no CLS-001 record to reconcile screen counts against");
    return;
  }
  const screens = src.screens;
  const measured = {
    canonical_screens: screens.length,
    core: screens.filter((s) => s.tier === "Core").length,
    mvp_complete: screens.filter((s) => s.tier === "MVP-complete").length,
  };
  for (const [k, v] of Object.entries(measured)) {
    if (cls.value[k] !== v) {
      fail.push(
        `CLS-001.value.${k} is ${cls.value[k]} but ${SCREEN_SOURCE} has ${v} — ` +
          `the decision and the screen list disagree; change both in one commit`,
      );
    }
  }
  const ids = screens.filter((s) => s.tier === "MVP-complete").map((s) => s.id).sort();
  const declared = [...(cls.value.mvp_complete_ids ?? [])].sort();
  if (JSON.stringify(ids) !== JSON.stringify(declared)) {
    fail.push(
      `CLS-001.value.mvp_complete_ids is [${declared.join(", ")}] but ${SCREEN_SOURCE} ` +
        `marks [${ids.join(", ")}] MVP-complete`,
    );
  }
}

/** Source -> generated parity. */
function checkParity(fail, mutate) {
  for (const o of outputs()) {
    const path = join(ROOT, o.path);
    if (!existsSync(path)) {
      fail.push(`${o.path}: declared generated but missing`);
      continue;
    }
    let checkedIn = readFileSync(path, "utf8");
    if (mutate) checkedIn = mutate(o.path, checkedIn);
    const generated = o.render(o.source);
    if (checkedIn !== generated) {
      fail.push(
        `${o.path} is not what ${o.authority} generates — ${firstDiff(checkedIn, generated)}. ` +
          `Run \`npm run governance:generate\`; do not hand-edit a generated artifact.`,
      );
    }
  }
}

const fail = [];
const manifest = checkManifest(fail);

if (CONTROL) {
  /* One plant per generated family. Each must be DETECTED; a plant that changes
     nothing is itself reported, because a control that cannot alter its input
     is a control that tested nothing. */
  let bad = 0;
  const plants = [
    ["a rewritten screen route in the generated Markdown", "UI_SCREEN_REGISTRY.md",
      (t) => t.replace("| `/pricing` |", "| `/prices` |")],
    ["a rewritten screen id in the generated CSV", "ui_screen_registry.csv",
      (t) => t.replace("PUB-008,", "PUB-808,")],
    ["a rewritten status in the generated runtime screen list", "lib/couranr/screens.ts",
      (t) => t.replace('status: "placeholder_only"', 'status: "functional_verified"')],
    ["a rewritten census count in the generated mock map", "docs/couranr-mvp/MOCK_TO_SCREEN_MAP.md",
      (t) => t.replace("| PNGs at repo root | 91 |", "| PNGs at repo root | 90 |")],
    ["a re-owned asset in the generated provenance map", "docs/couranr-mvp/ui-reference/CANONICAL_SCREEN_SOURCE_MAP.tsv",
      (t) => t.replace("PUB-006\t0013FABA", "PUB-007\t0013FABA")],
    ["a hand-edited count in the generated status summary", "docs/couranr-mvp/IMPLEMENTATION_STATUS.md",
      (t) => t.replace("| Forward migrations | ", "| Forward migrations | 9")],
  ];
  /* The composition contract is a SOURCE, not a generated mirror, so its
     control is the other direction: prove the handbook cannot drift away from
     it unnoticed. */
  {
    const spec = join(ROOT, "docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md");
    const before = readFileSync(spec, "utf8");
    const planted = before.replace(
      "| 2 | `pickup-problem` |",
      "| 2 | `pickup-problems` |",
    );
    if (planted === before) {
      console.error("positive control FAILED — could not plant a §27 table drift; the control tested nothing");
      bad++;
    } else {
      writeFileSync(spec, planted);
      let caught;
      try {
        caught = visualDocDrift(ROOT).find((f) => f.startsWith("PUB-001"));
      } finally {
        writeFileSync(spec, before);
      }
      if (!caught) {
        console.error("positive control FAILED — a §27 table that disagrees with VISUAL_REGISTRY.json was not detected");
        bad++;
      } else {
        console.log(`check:governance positive control ok — a drifted §27 table was rejected: "${caught.slice(0, 110)}"`);
      }
    }
  }
  {
    /* Strip the marker out of each generated artifact in memory. A generated
       file that no longer says it is generated must be rejected. */
    for (const target of ["UI_SCREEN_REGISTRY.md", "ui_screen_registry.csv"]) {
      const detected = [];
      checkGeneratedMarkers(detected, manifest, (p, head) =>
        p === target ? head.replaceAll("GENERATED FILE — DO NOT EDIT", "Approved source of truth") : head,
      );
      const hit = detected.find((f) => f.startsWith(target));
      if (!hit) {
        console.error(`positive control FAILED — ${target} without its do-not-edit marker was not detected`);
        bad++;
      } else {
        console.log(`check:governance positive control ok — a generated file with no marker was rejected: "${hit.slice(0, 110)}"`);
      }
    }
  }
  {
    /* Strip the de-authorization banner out of a HISTORICAL file in memory. */
    const target = "docs/couranr-mvp/00-gap-report.md";
    const detected = [];
    checkNonAuthority(detected, manifest, (p, head) =>
      p === target ? head.replaceAll("Historical baseline — not current status.", "Current status.") : head,
    );
    const hit = detected.find((f) => f.startsWith(target));
    if (!hit) {
      console.error("positive control FAILED — a HISTORICAL file with no de-authorization marker was not detected");
      bad++;
    } else {
      console.log(`check:governance positive control ok — an unlabelled HISTORICAL file was rejected: "${hit.slice(0, 110)}"`);
    }
    /* And the overlap rule: declaring an authority as HISTORICAL must be rejected. */
    const overlap = [];
    const forged = JSON.parse(JSON.stringify(manifest));
    forged.non_authority.historical.push({ path: "ui_screen_registry.json" });
    checkNonAuthority(overlap, forged);
    if (!overlap.some((f) => f.includes("cannot be both"))) {
      console.error("positive control FAILED — a domain authority declared HISTORICAL was not detected");
      bad++;
    } else {
      console.log(`check:governance positive control ok — an authority declared HISTORICAL was rejected: "${overlap.find((f) => f.includes("cannot be both")).slice(0, 110)}"`);
    }
  }
  {
    /* Re-introduce the cycle in memory: the product registry naming a generated
       mirror as ranking above it. */
    const detected = [];
    checkNoCircularPrecedence(detected, manifest, (path, doc) =>
      path === "02_DECISION_REGISTRY.json"
        ? { ...doc, generated_from: { ...doc.generated_from, authority_order: ["UI_SCREEN_REGISTRY.md"] } }
        : doc,
    );
    if (!detected.length) {
      console.error("positive control FAILED — a restored authority_order cycle was not detected");
      bad++;
    } else {
      console.log(`check:governance positive control ok — a precedence cycle was rejected: "${detected[0].slice(0, 110)}"`);
    }
  }
  {
    const detected = [];
    checkClassificationCounts(detected, screenSource(), (reg) => ({
      ...reg,
      decisions: reg.decisions.map((r) =>
        r.id === "CLS-001" ? { ...r, value: { ...r.value, core: r.value.core + 1 } } : r,
      ),
    }));
    if (!detected.length) {
      console.error("positive control FAILED — a CLS-001 core count that disagrees with the screen registry was not detected");
      bad++;
    } else {
      console.log(`check:governance positive control ok — a drifted CLS-001 count was rejected: "${detected[0].slice(0, 110)}"`);
    }
  }
  {
    const before = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
    const detected = [];
    checkAgentGuidance(detected, before + "\n\nThere are 4321 tests across 99 files now.\n");
    if (!detected.length) {
      console.error("positive control FAILED — a re-pinned test count in CLAUDE.md was not detected");
      bad++;
    } else {
      console.log(`check:governance positive control ok — a re-pinned mutable count was rejected: "${detected[0].slice(0, 110)}"`);
    }
  }
  for (const [what, target, plant] of plants) {
    const detected = [];
    checkParity(detected, (p, text) => (p === target ? plant(text) : text));
    const original = readFileSync(join(ROOT, target), "utf8");
    if (plant(original) === original) {
      console.error(`positive control FAILED — could not plant ${what}; the control tested nothing`);
      bad++;
      continue;
    }
    const hit = detected.find((f) => f.startsWith(target));
    if (!hit) {
      console.error(`positive control FAILED — ${what} was not detected`);
      bad++;
    } else {
      console.log(`check:governance positive control ok — ${what} was rejected: "${hit.slice(0, 110)}"`);
    }
  }
  if (fail.length) {
    console.error("\npositive control ran against a repository that is already failing:");
    for (const f of fail) console.error(`  - ${f}`);
    bad++;
  }
  process.exit(bad ? 1 : 0);
}

checkParity(fail);
checkGeneratedMarkers(fail, manifest);
checkNonAuthority(fail, manifest);
checkNoCircularPrecedence(fail, manifest);
checkClassificationCounts(fail, screenSource());
checkAgentGuidance(fail, readFileSync(join(ROOT, "CLAUDE.md"), "utf8"));
/* The composition contract is structured data now; §27's prose tables are the
   human view of it and must still agree. */
fail.push(...visualDocDrift(ROOT));

if (fail.length) {
  console.error(`check:governance: ${fail.length} problem(s)\n`);
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}

const domains = manifest.domains.length;
const generated = manifest.domains.reduce((n, d) => n + (d.generated?.length ?? 0), 0);
const pending = (manifest.pending_domains ?? []).length;
const na = manifest.non_authority ?? {};
const historical = (na.historical ?? []).length;
const evidence = (na.evidence_directories ?? []).length + (na.evidence_files ?? []).length;
console.log(
  `check:governance: ok — ${domains} declared domain(s), one writable source each, ` +
    `${generated} generated artifact(s) match their authority and carry the do-not-edit marker, ` +
    `${historical} historical + ${evidence} evidence path(s) declared non-authority` +
    (pending ? `; ${pending} domain(s) still pending consolidation` : ""),
);
