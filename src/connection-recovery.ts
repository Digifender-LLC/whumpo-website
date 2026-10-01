// Exact read protocol shared by backup execution and protected uncertain-effect recovery.
export const backupPathsQuery='query BackupPaths($owner:String!,$name:String!,$p0:String!,$p1:String!,$p2:String!,$p3:String!){repository(owner:$owner,name:$name){p0:object(expression:$p0){__typename oid} p1:object(expression:$p1){__typename oid} p2:object(expression:$p2){__typename oid} p3:object(expression:$p3){__typename oid}}}';
export function backupPathsVariables(owner:string,name:string,path:string,head:string){
 const segments=path.split('/'),paths=segments.map((_,i)=>head+':'+segments.slice(0,i+1).join('/'));
 return {owner,name,p0:paths[0],p1:paths[1],p2:paths[2],p3:paths[3]};
}
export function backupRecoveryRead(b:{repo_owner:string;repo_name:string;branch:string;path:string},path:string,options:RequestInit){
 const repo='/repos/'+encodeURIComponent(b.repo_owner)+'/'+encodeURIComponent(b.repo_name),method=options.method??'GET';
 if(method==='GET'&&options.body===undefined)return path===repo||path===repo+'/git/ref/heads/'+encodeURIComponent(b.branch);
 if(method!=='POST'||path!=='/graphql'||typeof options.body!=='string')return false;
 try{
  const body=JSON.parse(options.body),v=body.variables,head=typeof v?.p0==='string'?v.p0.slice(0,40):'';
  const expected=backupPathsVariables(b.repo_owner,b.repo_name,b.path,head);
  return Object.keys(body).sort().join(',')==='query,variables'&&body.query===backupPathsQuery&&/^[0-9a-f]{40}$/.test(head)
   &&Object.keys(v).sort().join(',')===Object.keys(expected).sort().join(',')&&Object.entries(expected).every(([key,value])=>v[key]===value);
 }catch{return false;}
}
export function dnsRecoveryRead(a:{zone_id:string;record_name:string},path:string,method:string,body:unknown){
 return method==='GET'&&body===undefined&&(path==='/zones/'+a.zone_id||path==='/zones/'+a.zone_id+'/dns_records?'+new URLSearchParams({'name.exact':a.record_name,per_page:'100',page:'1'}));
}
