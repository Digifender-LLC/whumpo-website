import { previewHeaders } from './components';
/** Public serving boundary: no authentication, writes, credentials or workspace routes. */
export default {
 async fetch(request:Request,env:Pick<Env,'DB'>):Promise<Response>{
  const url=new URL(request.url);
  const headers={...previewHeaders,'cache-control':'no-store'};
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405,headers:{...headers,allow:'GET, HEAD'}});
  const match=url.pathname.match(/^\/s\/([0-9a-f-]{36})\/?$/);
  if(!match)return new Response('Site not found',{status:404,headers});
  const site=await env.DB.prepare('SELECT v.html FROM publications s JOIN site_versions v ON v.id=s.version_id AND v.project_id=s.project_id WHERE s.project_id=?').bind(match[1]).first<{html:string}>();
  return site?new Response(request.method==='HEAD'?null:site.html,{headers}):new Response('Site not found',{status:404,headers});
 }
} satisfies ExportedHandler<Pick<Env,'DB'>>;
