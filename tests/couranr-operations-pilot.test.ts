import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { navigationFor } from "@/lib/couranr/navigation";
import { CANONICAL_SCREENS } from "@/lib/couranr/screens";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("pilot Operations console", () => {
  it("does not expose placeholder-only Operations destinations in navigation", () => {
    const ids = new Set(navigationFor("operations").map((item) => item.screenId));
    const placeholderIds = CANONICAL_SCREENS
      .filter(
        (screen) =>
          screen.group === "operations" &&
          (screen.status === "placeholder_only" || screen.status === "missing")
      )
      .map((screen) => screen.id);

    for (const id of placeholderIds) expect(ids.has(id)).toBe(false);
    expect(ids.has("OPS-001")).toBe(true);
    expect(ids.has("OPS-002")).toBe(true);
  });

  it("replaces the OPS-001 placeholder with the live pilot dashboard", () => {
    const source = read("app/(couranr)/operations/page.tsx");
    expect(source).toContain("OperationsPilotDashboard");
    expect(source).not.toContain("ScreenPlaceholder");
  });

  it("gives OPS-002 distinct phone cards and a desktop operational worklist", () => {
    const source = read("components/couranr/requests/OperationsQueue.tsx");
    const css = read("app/(couranr)/couranr.css");

    expect(source).toContain('className="cr-ops-queue__mobile"');
    expect(source).toContain('className="cr-ops-queue__desktop"');
    expect(source).toContain('className="cr-ops-queue-card"');
    expect(source).toContain('className="cr-ops-worklist"');
    expect(source).not.toContain("<TableScroll>");
    expect(css).toContain(".cr-ops-worklist__row");
    expect(css).toMatch(/@media \(min-width: 960px\)[\s\S]*\.cr-ops-queue__mobile\s*\{\s*display:\s*none;/);
  });

  it("opens the canonical OPS-003 workbench after begin-review succeeds", () => {
    const source = read("components/couranr/requests/OperationsQueue.tsx");

    expect(source).toContain("const router = useRouter()");
    expect(source).toContain(
      'router.push(`/operations/deliveries/${r.value.request.id}`)'
    );
    expect(source).toContain("disabled={busy}");
    expect(source).toContain("Review delivery");
  });
});
