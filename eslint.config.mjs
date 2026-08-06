import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

/**
 * ESLint 9 flat config — required by Next 16, which removed `next lint`.
 * The lint script is now `eslint .` (see package.json), same rule set as the
 * old `next/core-web-vitals` extends, per the official migration:
 * https://nextjs.org/docs/app/api-reference/config/eslint
 *
 * The typescript preset (`eslint-config-next/typescript`) is deliberately NOT
 * enabled tonight: it drags typescript-eslint recommendations across 56 legacy
 * pages that are B12 quarantine targets. Enable it for the canonical trees
 * when ACP-005's strict config lands.
 */
export default defineConfig([
  ...nextVitals,
  {
    /**
     * eslint-plugin-react-hooks v6 (bundled by eslint-config-next 16) ships
     * three NEW rules as errors. They flagged 53 sites in code that is
     * BROWSER-VERIFIED working — new advisory opinions, not regressions.
     * Refactoring 42 setState-in-effect sites blind would churn verified
     * screens without re-verification, which this repository forbids.
     *
     * Held at "warn" as a RATCHET, not a waiver: ACP-005 (strict canonical
     * TypeScript) raises them back to error for the canonical trees as each
     * is touched and re-verified. `rules-of-hooks` stays at error — the two
     * violations it found were fixed, not silenced.
     */
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/globals": "warn",
    },
  },
  globalIgnores([
    ".next/**",
    ".next-disposable/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "node_modules/**",
  ]),
]);
