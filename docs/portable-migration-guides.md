# Portable export migration guides

**WH-190 documentation slice, October 9, 2026 UTC. Planned: documentation only. Nothing here is implemented, deployed or accepted.** These guides build on the [portable export contract](portable-exports.md) (WH-186), which merged into `main` as #225 (`d3ebaf2`) and is itself a planned contract. They add no route, table, binding, provider, Cloudflare resource, schema change, dependency or `src/` change. [`tests/portable-migration-guides.mjs`](../tests/portable-migration-guides.mjs) checks their structure offline.

The frozen [unavailable-feature report](portable-exports.md#unavailable-feature-report) has 13 capabilities. For each one, this document gives:

- what a `whumpo-portable-export` version 1 bundle contains;
- what does not port;
- the replacement status;
- the steps you perform yourself;
- the secrets you must recreate;
- your cost flags;
- a check you can run offline.

Each section of the contract links to the matching guide below. The report's `migration` link points to that contract section, so every report entry reaches its guide.

No customer can download this bundle today. The [WH-187 builder](roadmap/backlog.md#wh-187--build-the-portable-bundle-and-permission-filter-in-source) exists only on an unmerged branch, tested in disposable local stores. Its details below are marked as unmerged. Today's only export of a site is the existing [static source download](mvp.md#source-export).

## Rules that apply to every guide

- **Tiers.** Only static public pages can be runnable (tier 1), and only when the bundle's own tier check passes. Everything else is data or source ([tiers](portable-exports.md#three-portability-tiers)). A frontend that needs private Whumpo APIs is never runnable.
- **No Whumpo API, route, credential or model is available outside Whumpo.** An exported page, program or frontend that calls `/api`, `/modules`, `/backend`, a visitor application path under `/apps/`, the stateless-form path `/s/PROJECT/backend`, `/workspace` or a `whumpo.site` or `whumpo.com` origin does not work after you move it. Exporting does not delete, unpublish, move or transfer anything in Whumpo. It does not transfer a subscription, domain, provider authorization or approval.
- **No adapter claim.** The WH-188 standalone runtime and the WH-189 clean-room evidence do not exist yet. Every replacement named below is standard software or a provider you choose yourself, not a Whumpo adapter. Whumpo has not tested any of them with your data. "Supported replacement" means only that the files use a standard format that this kind of host serves without Whumpo.
- **Secrets.** The bundle contains no secret. Never paste a password, key, token, passkey, recovery code or authorization code into Whumpo Chat, a support message or a Whumpo form. Create every credential with your own provider and keep it there.
- **Current version only.** Readers accept only:
  - bundle format `whumpo-portable-export` version 1;
  - filter `portable-filter@1`;
  - data-set formats at exactly version 1.

  There is no legacy decoder. A bundle with any other version is refused, not converted ([policy](current-version-policy.md), [format versions](portable-exports.md#format-versions-under-the-current-version-only-policy)).
- **Costs.** Whumpo spends nothing at your destination. Every customer-side price below was read on October 9, 2026 from the linked official page. Each one requires verification against your own account, region, plan and date before you rely on it.

## Verify a bundle offline first

1. Keep the bundle digest from your download receipt. The contract returns it out of band ([checksums](portable-exports.md#determinism-and-checksums)); the unmerged WH-187 route sends it as the `x-whumpo-bundle-sha256` response header.
2. Extract the ZIP into a new, empty folder with any ZIP tool. Entries are stored without compression.
3. Save the script below as `verify-bundle.mjs` outside that folder.
4. With your network disconnected, run `node verify-bundle.mjs <folder> <bundle.zip> <receipt-sha256>` with Node.js 24. The script uses no dependencies.

The script checks:

- the format, version and filter;
- the path, size and SHA-256 of every listed file;
- files missing from the folder, and files present but not listed;
- the bundle digest.

It also prints each report status and exclusion count. It is a subset of the reference reader: it does not check the ZIP's canonical encoding or credential-shaped keys. If it prints `FAILED` or `REFUSED`, do not use the bundle. Request a new export.

```js
// verify-bundle.mjs: offline check of an extracted whumpo-portable-export v1 bundle (Node.js 24, no network).
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,relative,sep} from 'node:path';
const [dir,zip,expected]=process.argv.slice(2);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
if(manifest.format!=='whumpo-portable-export'||manifest.formatVersion!==1||manifest.filter!=='portable-filter@1'){
 console.log('REFUSED: not a whumpo-portable-export version 1 bundle');process.exit(2);
}
const problems=[],listed=new Set(['manifest.json']);
for(const f of manifest.files){
 const parts=f.path.split('/');
 if(!/^[A-Za-z0-9_.\/-]+$/.test(f.path)||parts.some(p=>p===''||p==='.'||p==='..')){problems.push(`unsafe path ${f.path}`);continue;}
 listed.add(f.path);
 let bytes;
 try{bytes=readFileSync(join(dir,...parts));}catch{problems.push(`missing ${f.path}`);continue;}
 if(bytes.length!==f.bytes||sha256(bytes)!==f.sha256)problems.push(`changed ${f.path}`);
}
const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(d,e.name)):[relative(dir,join(d,e.name)).split(sep).join('/')]);
for(const path of walk(dir))if(!listed.has(path))problems.push(`unlisted ${path}`);
if(zip&&sha256(readFileSync(zip))!==expected)problems.push('bundle digest differs from the receipt');
for(const e of manifest.unavailable)console.log(`report ${e.capability} ${e.status}`);
for(const e of manifest.exclusions)console.log(`excluded ${e.category} ${e.count??'not counted'}`);
console.log(problems.length?`FAILED\n${problems.join('\n')}`:`ok: ${manifest.files.length} files match manifest.json`);
process.exitCode=problems.length?1:0;
```

## Static public pages (content-pages)

- **Report status:** `runnable` when every file in `site/public` passes the bundle's own tier check, otherwise `data-only`; `not-used` when the project has no public page. Report cost flag: `customer-provider`. Contract: [static pages](portable-exports.md#static-pages).
- **In the bundle:**
  - the public pages: `site/public/index.html`, and `site/public/<path>/index.html` for any other public page;
  - `site/public/_headers`, which holds the security headers;
  - the approved photos those pages use, under `site/public/assets/`.

  The current compiler renders one to four public pages ([compiler](project-specification-compiler.md)), but the mounted storage and host adapter accepts only one homepage at `/` ([storage](project-specification-storage.md)), so saved versions have one page and the unmerged WH-187 source exports one homepage.
- **Does not port:**
  - Staff-audience pages stay out of the static tier. Their text stays in `specification/specification.json`.
  - Hosted contact intake, backend forms, directory pages and any embedded Whumpo tool. A page that embeds a Whumpo-served tool makes the whole static tier `data-only`.
  - Custom frontends under `frontend/<id>/`. They are source that needs Whumpo module APIs, so they are never runnable (the WH-070 presentation contract keeps this label).
  - The `PROJECT.whumpo.site` address. It belongs to Whumpo and cannot move.
- **Replacement:** Supported replacement: any static file host, because runnable pages contain no script, network call or Whumpo origin. One documented option is [Workers static assets](https://developers.cloudflare.com/workers/static-assets/) on your own Cloudflare account. A request that matches a file is served without invoking Worker code; with no Worker script, an unmatched request returns 404. Whumpo has not run this with a customer bundle (WH-189 pending).
- **Your steps:**
  1. Verify the bundle offline and confirm that it prints `report content-pages runnable`.
  2. Upload the contents of `site/public` to your host. For an assets-only Wrangler configuration, you need a `name`, a `compatibility_date` and `assets.directory` ([assets-only example](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/docusaurus/)). `wrangler deploy --assets <directory>` deploys a folder ([Wrangler changelog](https://developers.cloudflare.com/changelog/post/2025-09-09-interactive-wrangler-assets/)).
  3. Apply the headers. Workers static assets read `_headers` from the asset directory, with up to 100 rules and 2,000 characters per line ([headers](https://developers.cloudflare.com/workers/static-assets/headers/)). On other hosts, set the same headers in that host's configuration.
  4. Point your domain at the new host yourself ([domains guide](#domains-and-dns-domains)).
- **Secrets:** None. `_headers` contains response headers, not credentials.
- **Costs:** Your host's charges. Cloudflare's [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) page (retrieved October 9, 2026) says requests to static assets are free and unlimited, Workers Free allows 100,000 requests a day, and Workers Paid has a $5 USD monthly account minimum; plan, entitlement and pricing for your account requires verification.
  - Cloudflare's [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) page (retrieved October 9, 2026) allows 20,000 asset files per version on Free, 100,000 on Paid and 25 MiB per file; the entitlement for your plan requires verification.
- **Offline check:**
  1. Run the bundle check.
  2. Disconnect your network and serve the folder on your own machine only, for example `python3 -m http.server 8000 --bind 127.0.0.1 --directory site/public`. The [Python documentation](https://docs.python.org/3/library/http.server.html) says this server is not recommended for production.
  3. Confirm that every page and image loads.
  4. Run `grep -rIE "whumpo\.(site|com)|<script" site/public`. It must print nothing.

## Content collections and the directory (content-collections)

- **Report status:** `data-only` when the project has a directory, otherwise `not-used`. Report cost flag: `none`. Contract: [content collections](portable-exports.md#content-collections).
- **In the bundle:** `data/directory.json` in format `whumpo-directory` version 1. It holds the project name, the snapshot id and time, and the listings: id, title, description and HTTPS link ([directory downloads](directories.md#saved-data-restoration-and-downloads)). In the unmerged WH-187 source, this is the newest applied snapshot, which can be newer than the published one.
- **Does not port:**
  - the public directory page and its JSON endpoint on `PROJECT.whumpo.site`;
  - draft listings, edit and publication reviews, history and restore.

  No directory renderer is in the bundle in v1. A static directory projection is a WH-188 candidate ([decision 1](portable-exports.md#open-owner-decisions)).
- **Replacement:** Migration path only: the listings are plain JSON you can import into a spreadsheet, a static site generator or a database. No Whumpo directory renderer or API is available outside Whumpo.
- **Your steps:**
  1. Verify the bundle.
  2. Read `listings` from `data/directory.json`.
  3. Render the listings yourself as a static page (then follow the static pages guide), or import them into your own tool. Escape the text when you render it: listing text is customer data, not HTML.
- **Secrets:** None.
- **Costs:** None in the report: the data set needs no provider. If you publish a rendering, the static page hosting costs above apply and require verification.
- **Offline check:** The bundle check lists `data/directory.json` with a matching SHA-256. This command prints the listing count you expect: `node -e "const d=JSON.parse(require('node:fs').readFileSync('data/directory.json','utf8'));if(d.format!=='whumpo-directory'||d.schemaVersion!==1)process.exit(1);console.log(d.listings.length)"`.

## Records (records)

- **Report status:** `data-only` when the project has a records instance, otherwise `not-used`. Report cost flag: `customer-provider`. Contract: [records and forms](portable-exports.md#records-and-forms).
- **In the bundle:** Records are included only when you chose to include visitor data in the export review. Each schema becomes `data/records/<instance>/<schema>.json` in `whumpo-module-records` version 1 ([serializer](shared-modules.md#records-export-serializer-wh-127--october-4-2026-utc)). Each file holds:
  - the field definitions: labels, types, audiences and choices;
  - every currently retained record, with its values, submitter kind, opaque visitor id and dates;
  - a SHA-256 over the records.

  The unmerged WH-187 source limits each schema to one serializer page of 200 records.
- **Does not port:**
  - records past their retention window;
  - record views, staff updates, the owner records panel and retention timers;
  - content-free events and request receipts;
  - anything held for review, which appears only in the `not-cleared` count.

  If you did not choose visitor data, no records are exported (`visitor-dataset-not-requested`).
- **Replacement:** Migration path only: import the JSON into your own database. SQLite works without a server. Whumpo's records module, views and staff permissions are not available outside Whumpo.
- **Your steps:**
  1. Verify the bundle.
  2. Choose a database and define your own access rules. Visitor values are personal data, and the export does not carry Whumpo's per-field visibility enforcement.
  3. Load each file. In the `sqlite3` command-line shell, `readfile()` reads a file ([CLI](https://sqlite.org/cli.html)), and the built-in JSON functions (SQLite 3.38.0 or later, [JSON](https://sqlite.org/json1.html)) split the array: `CREATE TABLE records(record TEXT NOT NULL); INSERT INTO records(record) SELECT value FROM json_each(CAST(readfile('data/records/INSTANCE/SCHEMA.json') AS TEXT), '$.records');`
  4. Query values with `json_extract(record, '$.values.FIELD')`.
  5. Set your own retention. Whumpo's retention window does not travel with the data.
- **Secrets:** None in the bundle. Database credentials at your destination are yours; do not share them with Whumpo.
- **Costs:** Your database or host's charges require verification. SQLite is a local library with no provider charge.
- **Offline check:** The bundle check passes, the SQL above runs with your network disconnected, and `SELECT count(*) FROM records;` equals the number of records in the file. On October 9, 2026, the `json_each` and `json_extract` statements ran against synthetic JSON with SQLite 3.53.4 through Node.js 24.21.0 `node:sqlite`. The CLI's `readfile()` did not: the `sqlite3` shell was not installed on the test host.

## Forms and public intake (forms)

- **Report status:** `unavailable` when the project has a form, otherwise `not-used`. Report cost flag: `customer-provider`. Contract: [records and forms](portable-exports.md#records-and-forms).
- **In the bundle:** The form definitions (fields and audiences) are in `specification/specification.json`. Submitted values are records ([records guide](#records-records)).
- **Does not port:**
  - the visitor form endpoint (`POST /modules` on the visitor origin);
  - Turnstile verification with Whumpo's secret;
  - per-connection allowances, hourly and platform caps, receipts and replay protection;
  - the activation review.
- **Replacement:** Unavailable: Whumpo publishes no standalone form handler. You need your own form handler, storage and bot protection.
- **Your steps:**
  1. Recreate each form from the specification in your own framework or form service.
  2. Add bot protection under your own account. With Cloudflare Turnstile, validate every token on your server through the Siteverify API, and call it only from your backend ([server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)).
  3. Store submissions in your own database (see the records guide), with your own rate limits and retention.
  4. The exported headers set `form-action 'none'`. Change that header only when you add a working handler.
- **Secrets:** Create your own Turnstile site key and secret key, or your provider's equivalent. Whumpo's Turnstile secret is never exported. Keep the secret on your server: Cloudflare warns that exposing it in front-end code lets attackers bypass the check.
- **Costs:** Your form handler, storage and bot-protection charges require verification. Cloudflare's [Turnstile plans](https://developers.cloudflare.com/turnstile/plans/) page (retrieved October 9, 2026) lists the Free plan as free, with up to 20 widgets, 10 hostnames per widget and unlimited challenges; whether that plan fits your use requires verification.
- **Offline check:** The bundle check prints `report forms unavailable`, and `RECONFIGURE.txt` lists `forms / bot-protection-secret`. No exported static page posts a form anywhere: `grep -rI "form-action 'none'" site/public/_headers` finds the header.

## Files, photos and galleries (files)

- **Report status:** `data-only` when the project has a files instance, otherwise `not-used`. Report cost flag: `customer-provider`. Contract: [files and galleries](portable-exports.md#files-and-galleries).
- **In the bundle:**
  - approved owner photos that no exported page uses, under `data/media/<photo>.jpg`;
  - with the visitor-data choice, approved module uploads under `data/files/<instance>/<collection>/<file>.jpg`, with an index `data/files/<instance>/<collection>.json` (`whumpo-portable-files` version 1: id, path, SHA-256, size and uploader).

  Every file is a cleaned baseline JPEG. APP and comment segments, including EXIF, GPS and embedded profiles, were removed at upload ([photos](photos.md#upload-contract)).
- **Does not port:**
  - read and upload policies and collection roles;
  - pending, blocked or held files (one generic `not-cleared` count);
  - original file names, object keys and the private bucket.
- **Replacement:** Migration path only: the files are plain JPEGs with checksums, so any object storage or file host can store them. [R2 implements the S3 API](https://developers.cloudflare.com/r2/api/s3/api/), so S3-compatible tools can upload them to a bucket you own. Whumpo's private bucket is never exposed.
- **Your steps:**
  1. Verify the bundle.
  2. Decide who may see each collection before you upload anything. A private gallery must not go to a public host.
  3. Upload the JPEGs to your storage and rebuild the access rules there.
  4. Use the index JSON to keep the uploader and collection grouping.
- **Secrets:** You create storage access keys in your own storage account, and they stay there. Whumpo never receives them.
- **Costs:** Your storage charges require verification. Cloudflare's [R2 pricing](https://developers.cloudflare.com/r2/pricing/) page (retrieved October 9, 2026) lists Standard storage at $0.015 per GB-month, Class A operations at $4.50 per million, Class B at $0.36 per million and free egress, with a monthly free allowance of 10 GB-month, 1 million Class A and 10 million Class B operations; pricing for your account requires verification.
- **Offline check:**
  - The bundle check passes for every `.jpg`.
  - Each JPEG starts with the bytes `FF D8 FF`.
  - For module files, each index entry's `sha256` equals that file's manifest entry.

## Visitor access and staff roles (access)

- **Report status:** `unavailable` when the project has visitor access or staff pages, otherwise `not-used`. Report cost flag: `customer-provider`. Contract: [visitor access and staff roles](portable-exports.md#visitor-access-and-staff-roles).
- **In the bundle:** `data/access/<instance>/roles.json` in `whumpo-access-roles` version 1: the staff list, with opaque visitor ids and role state and dates ([access module](shared-modules.md#access-module-staff-roles-wh-126--october-4-2026-utc)). It contains no names, email addresses or credentials.
- **Does not port:**
  - passkeys, sessions, invitations, recovery material and visitor identities;
  - the access control on staff-only pages.

  A [WebAuthn](https://www.w3.org/TR/webauthn-3/) credential can only be used for authentication with the same relying party it was registered with (W3C Recommendation, August 25, 2026). Passkeys therefore cannot move to another domain. Staff-audience pages are not served in the static tier.
- **Replacement:** Unavailable: Whumpo publishes no standalone sign-in or role service. Use your own identity provider or authentication library.
- **Your steps:**
  1. Choose your own sign-in system.
  2. Contact your staff and visitors through your own channels, because the bundle carries no contact details. Invite them to enroll at the new domain.
  3. Recreate staff roles, using `roles.json` as a checklist. The visitor ids are internal to Whumpo and mean nothing elsewhere.
  4. Publish staff-only content only behind your new sign-in.
- **Secrets:** Your identity provider's keys and signing secrets stay in your own account. A passkey, session or recovery code is never in the bundle.
- **Costs:** Your identity provider's charges require verification.
- **Offline check:** The bundle check prints `report access unavailable`, and `RECONFIGURE.txt` lists `access / visitor-passkeys`. Open `roles.json` to confirm it lists only opaque ids and role state.

## Notifications (notifications)

- **Report status:** `unavailable` when the project configures notifications, otherwise `not-used`. Report cost flag: `customer-provider`. Contract: [notifications](portable-exports.md#notifications) and the [WH-068 delivery contract](notifications.md).
- **In the bundle:** Any notification configuration in the saved specification. As of October 9, 2026, customer-configured notifications exist only as a planned contract (WH-155–160), so most projects have none. The WH-036 owner contact notice is configured in source but not deployed ([contact notices](contact-forms.md#owner-notification-delivery-wh-036)).
- **Does not port:**
  - the platform sender `notify@whumpo.com`, its sending domain and DNS records;
  - the template catalog and recipient resolution;
  - consent and suppression lists;
  - the outbox, receipts and delivery events.

  Whumpo v1 has no customer-domain senders ([sender model](notifications.md#verified-sender-model)), so there is no sender configuration to carry over.
- **Replacement:** Unavailable: Whumpo publishes no standalone notification sender. Use your own email provider.
- **Your steps:**
  1. Choose an email provider that sends over standard SMTP ([RFC 5321](https://www.rfc-editor.org/rfc/rfc5321)) or its own API.
  2. Send from a domain you control. At your DNS provider, publish its SPF ([RFC 7208](https://www.rfc-editor.org/rfc/rfc7208)), DKIM ([RFC 6376](https://www.rfc-editor.org/rfc/rfc6376)) and DMARC ([RFC 9989](https://www.rfc-editor.org/rfc/rfc9989)) records as your email provider instructs.
  3. Rebuild consent: ask staff and submitters to opt in again. Whumpo's opt-ins and suppressions are not exported.
  4. Never mail an address typed into an anonymous form without first confirming that address.
- **Secrets:** You create sending credentials (an SMTP password or API key) and DKIM private keys with your provider, and they stay there. Whumpo never receives them.
- **Costs:** Your email provider's charges, including any monthly minimum, require verification.
- **Offline check:** The bundle check prints `report notifications unavailable` (or `not-used`). When notifications are used, `RECONFIGURE.txt` lists `notifications / email-provider-credentials`.

## Connectors (connectors)

- **Report status:** `unavailable` when the project uses a connection, otherwise `not-used`. Report cost flag: `customer-provider`. Contract: [connectors](portable-exports.md#connectors) and the [WH-140 connector contract](connectors.md).
- **In the bundle:** Only the report entry. The unmerged WH-187 source counts connections without reading them. No token, consent receipt, catalog entry or provider response is exported.
- **Does not port:**
  - Whumpo's GitHub App and Cloudflare OAuth client;
  - their encrypted credentials, reviews, receipts and reconciliation;
  - the connector catalog.

  The planned Gmail, Google Calendar, Outlook, Microsoft Calendar and HubSpot connections are not available in Whumpo, so there is nothing to migrate for them.
- **Replacement:** Unavailable: Whumpo publishes no standalone connector. Connect each provider directly under your own account.
- **Your steps:**
  1. Disconnect each provider in Whumpo's connection controls, so Whumpo revokes its own token through the normal connection lifecycle ([revocation](connectors.md#credentials-refresh-and-revocation)).
  2. GitHub: review or revoke the Whumpo app under Settings, Applications, Authorized GitHub Apps. Only the person who authorized an app can revoke it ([GitHub Docs](https://docs.github.com/en/apps/using-github-apps/reviewing-and-revoking-authorization-of-github-apps)). Repositories and backups already pushed stay in your repository.
  3. Cloudflare: zones and DNS records stay in your account. For your own automation, create a scoped API token. Cloudflare shows the secret only once ([create a token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)).
  4. Reconnect your other tools directly with each provider.
- **Secrets:** Create your own OAuth apps and API tokens; never give them to Whumpo. Whumpo's own tokens are never handed over.
- **Costs:** Provider plans and API charges on your own account require verification. Whumpo's plan-inclusion price of zero units applies only inside Whumpo.
- **Offline check:** The bundle check prints `report connectors unavailable` when a connection is used and `excluded credentials-and-sessions not counted`. `RECONFIGURE.txt` lists `connectors / provider-authorization`.

## Custom functions (custom-functions)

- **Report status:** `data-only` when the project has reviewed custom source, otherwise `not-used`. Report cost flag: `customer-provider`. Contract: [custom functions](portable-exports.md#custom-functions).
- **In the bundle:** Reviewed and cleared program source as `source/<program>/program.js`, with `program.json` (`whumpo-backend-source` version 1: engine `quickjs`, JSON input and output, SHA-256 and size). The unmerged WH-187 source exports the published backend version and the activated visitor-application version. Each program is an ES module whose default function takes JSON and returns JSON, with no imports, files, network or timers ([protocol](backend-execution.md#initial-protocol)).
- **Does not port:**
  - Whumpo's execution gateway, bounds, budgets and review gates;
  - public endpoints on `PROJECT.whumpo.site`;
  - private backend state and visitor documents.

  Unreviewed or held source is never exported. Before you leave Whumpo, download any backend state snapshot separately ([data history](backend-execution.md#data-history-export-and-restoration)). Visitors download their own documents through the visitor export.
- **Replacement:** Migration path only: no Whumpo runner is published, pending an owner decision for WH-188. You can run the source in your own JavaScript sandbox:
  - [QuickJS](https://bellard.org/quickjs/) is a small, embeddable engine under the MIT license.
  - The [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten) README says it has not been audited.
  - [workerd](https://github.com/cloudflare/workerd) is not a hardened sandbox, so run possibly malicious code with it only inside a sandbox such as a virtual machine.
- **Your steps:**
  1. Verify the bundle and read each `program.js`.
  2. Review the code yourself. Whumpo's maintainer may have generated it, and it was reviewed only for Whumpo's bounded runtime.
  3. Wrap it in your own host. The host passes JSON in, reads JSON out, and applies your own time and memory limits.
  4. Recreate any public endpoint and its rate limits on your own platform, and update callers of the old endpoint.
- **Secrets:** None. Programs receive no credential in Whumpo, and the bundle contains none. If your host adds secrets, keep them in its secret store. On Workers, [secrets](https://developers.cloudflare.com/workers/configuration/secrets/) are not visible after you set them.
- **Costs:** Your runtime host's charges require verification.
- **Offline check:** The bundle check passes. `program.json` names engine `quickjs`, and its SHA-256 equals the manifest entry for `program.js`.

## Contact inbox (contact-inbox)

- **Report status:** `unavailable` when the project has a contact inbox, otherwise `not-used`. Report cost flag: `customer-provider`. Contract: [contact inbox](portable-exports.md#contact-inbox).
- **In the bundle:** No messages. When the project has an inbox, the manifest records the exclusion `contact-inbox-separate-export`. That frozen name does not mean a separate inbox export exists; there is none.
- **Does not port:**
  - messages and receipts;
  - the hosted contact page, Turnstile verification and caps;
  - owner notices.

  Messages become inaccessible after 30 days ([inbox and retention](contact-forms.md#inbox-and-retention)).
- **Replacement:** Unavailable: Whumpo publishes no standalone inbox. Messages also have no file download or other export today. The owner reads them in the private inbox, which shows at most 100 unexpired messages per project, and can delete them one at a time. The WH-018 account export (unmerged PR #170) also leaves them out, listing the inbox only as an omission (reason `separate-inbox-retention`).
- **Your steps:**
  1. Before the 30-day window ends, read the inbox and copy what you need into your own system.
  2. Build your own contact handler with bot protection and email ([forms guide](#forms-and-public-intake-forms), [notifications guide](#notifications-notifications)).
  3. Publish your new contact address on your new site.
- **Secrets:** You need your own bot-protection secret and email credentials. Never paste them into Whumpo.
- **Costs:** Your form handler, bot-protection and email provider charges require verification.
- **Offline check:** The bundle check prints `excluded contact-inbox-separate-export 1` when the project has an inbox. A search of the extracted folder for text from a recent message finds nothing.

## Domains and DNS (domains)

- **Report status:** `unavailable` when the project has a domain, otherwise `not-used`. Report cost flag: `customer-provider`. Contract: [domains and DNS](portable-exports.md#domains-and-dns).
- **In the bundle:** Only the report entry. The domain itself was never part of the bundle. Ownership proofs (`_whumpo.HOSTNAME` TXT values) are never exported.
- **Does not port:**
  - `PROJECT.whumpo.site`;
  - Whumpo hosting configuration;
  - ownership proofs and DNS action receipts.

  Whumpo does not sell or register domains (purchases are not implemented), so no registration needs to leave Whumpo ([domains](domains.md)).
- **Replacement:** Unavailable: Whumpo provides no portable DNS or hosting service. Your registrar and DNS provider stay as they are.
- **Your steps:**
  1. Set up the new host first and check it on its own address.
  2. At your DNS provider, point the hostname at the new host. With Workers, you can add a [Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) on an active Cloudflare zone you own; Cloudflare then creates the DNS record and certificate.
  3. Once the new host serves your site, delete the `_whumpo` TXT record and any record that points at Whumpo. Removing Whumpo's saved proof is a separate reviewed action in Whumpo ([proof removal](domains.md#removing-unused-ownership-proofs)).
  4. To transfer the registration as well (optional):
     - [ICANN's Transfer Policy](https://www.icann.org/resources/pages/transfer-policy-2016-06-01-en) requires your registrar to give you the AuthInfo code within five calendar days if you cannot generate it yourself, and a change of registrant can start a 60-day inter-registrar transfer lock.
     - [Cloudflare Registrar](https://developers.cloudflare.com/registrar/get-started/transfer-domain-to-cloudflare/) requires the domain to be active on Cloudflare DNS and unlocked, an authorization code, and registration at least 60 days ago with no transfer in the last 60 days.
     - Registry and registrar rules for your domain require verification.
- **Secrets:** Registrar and DNS account credentials and transfer authorization codes stay with you. Never send them to Whumpo.
- **Costs:** Your registrar, DNS and certificate charges require verification. Cloudflare's transfer page (retrieved October 9, 2026) says its domains are at-cost with no markup fees and that most transfers include a one-year extension; the price for your domain requires verification.
- **Offline check:** The bundle check prints `report domains unavailable` when a domain is used, and `RECONFIGURE.txt` lists `domains / dns-records`. You cannot check DNS offline: after cut-over, query your records with your own resolver.

## Automation rules (automation)

- **Report status:** `unavailable` when the specification has rules, otherwise `not-used`. Report cost flag: `customer-provider`. Contract: [automation rules](portable-exports.md#automation-rules).
- **In the bundle:** Any rule configuration in `specification/specification.json`. As of October 9, 2026, stored automation rules are planned (WH-069) and not implemented, so current projects have none.
- **Does not port:** Rule execution, schedules, the deterministic job envelope, approvals, receipts, and the notification and connector actions that rules would call.
- **Replacement:** Unavailable: Whumpo publishes no standalone rule engine. Use your own scheduler or workflow tool.
- **Your steps:**
  1. Read the rules in the specification.
  2. Rebuild each trigger and action in your own tool. On your own Cloudflare account, [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) map a cron expression to a Worker's `scheduled()` handler; you configure them in the Wrangler `triggers.crons` setting.
  3. Make each action idempotent. When an outcome is unknown, never resend: Whumpo's receipts follow the same rule.
- **Secrets:** Credentials your scheduler needs live in its own secret store.
- **Costs:** Your scheduler or workflow tool charges require verification. Cloudflare's Workers pricing page (retrieved October 9, 2026) allows up to 15 minutes of CPU time per Cron Trigger invocation on the Paid plan; whether that suits your plan requires verification.
- **Offline check:** The bundle check prints `report automation unavailable` when rules exist, and you can read the rules in the specification.

## Maintainer AI (maintainer-ai)

- **Report status:** always `unavailable`. Report cost flag: `none`. Contract: [maintainer AI](portable-exports.md#maintainer-ai).
- **In the bundle:** Nothing. Chat history belongs to the WH-018 account export (unmerged PR #170), not this bundle.
- **Does not port:** The owner-maintenance model, its prompts, context, tools, credentials and funding.
- **Replacement:** Unavailable by design: nothing in the exported subset needs it. Whumpo provides no model, prompt or inference credit outside Whumpo. You may maintain the exported files with any tool you choose.
- **Your steps:** None required. If you use another AI tool, review its data terms yourself before you give it your exported data.
- **Secrets:** None.
- **Costs:** None from the bundle. Any AI tool you choose has its own charges, which require verification.
- **Offline check:** The bundle check prints `report maintainer-ai unavailable`. The exported static pages contain no script and no Whumpo origin.

## Alignment with other contracts (October 9, 2026 UTC)

| Contract | State | How this guide uses it |
| --- | --- | --- |
| WH-186 [portable export contract](portable-exports.md) | Merged (#225), planned contract | Source of the capability list, statuses, cost flags, layout and rules. This guide changes none of them. |
| WH-187 bundle builder | Unmerged branch `claude/wh-187-portable-bundle-builder`, disposable local tests only | Details labelled "unmerged WH-187": one homepage, 200 records per schema, the receipt header, and connections, domains and inbox reported from counts only. |
| WH-140 [connector contract](connectors.md) | Merged (#116) | Connectors guide: revocation lifecycle, no token export, planned providers unavailable. |
| WH-068 [notification contract](notifications.md) | Merged (#180) | Notifications guide: platform sender only, no customer-domain sender, consent not portable. |
| WH-070 presentation contract (`docs/customer-presentation.md`) | Unmerged; re-ported onto `main` as branch `claude/wh-070-presentation-contract-main`, not linked here | Its planned deterministic composition export (WH-167) is labelled as needing Whumpo module APIs. That matches the frozen rule that `frontend/<id>/` is never runnable. Re-check when it merges. |
| WH-061 review retention design (`docs/review-retention.md`) | Unmerged branch `claude/wh-061-review-retention-design-rb` | Proposes digest-only directory snapshots outside a history window. That affects history restore inside Whumpo, not the one snapshot in the bundle. |
| WH-018 account export | Unmerged (PR #170) | Chat history and the contact inbox omission. |

## Sources (retrieved October 9, 2026 UTC)

Fetched with Firecrawl scrape (live fetch), WebFetch or the Cloudflare documentation search. These are planning inputs. They are not a quote, an entitlement check on any account or an activation.

| Source | Fact used |
| --- | --- |
| [Workers static assets](https://developers.cloudflare.com/workers/static-assets/) | A matching file is served without invoking Worker code; with no Worker script, unmatched requests get 404. |
| [Workers static asset headers](https://developers.cloudflare.com/workers/static-assets/headers/) | `_headers` in the asset directory; up to 100 rules; 2,000 characters per line. |
| [Docusaurus on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/docusaurus/) | Assets-only configuration with `name`, `compatibility_date` and `assets.directory`. |
| [Wrangler assets changelog, September 9, 2025](https://developers.cloudflare.com/changelog/post/2025-09-09-interactive-wrangler-assets/) | `wrangler deploy --assets [directory]`. |
| [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) | Static asset requests free and unlimited; Free 100,000 requests a day; Paid $5 USD monthly account minimum; 15 minutes of CPU per Cron Trigger invocation on Paid. Pricing for a customer account requires verification. |
| [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | 20,000 (Free) and 100,000 (Paid) asset files per version; 25 MiB per file. |
| [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) | Requires an active Cloudflare zone you own; Cloudflare creates the DNS records and certificates. |
| [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/) | Secret values are not visible after you define them. |
| [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) | Map a cron expression to a Worker's `scheduled()` handler, configured in `triggers.crons`. The page does not say whether the Free plan includes them, so that requires verification. |
| [workerd](https://github.com/cloudflare/workerd) | Application server for self-hosting Workers apps; "not a hardened sandbox"; tested on Linux and macOS (x86-64, arm64) and Windows (x86-64). |
| [R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/) | "R2 implements the S3 API to allow users and their applications to migrate with ease." |
| [R2 pricing](https://developers.cloudflare.com/r2/pricing/) | Standard $0.015/GB-month, Class A $4.50/million, Class B $0.36/million, free egress, free allowance 10 GB-month, 1 million Class A and 10 million Class B. Pricing for a customer account requires verification. |
| [Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) | Call Siteverify only from the backend; exposing the secret key lets attackers bypass the check. |
| [Turnstile plans](https://developers.cloudflare.com/turnstile/plans/) | The Free plan is listed as free: up to 20 widgets, 10 hostnames per widget, unlimited challenges. Pricing for a customer account requires verification. |
| [Create a Cloudflare API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) | The token secret is shown only once; permissions and resources are scoped. |
| [Transfer to Cloudflare Registrar](https://developers.cloudflare.com/registrar/get-started/transfer-domain-to-cloudflare/) | Active on Cloudflare DNS, unlocked, authorization code, 60-day rule; at-cost with no markup fees and a one-year extension for most transfers. Pricing for a customer domain requires verification. |
| [ICANN Transfer Policy](https://www.icann.org/resources/pages/transfer-policy-2016-06-01-en) | AuthInfo code within five calendar days; 60-day inter-registrar lock after a change of registrant unless opted out. Whether a newer policy version applies to a given registry requires verification. |
| [GitHub: revoking GitHub App authorization](https://docs.github.com/en/apps/using-github-apps/reviewing-and-revoking-authorization-of-github-apps) | Settings, Applications, Authorized GitHub Apps, Revoke; only the person who authorized can revoke. |
| [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) | W3C Recommendation, August 25, 2026: a credential can be used only with the RP ID it was registered with. |
| [RFC 5321](https://www.rfc-editor.org/rfc/rfc5321) | SMTP, Draft Standard, October 2008, updated by RFC 7504. |
| [RFC 7208](https://www.rfc-editor.org/rfc/rfc7208) | SPF, Proposed Standard, April 2014. |
| [RFC 6376](https://www.rfc-editor.org/rfc/rfc6376) | DKIM, Internet Standard (STD 76), September 2011. |
| [RFC 9989](https://www.rfc-editor.org/rfc/rfc9989) | DMARC, Proposed Standard. The page gives no explicit date; its copyright notice is 2026. The RFC Editor lists RFC 7489 as obsoleted by RFCs 9989–9991. |
| [Node.js 24 `node:sqlite`](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) | Stability 1.2, release candidate since v24.15.0. |
| [SQLite JSON functions](https://sqlite.org/json1.html) | Built in by default since SQLite 3.38.0 (2022-02-22); `json_each` walks the immediate children. |
| [SQLite CLI](https://sqlite.org/cli.html) | `readfile(X)` is a CLI extension function that returns the file content as a BLOB. |
| [QuickJS](https://bellard.org/quickjs/) | Small embeddable engine, ES2025, MIT license. |
| [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten) | "has not been audited." The README states no license; the local `quickjs-emscripten-core` 0.32.0 `package.json` says MIT. |
| [Python `http.server`](https://docs.python.org/3/library/http.server.html) | Not recommended for production; `--bind` and `--directory` options. |

**Not obtained:** the GNU coreutils `sha256sum` page returned HTTP 429 once and then content too thin to cite. The guides therefore use the Node.js script above instead of `sha256sum`. No email provider's pricing or terms were read: every email cost stays labelled as requiring verification.

## Gaps and owner decisions

- **Contact inbox download.** The contract no longer claims an inbox export: the only path is the owner's private inbox read (up to 100 unexpired messages), with no file download. The exclusion keeps its frozen v1 name `contact-inbox-separate-export`. Open decision: add an owner download of unexpired messages, or keep the inbox out of every export.
- **No adapter evidence.** Every replacement here is customer-chosen standard software, so these guides make no adapter claim. Any future WH-188 runner or loader must update its guide only with WH-189 evidence.
- **Unmerged inputs.** WH-187, WH-070, WH-061 and WH-018 are unmerged (the WH-186 contract merged as #225). Recheck every "unmerged" label when each one merges, especially WH-070's composition export and WH-187's bounds.
- **Not re-verified here:** registry-specific transfer rules, email provider pricing, identity provider pricing, and whether Cron Triggers are on Workers Free. All of these require verification.
- The [open owner decisions](portable-exports.md#open-owner-decisions) of the contract (first runnable subset, allowance, visitor data and hold disclosure, one static path, signatures, adapter license and prepared-bundle retention) are unchanged.

## Verification

`node tests/portable-migration-guides.mjs` (`pnpm test:portable-migration-guides`) runs offline. It reads the capability list from [`tools/prototypes/portable-export.mjs`](../tools/prototypes/portable-export.mjs) and checks the following:

- each capability has exactly one guide entry, with every required section;
- each entry's status and cost flag match the report;
- each replacement label matches the allowed statuses;
- every contract migration section links to its guide;
- external links are `https` and on an allow-listed official host, and each is listed in the dated source table;
- local links and anchors resolve;
- every price, plan or cost claim is labelled "requires verification";
- no sentence says a Whumpo API or route keeps working after export;
- no sentence asks for a secret to be shared with Whumpo;
- the offline `verify-bundle.mjs` script accepts a bundle built by the reference, and refuses or flags a changed file, an unlisted file, a wrong digest and another format version.

A mutation set must be caught by the named checks. It is not part of a `pnpm verify` profile. It proves the document's structure and the script, not any destination, provider or live behavior.
