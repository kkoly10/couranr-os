import { describe, expect, it } from "vitest";
import { parseBusinessAccountId } from "@/lib/businessAccount";

describe("parseBusinessAccountId", () => {
  it("accepts a valid uuid", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(parseBusinessAccountId(id)).toBe(id);
  });

  it("trims whitespace around a valid uuid", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(parseBusinessAccountId(`  ${id}  `)).toBe(id);
  });

  it("returns null for invalid ids", () => {
    expect(parseBusinessAccountId("not-a-uuid")).toBeNull();
    expect(parseBusinessAccountId("")).toBeNull();
    expect(parseBusinessAccountId(null)).toBeNull();
    expect(parseBusinessAccountId(undefined)).toBeNull();
  });
});