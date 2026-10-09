# Customer presentation: design, composition and custom components

**Planned contract — WH-070 slice WH-161, October 8, 2026 UTC; source baseline `d3ebaf2`, re-checked on `4dea09c` on October 9, 2026 UTC.** Between the two, WH-050 (#186) added the operator serving stop: on a stopped project the visitor gateway refuses module calls, configuration and execution (only the visitor's own account, data, export and deletion routes stay) and guest previews stop. The visitor host CSP, `POST /modules` origin rules and guest framing cited below are unchanged. This freezes how distinctive customer sites and portals vary their presentation while reusing the same maintained [WH-067 module APIs](shared-modules.md). It defines three extension levels with versioned shapes, the frontend/backend contract and scoped API client, the custom-component isolation boundary, focused owner maintenance and how visual diversity and accessibility are evaluated separately from functional reuse. It then splits [WH-070](roadmap/backlog.md#wh-070--separate-visual-customization-from-maintained-backend-behavior) into WH-161–167.

Nothing here is implemented. No specification schema, compiler identity, catalog entry, route, table, binding, Worker change, dependency or Cloudflare resource is added, and nothing is deployed. The [offline reference](../tools/prototypes/customer-presentation.mjs) and its [conformance checks](../tests/customer-presentation-contract.mjs) exercise the frozen shapes, static checks and change classification with invented data. No Worker imports them. They do not prove a renderer, a browser sandbox, CSP enforcement, rendered accessibility or runtime authorization.

It consumes, and does not replace: the [WH-064/066 specification and compiler](project-specification.md), the [WH-067 module contract](shared-modules.md) (request envelope, principals, policy table, hosts), [WH-071 logical resources](workload-placement.md), the [controlled visitor host](app-data.md#controlled-visitor-pages-migration-0057), [guest preview framing](guest-previews.md), [service-client compilation](project-service-clients.md), [content safety coverage](safety-coverage.md) and the [current-version policy](current-version-policy.md). The owner Chat/view renderer stays in [WH-107](chat-renderer-acceptance.md)/[WH-109](workspace-views.md).

## Decision

1. **Three extension levels, smallest first.** Level 1 changes design tokens. Level 2 composes maintained `presentation-kit@1` components into surfaces. Level 3 adds a small custom frontend component only where levels 1–2 cannot express the need. Each level has a frozen v1 shape and fails closed on unknown fields or versions.
2. **The specification records presentation separately from modules.** A new top-level `presentation` section (proposed specification schema 4, WH-162) pins the maintained kit and an optional template. It also declares its module dependencies in `presentation.uses`. Module instances, with their own pins and configuration, stay in `instances`. A presentation operation can never edit an instance, its pins or its activation `configRevision`.
3. **Presentation consumes only WH-067 module operations.** It uses the same-origin `whumpo-modules` v1 envelope on the project's visitor origin. It brings no authentication, sessions, storage, handlers, SQL, outbound network, inference transport or platform credentials. The module API derives the principal and decides every request, so a presentation cannot widen a permission. It can only refuse early when a placement would mislead.
4. **Custom code runs in an opaque-origin sandboxed frame.** A level-3 component is served as its own document with a CSP `sandbox allow-scripts` header (no `allow-same-origin`) and `connect-src 'none'`. It reaches modules only through a platform-authored host bridge, and only for the exact operations it declared. The hosting option and model-produced custom script both need owner acceptance first (decisions [1](#open-owner-decisions) and [3](#open-owner-decisions)).
5. **Reuse the gates.** The existing gates for private no-store preview, exact owner review and the visitor host CSP still apply, and so do the module activation reviews, content checks and publication rules. Presentation adds its own exact publication review. It replaces none of the existing ones.

## Three extension levels

| Level | What the owner gets | Frozen shape | Who writes code |
| --- | --- | --- | --- |
| 1. Design configuration | Palette, typography, shape, density and motion across all surfaces | `presentation.design` (below) compiled to CSS custom properties | Nobody: closed tokens only |
| 2. Component composition | Surfaces (pages) built from maintained navigation, text, forms, lists, record editors, galleries, uploads, directory and account components, with layout and interaction variants | `presentation.surfaces[].regions[].placements[]` over `presentation-kit@1` | Platform-maintained kit only |
| 3. Small custom frontend component | A missing visual interaction, such as a before/after slider, that no kit variant covers | `presentation.components[]` declaration + separate private artifact `{script, style}` | Generated or written for one project, reviewed, sandboxed |

The planner chooses the lowest level that satisfies the request (WH-065). Level 3 needs a recorded reason that levels 1–2 are insufficient, as the [composition strategy](roadmap/composition-architecture.md#3-compose-rich-interfaces-without-rewriting-the-backend) requires.

## Specification placement — proposed schema 4

Schema 4 adds one top-level key, `presentation`, to the [current schema 3](project-specification.md#specification-v3). It is `null` when the project has no visitor-origin composition. Website `pages`, `design.theme` and the `site-page@1`/`photo-page@1` renderers stay unchanged in v1. Extending tokens to the website renderer would need a new component identity (`site-page@2`) and is not part of this contract. Under the [current-version policy](current-version-policy.md), schema 4 replaces schema 3 by a direct compiler identity cutover with reset schema-3 test specifications, the way [WH-124](shared-modules.md#specification-schema-3-delivery-wh-124--october-4-2026-utc) did. There is no schema-3 reader.

```json
{
  "contractVersion": 1,
  "kit": {"name": "presentation-kit", "version": 1, "digest": "<SHA-256 from the trusted presentation catalog>"},
  "template": {"name": "portal-classic", "version": 1, "digest": "<SHA-256>"},
  "design": {
    "palette": {"ink": "#123f4e", "paper": "#f3f9f9", "accent": "#0b5c66", "onAccent": "#ffffff", "muted": "#3d5560"},
    "typography": {"heading": "serif", "body": "sans", "scale": "regular"},
    "shape": {"radius": "small", "density": "comfortable"},
    "motion": "subtle"
  },
  "uses": [
    {"instanceId": "bookings", "operations": ["forms.submit", "records.update", "records.view"]},
    {"instanceId": "media", "operations": ["files.gallery", "files.putBytes"]}
  ],
  "surfaces": [
    {"id": "desk", "path": "/desk", "audience": "staff", "title": "staff-title", "regions": [
      {"id": "body", "landmark": "main", "placements": [
        {"id": "title", "component": "heading@1", "binding": null, "props": {"text": "staff-title", "level": 1}},
        {"id": "queue", "component": "record-list@1",
         "binding": {"instanceId": "bookings", "operation": "records.view", "target": {"viewId": "queue"}},
         "props": {"layout": "cards", "columns": ["name", "vehicle", "status"]}}
      ]}
    ]}
  ],
  "components": []
}
```

These identity families are recorded separately, which satisfies WH-070's "templates and maintained module dependencies are identified separately" criterion:

| Identity | Where | Resolved from | Changing it |
| --- | --- | --- | --- |
| Maintained kit (`presentation-kit@1`) | `presentation.kit` | Trusted presentation catalog, exact digest | Kit cutover (WH-076 governance); `template` review class |
| Template (optional starting composition) | `presentation.template` | Trusted presentation catalog, `available` only | `template` review class; reported separately |
| Module instances and their module/schema pins | `instances` (schema 3, unchanged) | Trusted `moduleCatalog` | Only `modules.put`/`records.addField`/`modules.remove` with their [WH-124 classification](shared-modules.md#versions-and-migration-hooks-under-the-current-version-only-rule) |
| Module dependencies of the presentation | `presentation.uses` (instance id + operations) | Must exactly equal the operations its placements and components bind | `dependencies` review class; reported separately |
| Custom component artifacts | `presentation.components[].artifact.digest` | Private immutable artifact store (WH-165) | `custom-component` review class |

The template is provenance and a starting point, not a runtime dependency. The saved surfaces are the materialized composition. Changing the template re-pins provenance; it never silently rewrites saved surfaces or instances.

**Bounds.** The presentation is at most 12 KiB canonical JSON, inside the existing 32 KiB whole-specification ceiling. WH-162 decides whether schema 4 raises that ceiling. Limits: up to 8 surfaces, 4 regions per surface, 12 placements per region and 48 in total, 8 navigation items, 4 custom components with up to 6 module uses each, 8 `uses` entries. Custom component bytes are stored outside the specification.

### Level 1 — design configuration v1

| Token | Values | Notes |
| --- | --- | --- |
| `palette.ink/paper/accent/onAccent/muted` | `#rrggbb` lowercase | Configuration-time contrast floor ([WCAG 2.2](https://www.w3.org/TR/WCAG22/)): ink/paper and muted/paper ≥ 4.5:1 ([SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)), onAccent/accent ≥ 4.5:1, accent/paper ≥ 3:1 ([SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)). Fails `CONTRAST_INSUFFICIENT`. |
| `typography.heading` | `serif`, `sans`, `slab`, `rounded`, `mono` | System font stacks only. No font URL, `@font-face` or remote stylesheet; no network request is added. |
| `typography.body` / `scale` | `sans`, `serif`, `rounded` / `compact`, `regular`, `large` | |
| `shape.radius` / `shape.density` | `none`, `small`, `large` / `compact`, `comfortable` | |
| `motion` | `none`, `subtle` | `prefers-reduced-motion: reduce` always forces zero motion. |

The design compiles deterministically to a same-origin stylesheet of `--wp-*` [CSS custom properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables/Using_custom_properties). It is never inline style, because the visitor host forbids inline styles. There is no free-form CSS, selector, URL or class name. Customer tokens are distinct from Whumpo's own [platform design system](design/README.md), which styles the owner workspace.

### Level 2 — component composition over `presentation-kit@1`

A surface is `{id, path, audience: public | visitor | staff, title, regions}`. Its path is `/` or one lowercase slug; module, kit and asset paths are reserved. A region is `{id, landmark: header | navigation | main | complementary | contentinfo, placements}`. A placement is `{id, component, binding, props}`. Every text prop references a `content` record of the same specification, so text is data, never markup.

| Component | Bound operation (static target) | Props (closed) |
| --- | --- | --- |
| `heading@1` | — | `text`, `level: 1-3` |
| `text@1` | — | `text` |
| `navigation@1` | — | `style: top-bar \| side-rail \| tabs`, `items[1..8]: {surfaceId, label}` |
| `record-form@1` | `forms.submit` (`formId`) | `layout: stacked \| two-column`, `submitLabel` |
| `record-list@1` | `records.view` (`viewId`) | `layout: table \| cards \| list`, `columns` ⊆ the view's fields |
| `record-detail@1` | `records.get` (`recordId`) | `fields` ⊆ fields the surface audience may read |
| `record-editor@1` | `records.update` (`recordId`) | `fields` ⊆ `staffWrite` |
| `gallery@1` | `files.gallery` (`collectionId`) | `interaction: grid \| carousel \| lightbox \| masonry`, `columns: 2-4` |
| `upload@1` | `files.putBytes` (`collectionId`) | `label` |
| `directory@1` | `collections.readPublic` (`collectionId`) | `layout: list \| cards` |
| `account@1` | `access.me` (no target) | — (embeds the platform account/sign-in surface) |
| `custom@1` | — | `componentId` (a level-3 component) |

Kit components are platform-authored code served from the visitor origin like today's [`public-app/`](../public-app/index.html) shell. Typography, navigation style, list layout and gallery interaction are props, so a different look never needs a different backend.

**Static structure checks.** A binding's operation must equal its component's operation (`COMPONENT_BINDING_MISMATCH`). The target must name an existing form, view, schema or collection of that instance. The surface audience must be able to perform the operation under the frozen [policy table](shared-modules.md#authorization-model) (`AUDIENCE_EXCEEDS_POLICY`): for example, a staff view on a public surface, or a staff gallery on a visitor surface. Visitor and staff surfaces need the project's access instance, and staff surfaces need its `staff` role (`MISSING_DEPENDENCY`). Each surface has exactly one `main` landmark and one level-1 heading (`ACCESSIBILITY_REQUIRED`). The reference cross-checks this audience projection against the shared-modules policy table for every fixture case. The module API still decides every request.

### Level 3 — custom component v1

```json
{
  "id": "before-after", "contractVersion": 1, "revision": 1,
  "artifact": {"digest": "<SHA-256 of canonical {script, style}>", "scriptBytes": 412, "styleBytes": 98},
  "capabilities": ["modules"],
  "uses": [{"alias": "photos", "instanceId": "media", "operation": "files.gallery", "target": {"collectionId": "my-photos"}}],
  "accessibility": {"name": "compare-name", "role": "figure", "keyboard": "operable", "focusVisible": true,
                    "reducedMotion": "respected", "textAlternatives": "provided", "minTargetPx": 24},
  "frame": {"minHeight": 240, "maxHeight": 900}
}
```

- **Capabilities** are a closed allowlist containing only `modules`. Declaring network, storage, cookies, credentials, auth, inference, popups, same-origin, device or any unknown capability, as a list entry or as a key, fails `FORBIDDEN_CAPABILITY`.
- **Uses** name exact `(instance, operation, static target)` tuples behind local aliases. Reads are allowed where the surface audience allows them. The only v1 write is `forms.submit` (`CUSTOM_WRITE_FORBIDDEN` otherwise; decision 2). Owner operations (`records.remove`, `files.requestRemoval`, `access.list`, role reviews) are never presentable (`OPERATION_NOT_PRESENTABLE`).
- **No backend.** `handler`, `backend`, `server`, `function`, `source`, `endpoint`, `url`, `route`, `database`, `schema`, `config` or `fork` fail `BACKEND_FORBIDDEN`. Principal, role, permission, grant, credential, token, session or storage-location keys fail `AUTHORITY_FIELD`.
- **Artifact** `{script, style}` is a separate private immutable object. The script is at most 16 KiB and the style at most 8 KiB, both UTF-8 (`TOO_LARGE`). The digest and byte counts must equal the declaration (`DIGEST_MISMATCH`). The [static checks](#static-content-checks) must pass.
- **Accessibility declaration is mandatory** (`ACCESSIBILITY_REQUIRED` when absent or weaker). It covers an accessible name (a content reference used as the iframe `title`), a role, keyboard operability, a visible focus indicator, honoring reduced motion, text alternatives, and pointer targets of at least 24 CSS px ([SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)). These are reviewed claims; WH-167 verifies them in a browser.
- A declared component that is never placed fails `UNUSED_COMPONENT`. A component use that the presentation does not declare in `uses` fails `UNDECLARED_DEPENDENCY`.

## Frontend/backend contract and scoped API client

Customer presentation is a client of the [whumpo-modules v1 request envelope](shared-modules.md#request-envelope) and nothing else:

| Contract element | Frozen rule |
| --- | --- |
| Host | The project visitor origin `https://app-PROJECT.whumpo.site` only. The compiled assets and the `POST /modules` and `POST /modules/upload` calls are same-origin, with `credentials: 'same-origin'` and no CORS. The existing gateway exact-Origin and `sec-fetch-site` checks ([app-gateway.ts](../src/app-gateway.ts)) still apply. |
| Presentable operations | `forms.submit`, `records.view`, `records.get`, `records.update`, `files.putBytes`, `files.read`, `files.gallery`, `access.me`, `collections.readPublic`. Owner operations stay on the workspace origin. |
| Static versus runtime target and input | The specification fixes the static target (`formId`, `viewId`, `recordId`, `collectionId`). At runtime the client adds only the operation's runtime target keys: `cursor` (`records.view`, which requires the key on every request, `null` for the first page), `entryId` (`records.get`), `entryId`/`revision`/`changes` (`records.update`) and `fileId` (`files.read`). Two operations also carry an `input` payload: `forms.submit` sends `input: {values}` keyed by the form's fields ([records.ts](../src/shared-modules/records.ts)), and `files.putBytes` sends `input: {mediaType, byteLength, sha256}` describing the JPEG body of `POST /modules/upload` ([files.ts](../src/shared-modules/files.ts)). Every other presentable operation sends `input: null`. |
| Compiled client manifest | Deterministic. It binds the kit, template, design CSS, surfaces and, for each used instance only, its public `resourceId` and current `configRevision` from the server registry. When any used instance advances `configRevision`, the manifest is stale (`STALE_CONFIGURATION`). It is recompiled and re-reviewed, never silently retargeted. |
| Never in presentation | Project, owner, visitor or role identifiers; approvals; storage paths, prefixes or buckets; SQL; outbound URLs; session handling; credential or recovery collection; model or inference endpoints; platform keys. These are rejected in configuration, in bindings and again by the shared envelope check. |

The principal always comes from the project's HttpOnly visitor cookie on the receiving side. The [WH-130 compositions](shared-modules.md#connected-acceptance-two-frontend-compositions-wh-130--october-4-2026-utc) already show two frontends sharing one contract. WH-070 turns that into a served, specified product surface.

## Custom component boundary

### Hosting and isolation

The recommended option (decision 1) reuses the [guest preview pattern](../src/guest-previews/guest.ts), in which a hashed shell frames a sandboxed same-origin document:

- The surface page stays platform-authored. Only on surfaces that place a custom component, its CSP adds `frame-src 'self'` to the current visitor host policy (`src/app-host.ts`). Nothing else changes.
- The component document is served at a reserved same-origin path keyed by artifact digest. It is framed with `<iframe sandbox="allow-scripts" title="…" referrerpolicy="no-referrer" allow="">` and returned with these headers:

```text
Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src 'sha256-<bootstrap>' 'sha256-<component>';
  style-src 'sha256-<style>'; img-src blob:; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none';
  worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self';
  require-trusted-types-for 'script'; trusted-types 'none'
X-Frame-Options: SAMEORIGIN; Cache-Control: private, no-store; Cross-Origin-Resource-Policy: same-origin;
Referrer-Policy: no-referrer; X-Content-Type-Options: nosniff; Permissions-Policy: camera=(), microphone=(), …
```

- Without `allow-same-origin`, the document gets an opaque origin that ["always fails the same-origin policy"](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe) (MDN, retrieved October 8, 2026). It cannot read the visitor cookie or browser storage, and a request it made would carry `Origin: null`, which the gateway refuses. The [CSP `sandbox` directive](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox) applies the same sandbox when the document is opened directly; it is ignored in `<meta>`, so it must be a response header. `connect-src 'none'` removes fetch, XHR, WebSocket and beacons. There are no popups, top navigation or forms.
- **Bridge (frame API v1).** A platform bootstrap script inside the frame exposes `whumpo.call(alias, {target, input})`, `whumpo.props` (resolved content text), `whumpo.tokens` and `whumpo.resize(height)`, bounded by `frame`. The host page accepts messages only from that iframe's `contentWindow`, following the [`postMessage` guidance](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage). The host owns `api`, `version`, `operation`, `resourceId`, `configRevision` and the write `requestId`; a message that sets them fails `BRIDGE_FIELD`. It merges only runtime target keys, and the result must still pass the shared envelope check before the host sends the same-origin POST. Results go back as JSON data. Approved image bytes go back as bytes, which the frame shows through its own `blob:` URL.
- `require-trusted-types-for 'script'` turns string-to-DOM sinks into errors. Trusted Types is ["Baseline 2026"](https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API) (MDN, retrieved October 8, 2026), so older browsers fall back to the static `html-sink` check below. This matters because displayed record values must never become markup that drives the bridge as the signed-in visitor.

**Residual risks (stated, not solved).** CSP is a mitigation, not a complete exfiltration barrier. Visual, timing and resource-hint channels exist, and the CSP3 draft is still a [W3C Working Draft](https://www.w3.org/TR/CSP3/). A component can show misleading content inside its own frame. Publication review and the frame's bounded size limit, but do not remove, that risk. `whumpo.site` is **not** on the [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat) (checked October 8, 2026). Every `*.whumpo.site` host is therefore same-site, so isolation relies on exact Origin checks, host-only `__Host-` cookies and the opaque sandbox, not on `SameSite`. Browser behavior of sandboxed same-origin frames under the current visitor CSP has **not** been verified and is part of WH-165 acceptance.

### Static content checks

These are defense in depth and keep review noise down. The enforced boundary is the sandbox and CSP above. A match fails closed with `DISALLOWED_CONTENT`, even inside comments or strings.

| Rule | Script refuses | Style refuses |
| --- | --- | --- |
| network | `fetch`, XHR, WebSocket, EventSource, WebTransport, RTCPeerConnection, `sendBeacon`, `importScripts` | `@import`, `url(`, `image-set(`, `@font-face` |
| dynamic-code | `eval`, `Function(`, dynamic/static `import`/`export`, WebAssembly, string timers | `expression(`, `behavior:`, `-moz-binding`, `javascript:` |
| storage / credentials | Web storage, IndexedDB, Cache, `document.cookie`, `navigator.credentials`, `PublicKeyCredential`, `Authorization`, API keys | — |
| frame-escape | `parent`/`top`/`opener`/`frames` access, `postMessage` (the bootstrap owns it), `location` writes, `window.open` | `</style>`, `<script` |
| html-sink | `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `DOMParser`, `createContextualFragment`, `srcdoc` | — |
| workers / device | Workers, service workers, geolocation, media devices, clipboard, USB/serial/HID/Bluetooth, Notification, PaymentRequest | — |
| inference / platform | Model or provider names and `ai.run`; `/modules`, `/api/`, `whumpo.com`/`whumpo.site` | — |
| absolute-url / hidden | Any `scheme://` and quoted `javascript:`/`data:`/`blob:` URLs; control or bidirectional-override characters in either file | |

## Change classification, reviews and gates

`classifySpecificationChange` reports module and presentation changes separately:

| Change | Instances / pins / `configRevision` | Review classes |
| --- | --- | --- |
| Tokens, navigation style, layout, gallery interaction, copy references, surface structure | Untouched | `presentation` |
| Template or kit re-pin | Untouched | `presentation`, `template` |
| Add or remove a bound operation or instance in `uses` | Untouched | `presentation`, `dependencies` |
| Add or change a custom component | Untouched | `presentation`, `custom-component` (plus `dependencies` if `uses` changes) |
| Any instance change | Changed through WH-124 operations only | `modules`. Presentation operations refuse it with `PRESENTATION_CANNOT_CHANGE_MODULES`. |
| New instance duplicating an existing instance's kind and configuration, ignoring ids/labels | — | Refused: `FORK_FOR_PRESENTATION`. Reuse the instance and vary presentation. |

The proposed presentation operations are `presentation.setDesign`, `setTemplate`, `setUses`, `putSurface`, `removeSurface`, `putComponent` and `removeComponent`. They join the existing [operation protocol](project-specification.md#operation-protocol), with expected revision, immutable diff, preview and exact approval.

**Gates reused, none relaxed:**

- **Preview.** Compiled surfaces render privately with the existing private no-store, sandboxed preview headers. Preview module calls use synthetic fixture responses. The owner never acts as a visitor principal, and a preview never calls live module APIs with the owner session. Custom components preview inside the same frame boundary with a stub bridge.
- **Publication.** A new exact owner presentation publication review (WH-164) binds the specification version and digest, manifest digest, artifact digests and each used instance's `resourceId`/`configRevision` and activation state. Like the [visitor page review](app-data.md#controlled-visitor-pages-migration-0057), a later configuration, activation or authority change hides the composition until it is reviewed again. Module activation reviews, the website publication review and the public form/Turnstile admission stay separate and unchanged.
- **Content checks.** Owner text stays plain text through the existing validators. Uploaded media keeps the [quarantine/approval gate](photos.md#mandatory-project-photo-safety-gate--september-30-2026). Visitor-submitted text remains a recorded [safety gap](safety-coverage.md#mounted-path-inventory): S12 for visitor application state, S13a for WH-127 module record submissions (`forms.submit`, `records.update`), which a composition's forms and editors use, and S13 for contact submissions. Custom components add the static checks, review summary and digest binding above.
- **No maintainer inference while serving.** Rendering, bridging and refreshing call no model, as [WH-073](roadmap/backlog.md#wh-073--serve-published-content-and-standard-actions-without-maintenance-inference) requires. Custom component source never runs in the control Worker or QuickJS. It runs only in visitors' browsers, inside the frame.

## Owner-maintenance focused edits

`focusedEditContext` defines what the owner-maintenance agent may load for one target:

- **A custom component:** its declaration, **its own** artifact bytes, a projection of the contracts it uses (field keys/labels/types for its form or view; media type and size for its collection), the design tokens and the kit version.
- **A placement:** that placement, its surface's id, path and audience, and its bound operation contract.
- **Never:** other components' source, unrelated surfaces or instances, registry internals (`resourceId`, `configRevision`), owner-only fields, visitor-submitted values, credentials or other projects' data.

`assertFocusedEdit` requires every other part of the presentation, including `uses`, to stay byte-identical (`UNFOCUSED_EDIT`). A dependency change is a separate reviewed change. The agent proposes edits through the specification operations; it cannot confirm. Today's [`/design-app-page`](../src/app-page-design.ts) single-call pattern is the precedent for a bounded, read-scoped design prompt. Whether the site agent advertises presentation operations is an open owner decision (below) tied to WH-067 [acceptance gap 6](shared-modules.md#wh-067-acceptance-map--october-4-2026-utc).

## Evaluating visual diversity and accessibility independently of functional reuse

| Track | Measures | Must not depend on |
| --- | --- | --- |
| Functional reuse | `apiFootprint` (the exact `instance:operation:target` set) and a conformance table of policy decisions per principal. Three different compositions must produce identical tables. WH-167 repeats this against the actual handlers over HTTP. | Tokens, layout, template |
| Visual diversity | `presentationFingerprint` (template, tokens and layout structure, excluding bindings), token distance, and owner-inspected screenshots at 360/390 px and desktop | Bindings, `uses` |
| Accessibility | `accessibilityReport` (computed contrast, landmark/heading structure, component declarations). WH-167 adds browser keyboard, focus, screen-reader, target-size, reduced-motion and zoom checks. | Bindings, `uses` |

A composition can pass functional conformance and still fail accessibility, or the reverse. Each result is reported on its own. An attractive preview is not evidence of correct authorization or data handling.

## Separation from the owner Chat/view renderer (WH-107/109)

| | Customer presentation (WH-070) | Owner Chat/views (WH-107/109) |
| --- | --- | --- |
| Audience and origin | Visitors and staff on `app-PROJECT.whumpo.site` | The signed-in owner on the workspace origin |
| Renderer | `presentation-kit@1` plus sandboxed custom components | React workspace ([chat interactions](chat-interactions.md), [workspace views](workspace-views.md)) |
| Data access | WH-067 visitor/staff/public operations through the visitor gateway | Owner bindings (`records.summary@1`, `access.roles@1`, …) through workspace admission |
| Shared | The module domain handlers and policy table | Same |
| Never shared | Sessions, cookies, origins, component code, credentials, maintainer context, design tokens (customer tokens versus the Whumpo design system) | Same |

Neither renderer forks backend authority. A customer surface never renders owner Chat, and owner views never render customer custom components.

## Mapping to existing mechanisms and exact gaps

| Need | Existing mechanism (source) | Gap closed by |
| --- | --- | --- |
| Design configuration | Three themes in `site-page@1`/`photo-page@1` ([components.ts](../src/components.ts)); no visitor-origin theming | Tokens in the specification: WH-162; CSS compile: WH-163 |
| Composition | Fixed website pages; single generic visitor app page ([app page reviews](app-data.md#controlled-visitor-pages-migration-0057), [`public-app/`](../public-app/index.html)); unserved [WH-130 fixtures](../tests/fixtures/module-compositions/staff-portal.mjs) | Kit vocabulary and compiler: WH-163; serving: WH-164 |
| Scoped API client | whumpo-modules v1, `POST /modules` and `/modules/upload` with exact Origin ([app-gateway.ts](../src/app-gateway.ts)) | Compiled manifest client: WH-163; bridge: WH-165 |
| Isolation / CSP | Visitor host `script-src 'self'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY` ([app-host.ts](../src/app-host.ts)); sandboxed previews and guest framing ([guest.ts](../src/guest-previews/guest.ts)) | Per-surface `frame-src 'self'` and a sandboxed component route with its own per-route headers: WH-165 (WH-164 serves compositions under the current visitor host CSP). Today `secure()` in `app-host.ts` sets the one host policy on asset, page and error responses; `applicationGateway` responses are not wrapped and carry the gateway's own `sandbox` CSP ([app-gateway.ts](../src/app-gateway.ts)) |
| Content checks | Plain-text validators, photo safety gate, S12/S13a/S13 text gaps | Custom static checks and artifact digest binding: WH-165 |
| Preview / publication | Private no-store previews; exact website, visitor page and module activation reviews | Private presentation preview: WH-163; presentation publication review with manifest/configRevision binding: WH-164 (D1 schema change) |
| Owner agent | `/design-app-page` single bounded call; module operations not advertised | Presentation operations, focused context: WH-166 (levels 1–2), WH-165 (level 3) |
| Export | Website export with `_headers` ([exports.ts](../src/exports.ts)); no composition export | Deterministic compiled export, honestly labeled as needing Whumpo module APIs ([WH-077](roadmap/backlog.md#wh-077--define-and-verify-portable-project-exports-and-managed-service-adapters)): WH-167 |

## Options evaluated — checked October 8, 2026 UTC

| Option | What it does | Whumpo fit and decision |
| --- | --- | --- |
| CSS custom properties ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables/Using_custom_properties)) | Cascading variables consumed by maintained styles | **Adopt for level 1**, served as a same-origin stylesheet compiled from closed tokens. |
| Design Tokens Format Module ([DTCG 2025.10](https://www.designtokens.org/tr/2025.10/format/), stable since October 28, 2025) | Interchange format for tokens between design tools | **Not adopted as the storage format.** The closed v1 token set is far smaller. A later import/export adapter could map to DTCG; owner demand is unknown. |
| [Web Components](https://developer.mozilla.org/en-US/docs/Web/API/Web_components) with shadow DOM | Encapsulated custom elements | **Kit implementation detail only.** MDN warns closed shadow roots are not "a strong security mechanism" ([Using shadow DOM](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM)). Custom code in the page would share the visitor origin and its same-origin module access, so it is rejected for level 3. |
| Sandboxed iframe, same-origin route, CSP `sandbox` header (recommended) | Opaque-origin document with its own response CSP | **Recommended** (decision 1). Matches the existing guest preview framing pattern; per-component headers; cacheable by digest; no new hostname. |
| Sandboxed `srcdoc` iframe | Inline document that inherits a copy of the embedding page's CSP ([CSP3 §7.8](https://www.w3.org/TR/CSP3/)) | **Not preferred.** The inherited host `script-src 'self'` would block the inline component script unless the host page's own policy listed its hash, and no per-document response header is possible (the CSP `sandbox` directive is also ignored in `<meta>`). |
| Separate component hostname (e.g. a domain on the Public Suffix List) | Origin, and possibly site, separation | **Alternative** (decision 1). Stronger site separation, but needs DNS, certificates and possibly a domain purchase. Cost and registrar requirements need verification. |
| Trusted Types ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API)) | Blocks string-to-DOM injection sinks | **Adopt inside the frame** as defense in depth; Baseline 2026, so older browsers rely on static checks. |
| Workers Static Assets [`_headers`](https://developers.cloudflare.com/workers/static-assets/headers/) | Custom headers on direct asset responses | **Not needed now.** The visitor Worker already sets headers per response. Kit assets could move to direct static delivery only after WH-073 measures cost and revocation ([billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)). |

No service, plan, domain or dependency is enabled by this document. Browser support beyond the cited MDN statements, and any cost of a separate hostname, **require verification**.

## Open owner decisions

1. **Custom component hosting.** Recommended: a same-origin sandboxed document route with a CSP `sandbox allow-scripts` header, as above. Alternatives: a separate component hostname on a public-suffix domain (DNS/domain cost to verify), or defer level 3 and ship levels 1–2 only. WH-165 is blocked until this is decided.
2. **Custom component writes.** v1 freezes the conservative default: reads plus `forms.submit` only. Widening to `records.update` or uploads needs an owner decision and its own review class.
3. **Model-produced custom script in visitors' browsers.** Accept, with the static checks, sandbox and exact review above, or require platform-authored kit components only. [Composition architecture §3](roadmap/composition-architecture.md#3-compose-rich-interfaces-without-rewriting-the-backend) keeps custom JavaScript out of the credential-bearing visitor shell until such a contract is accepted.
4. **Owner authoring path.** Whether the site agent advertises presentation operations (WH-166). This interacts with WH-067 acceptance gap 6, where advertising module configuration is likewise an open owner decision.
5. **Visual acceptance.** Recommended: an owner visual sign-off of the three WH-167 compositions plus the automated distinctness floor (fingerprints differ and token distance ≥ 5), rather than automated scoring alone.

No decision above was assumed. The frozen v1 shapes take the narrower option wherever one is open.

## Delivery slices

WH-070 keeps its acceptance unchanged and depends on every child. It closes only when all are accepted. No child depends on WH-028, WH-080 or WH-104. Task scopes live in [backlog.json](roadmap/backlog.json).

| ID | Slice | Depends on |
| --- | --- | --- |
| WH-161 | Freeze this contract, offline reference, conformance checks and decomposition | WH-066, WH-071, WH-123 |
| WH-162 | Specification schema 4 `presentation` section, presentation catalog pins, operations and classification (compiler identity cutover, schema-3 test reset) | WH-161, WH-124 |
| WH-163 | `presentation-kit@1` components, deterministic compiler, client manifest and private preview | WH-162, WH-126, WH-127, WH-128, WH-129 |
| WH-164 | Serve reviewed compositions on the visitor origin with an exact presentation publication review (current-schema change, owner-run cutover) | WH-163, WH-125 |
| WH-165 | Sandboxed custom component route, artifact store, static checks, host bridge and level-3 focused edits (blocked on decisions 1 and 3) | WH-164 |
| WH-166 | Owner-maintenance focused edits and Chat review presentation for levels 1–2 | WH-163, WH-065, WH-105 |
| WH-167 | Connected acceptance: three compositions against identical API/permission conformance, visual and accessibility evaluation, focused-edit preservation, deterministic export | WH-164, WH-165, WH-166 |

## Verification

`node tests/customer-presentation-contract.mjs` (also `pnpm test:customer-presentation-contract`, and part of `node tools/verify.mjs fast`) runs offline checks over the reference. They cover three compositions with identical API footprints and identical shared-modules policy decisions but distinct visual fingerprints. They cover the audience projection cross-checked against the frozen policy table, and the current detailing fixture instances. They exercise refusals of unknown and stale versions and pins, capabilities, backend and authority keys, permission widening, forks, undeclared or unused dependencies, oversize and disallowed content, and missing accessibility. They prove that presentation changes leave instances, pins and `configRevision` untouched while template and dependency changes are reported separately, and they cover manifest staleness, the bridge, frame headers and focused-edit preservation. The suite then re-runs against 32 deliberately broken copies of the reference and fails if any survives. It proves the frozen examples only, with invented identifiers. No database, HTTP server, browser, model, provider, Cloudflare resource or deployment is involved.
