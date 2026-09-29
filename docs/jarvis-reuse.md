# Reusing Jarvis in TellUmo

Inspected September 29, 2026 with the repository owner's permission. Reference runtime: `zemdregon/jarvis-orchestrator` commit `aeb9c6eb947cb062d7c5c70ced78d4da34e7f3b7`. The reference checkout is separate from this repository; no Jarvis credential or runtime configuration was copied.

## Adapted now

`src/provider-response.ts` ports selected checks from `internal/modelgateway/go.go`, `local.go`, and `rejection.go` into the existing TypeScript provider boundary:

- Reject an explicitly different model identity or a non-assistant message.
- Reject tool/function output at the current text-only boundary.
- Keep reasoning output separate from answer text.
- Reject an answer that echoes the provider credential before persistence or display.
- Bound answer bytes and expose fixed diagnostic categories instead of upstream errors or envelopes.

The port supports both Chat Completions and Responses. It permits omitted model/role metadata for compatible gateways; Jarvis requires those fields. It uses TellUmo's selected Muse model rather than Jarvis's LongCat profile. Jarvis's Go-specific transport and temporary free-model authorization settings are not copied.

`tests/ai.mjs` exercises model mismatch, unexpected tools, credential echo, invalid role and timeout diagnostics in addition to both provider protocols. Provider failure logs contain only the operation UUID, a fixed kind/reason and elapsed milliseconds.

## Recovery design reused

Jarvis's `DURABLE-GENERATION.md` and `internal/codingjob` distinguish recorded intent, accepted result and uncertain outcome. TellUmo follows the same boundary using D1: reserve usage, persist the pending turn, atomically claim dispatch, then call the provider once. Persist answer and token usage before settlement. Readback can settle a retained result without inference. Unknown outcomes retain their hold; neither browser replay nor reconciliation sends another provider request.

This is adaptation of the state machine, not a transplant of the Go/Postgres scheduler. TellUmo does not yet have Jarvis's worker leases, full immutable artifact receipts, contained execution or code publication recovery.

## Next useful ports for site building

- `internal/codeproposal`: bounded source inventory, structured proposed edits, exact source/edit scope validation and separate validation feedback. Generate a candidate before granting publication authority.
- `internal/repopath/path.go`: portable path validation rejecting traversal, Git metadata aliases and reserved device names. Apply at artifact ingestion and again at publication.
- `internal/codingjob` and `internal/actiongateway`: immutable generation intent/result and separate publication records. A generated candidate is not evidence that tests or deployment succeeded.

These are implementation references, not delivered site-generation features. The Linux contained runner and local model infrastructure do not fit the current free Cloudflare deployment and are not provisioned.
