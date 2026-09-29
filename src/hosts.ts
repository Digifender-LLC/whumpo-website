/** Product and customer origins are separate trust boundaries. */
export const platformOrigin='https://whumpo.com';
export const customerDomain='whumpo.site';
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const projectHost=(id:string)=>`${id}.${customerDomain}`;
export const projectOrigin=(id:string)=>`https://${projectHost(id)}`;
export const visitorOrigin=(id:string)=>`https://app-${id}.${customerDomain}`;
export function customerProject(host:string){return host.match(new RegExp(`^(${uuid})\\.whumpo\\.site$`))?.[1]??null;}
export function visitorProject(host:string){return host.match(new RegExp(`^app-(${uuid})\\.whumpo\\.site$`))?.[1]??null;}
