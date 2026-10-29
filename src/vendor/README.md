# Pinned EmDash WXR parser

`emdash-wxr.ts` is an unchanged copy of `emdash@1.3.0/src/cli/wxr/parser.ts`, licensed under the adjacent MIT license. Upstream SHA-256: `8d4c6c263cbdbdcc3fa668b5ec7a01fab7171046576e95ec0ef4ac4ee6cab4a0`.

Only `parseWxrString` is imported by the Worker. The upstream package does not expose a standalone runtime subpath for this parser; vendoring this module avoids bringing its CMS/plugin/server entry point into the control Worker. Review updates against the pinned native artifact. `tests/cms-wordpress-runtime.mjs` checks exact source identity. Do not hand-edit the parser; put Whumpo policy and limits in `src/cms-wordpress-analysis.ts`.
