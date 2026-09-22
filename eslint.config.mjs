import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules — every rule below left "off" carries its justification.
    "@typescript-eslint/no-explicit-any": "off", // kept: internal fixture/envelope code relies on `any` at untyped engine boundaries; tightening is AUD-tracked, not silent
    "@typescript-eslint/no-unused-vars": ["warn", {
      // `_`-prefixed names are the documented intentionally-unused convention.
      "args": "all",
      "argsIgnorePattern": "^_",
      "varsIgnorePattern": "^_",
      "caughtErrors": "all",
      "caughtErrorsIgnorePattern": "^_"
    }], // AUD-5: re-enabled (warn) — TS-aware supersession of core no-unused-vars in .ts/.tsx
    "@typescript-eslint/no-non-null-assertion": "off", // kept: UI layer guards rendering invariants with `!` after explicit length/map checks; zero runtime faults observed in 576-test suite
    "@typescript-eslint/ban-ts-comment": "off", // kept: sandbox boundary needs `@ts-expect-error` for bun:test global augmentation (tests/bun-env.d.ts)
    "@typescript-eslint/prefer-as-const": "off", // kept: style-only; `as const` vs literal annotation is project convention, zero defect value
    "@typescript-eslint/no-unused-disable-directive": "off", // kept: rule name not valid for installed typescript-eslint version (would no-op or error); revisit on plugin upgrade

    // React rules
    "react-hooks/exhaustive-deps": "warn", // AUD-5: re-enabled (warn) — stale-closure bugs caught at lint time; remaining sites get per-site fixes or justifications
    "react-hooks/purity": "off", // kept: render-time reads of browser-local stores (localStorage-backed scan history) are deliberate; rule would flag the whole persistence layer
    "react/no-unescaped-entities": "off", // kept: product copy contains apostrophes in JSX literals; encoding them hurts copy review, zero XSS surface (React escapes text nodes)
    "react/display-name": "off", // kept: inline memo/forwardRef wrappers in one codebase are all statically nameable; false positives only
    "react/prop-types": "off", // kept: TypeScript types are the prop contract; runtime prop validation duplicates it
    "react-compiler/react-compiler": "off", // kept: React Compiler not enabled for this Next 16 app; rule noise with no build-time effect

    // Next.js rules
    "@next/next/no-img-element": "off", // kept: static brand/SVG assets only (no remote optimization benefit); next/image adds untyped config burden
    "@next/next/no-html-link-for-pages": "off", // kept: SPA uses in-app view switching, not Next route links; rule fires on intentional anchors

    // General JavaScript rules
    "prefer-const": "error", // AUD-5: re-enabled
    "no-unused-vars": "off", // superseded by @typescript-eslint/no-unused-vars (warn) — core rule double-reports in TS files
    "no-console": "off", // kept: server routes + engine bridge log diagnostics intentionally (client bundles verified free of stray console)
    "no-debugger": "error", // AUD-5: re-enabled — a `debugger` statement must fail the gate
    "no-empty": "off", // kept: deliberate empty catch blocks around optional browser-API probes (documented at each site)
    "no-irregular-whitespace": "off", // kept: copy/tables use non-breaking spaces intentionally in UI strings
    "no-case-declarations": "off", // kept: engine-surface switch statements use blockless cases with local bindings; read-only and tested
    "no-fallthrough": "off", // kept: same switch cluster as no-case-declarations; intentional grouped fallthrough in flavor matching
    "no-mixed-spaces-and-tabs": "off", // kept: prettier-style formatting enforced by repo convention; zero occurrences today
    "no-redeclare": "off", // kept: superseded by TS compiler (error TS2451); eslint duplicate would be noise
    "no-undef": "off", // kept: TS handles undefined-global detection; rule false-positives on bun:test globals in .test.ts
    "no-unreachable": "off", // kept: TS unreachable-code analysis active; belt-and-braces duplicate
    "no-useless-escape": "off", // kept: regex literals in telemetry redaction keep defensive escapes for shared string-building paths
  },
}, {
  // Sandbox-only and non-product directories: file discovery must never
  // descend into these. upload/ is a FUSE mount that can hold arbitrary
  // user files and may be an unhealthy mount (a walk would hang the gate).
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "upload/**", "mini-services/**", "engine/**", "db/**", "public/**"]
}];

export default eslintConfig;
