const projectPattern=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export function visitorProjectFromSearch(search:string){
 const values=new URLSearchParams(search).getAll('project');
 return values.length===1&&projectPattern.test(values[0])?values[0]:'';
}
/** Navigation only: never creates an invitation or grants visitor access. */
export function visitorAccessCommand(input:string):{projectId?:string;error?:never}|{error:string;projectId?:never}|undefined{
 const value=input.trim();if(!/^\/visitor-access(?:\s|$)/i.test(value))return;
 const parts=value.split(/\s+/);
 if(parts.length>2||(parts[1]&&!projectPattern.test(parts[1])))return {error:'Use /visitor-access, optionally followed by a project ID.'};
 return {projectId:parts[1]};
}
