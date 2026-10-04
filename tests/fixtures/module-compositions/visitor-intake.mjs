// WH-130 synthetic composition B: a visitor intake form and personal gallery. A different frontend from the staff
// portal, written against the same whumpo-modules v1 contract and the same instances on the project's visitor
// origin. It holds no identity, principal, permission, approval, storage location or query of its own; the browser
// attaches the project's own cookie and the shared module handlers decide everything. The anonymous intake passes the
// Turnstile widget's token through the documented header only. No dependency is loaded.

/** Creates the intake page over a same-origin fetch and the composed instance manifest. */
export function visitorIntake({fetch, manifest}) {
  const {members, requests, media, listings} = manifest.instances;
  const call = async (path, headers, body) => {
    const response = await fetch(path, {method: 'POST', credentials: 'same-origin', headers, body});
    if (response.headers.get('content-type') === 'image/jpeg') return {ok: response.ok, status: response.status, bytes: new Uint8Array(await response.arrayBuffer())};
    const data = await response.json();
    return response.ok ? {ok: true, status: response.status, ...data} : {ok: false, status: response.status, code: data.code};
  };
  const request = (instance, operation, target, input, write) => ({
    api: 'whumpo-modules', version: 1, operation, resourceId: instance.resourceId, configRevision: instance.configRevision,
    requestId: write ? (write.requestId ?? crypto.randomUUID()) : null, target, input,
  });
  const json = (body, extra = {}) => call('/modules', {'content-type': 'application/json', ...extra}, JSON.stringify(body));
  const encode = value => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  return {
    me: () => json(request(members, 'access.me', null, null, null)),
    submit: (values, options = {}) => json(request(requests, 'forms.submit', {formId: 'request-form'}, {values}, options)),
    /** Anonymous intake: the token comes from the Turnstile widget and travels outside the request body. */
    submitAnonymously: (values, token, options = {}) => json(request(requests, 'forms.submit', {formId: 'public-form'}, {values}, options), {'whumpo-turnstile-response': token}),
    myRequests: (cursor = null) => json(request(requests, 'records.view', {viewId: 'mine', cursor}, null, null)),
    myRequest: entryId => json(request(requests, 'records.get', {recordId: 'request', entryId}, null, null)),
    addPhoto: async (bytes, options = {}) => {
      const body = request(media, 'files.putBytes', {collectionId: 'mine'}, {mediaType: 'image/jpeg', byteLength: bytes.length, sha256: await digest(bytes)}, options);
      return call('/modules/upload', {'content-type': 'image/jpeg', 'whumpo-module-request': encode(body)}, bytes);
    },
    myGallery: () => json(request(media, 'files.gallery', {collectionId: 'mine'}, null, null)),
    myPhoto: fileId => json(request(media, 'files.read', {collectionId: 'mine', fileId}, null, null)),
    directory: () => json(request(listings, 'collections.readPublic', {collectionId: 'directory'}, null, null)),
  };
}
