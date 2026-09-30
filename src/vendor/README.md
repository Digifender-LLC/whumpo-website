# Pinned EmDash WXR parser

`emdash-wxr.ts` is an unchanged copy of `emdash@1.0.1/src/cli/wxr/parser.ts`, licensed under the adjacent MIT license. Upstream SHA-256: `29e55df20878bc39cc783810dc0387aeb08b219f2398237d4f313f8b3dc698aa`.

Only `parseWxrString` is imported by the Worker. The upstream package does not expose a standalone runtime subpath for this parser; vendoring this module avoids bringing its CMS/plugin/server entry point into the control Worker. Review updates against the pinned native artifact. `tests/cms-wordpress-runtime.mjs` checks exact source identity. Do not hand-edit the parser; put Whumpo policy and limits in `src/cms-wordpress-analysis.ts`.
