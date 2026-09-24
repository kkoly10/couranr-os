import { mkdtempSync, mkdirSync, chmodSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { postgrestFromLayer } from "../scripts/provisionPostgrest.mjs";
const digest = (b: Buffer) => `sha256:${createHash("sha256").update(b).digest("hex")}`;
function fixture(run: (base: string, archive: Buffer, binary: Buffer) => void) {
  const base = mkdtempSync(path.join(tmpdir(), "postgrest-fixture-"));
  const root = path.join(base, "root");
  const bin = path.join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const bytes = Buffer.alloc(32); bytes.set([0x7f, 0x45, 0x4c, 0x46]);
  writeFileSync(path.join(bin, "postgrest"), bytes);
  writeFileSync(path.join(root, "DO-NOT-EXTRACT"), "irrelevant image file");
  chmodSync(bin, 0o555);
  try {
    execFileSync("tar", ["-czf", path.join(base, "layer.tgz"), "-C", root, "."]);
    run(base, readFileSync(path.join(base, "layer.tgz")), bytes);
  } finally {
    chmodSync(bin, 0o755); rmSync(base, { recursive: true, force: true });
  }
}
describe("PostgREST provisioning works without extracting image permissions", () => {
  it("reads only the verified executable from a read-only-directory image", () => fixture((base, archive, binary) => {
    expect(postgrestFromLayer(archive, digest(archive))).toEqual(binary);
    expect(existsSync(path.join(base, "DO-NOT-EXTRACT"))).toBe(false);
  }));
  it("fails before extraction when digest differs", () => fixture((_base, archive) => {
    expect(() => postgrestFromLayer(archive, `sha256:${"0".repeat(64)}`)).toThrow("digest mismatch");
  }));
  it("ignores image layers that have no executable", () => fixture((base) => {
    execFileSync("tar", ["-czf", path.join(base, "empty.tgz"), "-C", path.join(base, "root"), "DO-NOT-EXTRACT"]);
    const archive = readFileSync(path.join(base, "empty.tgz"));
    expect(postgrestFromLayer(archive, digest(archive))).toBeNull();
  }));
  it("rejects non-executable image members", () => fixture((base) => {
    chmodSync(path.join(base, "root/bin"), 0o755);
    writeFileSync(path.join(base, "root/bin/postgrest"), "not an executable");
    execFileSync("tar", ["-czf", path.join(base, "bad.tgz"), "-C", path.join(base, "root"), "."]);
    const archive = readFileSync(path.join(base, "bad.tgz"));
    expect(() => postgrestFromLayer(archive, digest(archive))).toThrow("not an ELF");
  }));
});
