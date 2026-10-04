// WH-130 synthetic composition A: a staff portal. It is written as a browser frontend served from the project's
// visitor origin and speaks only the whumpo-modules v1 envelope to the same-origin module routes. It holds no
// identity, principal, permission, approval, storage location or query: the browser attaches the project's own
// cookie and every decision is made by the shared module handlers. The manifest carries only public resource ids and
// configuration revisions. No dependency is loaded.

/** Creates the portal over a same-origin fetch and the composed instance manifest. */
export function staffPortal({fetch, manifest}) {
  const {members, requests, media, listings} = manifest.instances;
  const envelope = (instance, operation, target, input, requestId) => ({
    api: 'whumpo-modules', version: 1, operation, resourceId: instance.resourceId, configRevision: instance.configRevision,
    requestId, target, input,
  });
  const write = id => id ?? crypto.randomUUID();
  async function send(body) {
    const response = await fetch('/modules', {method: 'POST', credentials: 'same-origin', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
    if (response.headers.get('content-type') === 'image/jpeg') return {ok: response.ok, status: response.status, bytes: new Uint8Array(await response.arrayBuffer())};
    const data = await response.json();
    return response.ok ? {ok: true, status: response.status, requestId: body.requestId, ...data} : {ok: false, status: response.status, code: data.code, requestId: body.requestId};
  }
  const hex = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  const header = value => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  async function upload(body, bytes) {
    const response = await fetch('/modules/upload', {method: 'POST', credentials: 'same-origin', headers: {'content-type': 'image/jpeg', 'whumpo-module-request': header(body)}, body: bytes});
    const data = await response.json();
    return response.ok ? {ok: true, status: response.status, requestId: body.requestId, ...data} : {ok: false, status: response.status, code: data.code, requestId: body.requestId};
  }
  const text = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
  return {
    me: () => send(envelope(members, 'access.me', null, null, null)),
    desk: (cursor = null) => send(envelope(requests, 'records.view', {viewId: 'desk', cursor}, null, null)),
    entry: entryId => send(envelope(requests, 'records.get', {recordId: 'request', entryId}, null, null)),
    note: (entryId, revision, note, {requestId} = {}) => send(envelope(requests, 'records.update', {recordId: 'request', entryId, revision, changes: {note}}, null, write(requestId))),
    change: (entryId, revision, changes, {requestId} = {}) => send(envelope(requests, 'records.update', {recordId: 'request', entryId, revision, changes}, null, write(requestId))),
    logCall: (values, {requestId} = {}) => send(envelope(requests, 'forms.submit', {formId: 'staff-form'}, {values}, write(requestId))),
    uploadIntake: async (bytes, {requestId} = {}) => upload(envelope(media, 'files.putBytes', {collectionId: 'intake'}, {mediaType: 'image/jpeg', byteLength: bytes.length, sha256: await hex(bytes)}, write(requestId)), bytes),
    intakeGallery: () => send(envelope(media, 'files.gallery', {collectionId: 'intake'}, null, null)),
    intakeImage: fileId => send(envelope(media, 'files.read', {collectionId: 'intake', fileId}, null, null)),
    directory: () => send(envelope(listings, 'collections.readPublic', {collectionId: 'directory'}, null, null)),
    /** Renders the desk view as escaped text; values are never interpreted as markup. */
    renderDesk: items => '<ul>' + items.map(i => `<li data-entry="${text(i.entryId)}">${Object.entries(i.values).map(([k, v]) => `<b>${text(k)}</b> ${text(v)}`).join(' ')}</li>`).join('') + '</ul>',
  };
}
