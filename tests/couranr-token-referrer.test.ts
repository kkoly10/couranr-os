import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../next.config.js") as { headers(): Promise<Array<{
  source: string;
  headers: Array<{ key: string; value: string }>;
}>> };

describe("public bearer-capability pages", () => {
  it("never forward the token path in a Referer header", async () => {
    const rules = await config.headers();
    for (const source of ["/help/:token", "/track/:token"]) {
      expect(rules.find((rule) => rule.source === source)?.headers).toContainEqual({
        key: "Referrer-Policy",
        value: "no-referrer",
      });
    }
  });
});
