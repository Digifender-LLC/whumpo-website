/** Restrict saved-link queries to the bounded current projection. Fifty IDs
 * leave room for owner and domain predicates under D1's parameter limit. */
export function chatTurnGroups(turns:Record<string,unknown>[]){
 const ids=[...new Set(turns.slice(0,100).filter(t=>t.status==='completed').map(t=>t.id).filter((id):id is string=>typeof id==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)))];
 const groups:string[][]=[];
 for(let offset=0;offset<ids.length;offset+=50)groups.push(ids.slice(offset,offset+50));
 return groups;
}
