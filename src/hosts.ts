/** Product and customer origins are separate trust boundaries. */
export const platformOrigin='https://whumpo.com';
export const customerDomain='whumpo.site';
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const projectHost=(id:string)=>`${id}.${customerDomain}`;
export const projectOrigin=(id:string)=>`https://${projectHost(id)}`;
export const visitorOrigin=(id:string)=>`https://app-${id}.${customerDomain}`;
export function customerProject(host:string){return host.match(new RegExp(`^(${uuid})\\.whumpo\\.site$`))?.[1]??null;}
export function visitorProject(host:string){return host.match(new RegExp(`^app-(${uuid})\\.whumpo\\.site$`))?.[1]??null;}
/** WH-092 guest previews use one fixed host on the customer domain, never the workspace origin,
 * so no workspace cookie is sent to it. The bearer token lives only in the URL fragment. */
export const guestPreviewHost=`preview.${customerDomain}`;
export const guestPreviewOrigin=`https://${guestPreviewHost}`;
