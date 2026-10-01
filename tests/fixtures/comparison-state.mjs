import {createFixtureWebsite,changeFixtureWebsite} from '../current-site-fixture.mjs';
import {sqliteD1} from '../sqlite-d1.mjs';
// Synthetic, in-memory state for actual-handler comparison acceptance. No provider calls.
import {build} from 'esbuild';
export async function comparisonFixture(){
 const {outputFiles}=await build({stdin:{contents:"export {default as worker} from './src/index';export {hashToken} from './src/security';export {comparisonErrorResponse} from './src/comparison-page';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
 const {worker,hashToken,comparisonErrorResponse}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
 const {sql,db}=await sqliteD1();
 try{
  const owner=crypto.randomUUID(),other=crypto.randomUUID(),project=crypto.randomUUID(),fresh=crypto.randomUUID(),expired=crypto.randomUUID(),missing=crypto.randomUUID(),token=(crypto.randomUUID()+crypto.randomUUID()).replaceAll('-',''),otherToken=(crypto.randomUUID()+crypto.randomUUID()).replaceAll('-','');
  const now=new Date().toISOString(),later=new Date(Date.now()+3600000).toISOString();
  for(const [id,key] of [[owner,token],[other,otherToken]]){
   sql.prepare("INSERT INTO users VALUES(?,?,'00','passkey-only',?)").run(id,id+'@example.invalid',now);
   sql.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(await hashToken(key),id,later,now);
  }
  sql.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'River & Garden','Synthetic private comparison','draft',?,?)").run(project,owner,now,now);
  sql.prepare('INSERT OR IGNORE INTO publications(project_id,revision,version_id) VALUES(?,0,NULL)').run(project);
  const config={name:'River & Garden',description:'Local garden care.',theme:'forest',headline:'Thoughtful gardens, happy neighbors',aboutTitle:'Our approach',aboutText:'Gardens for everyday life. <script>synthetic text only</script>',sections:[{heading:'Seasonal services',text:'Garden planning\nPlanting and ongoing care'}]};
  const version=await createFixtureWebsite(db,owner,project,{...config,photos:[]}),corrupt=await changeFixtureWebsite(db,owner,project,[{type:'design.setTheme',theme:'ocean'}]);
  sql.exec('DROP TRIGGER site_versions_immutable');sql.prepare('UPDATE site_versions SET digest=? WHERE id=?').run('0'.repeat(64),corrupt);
  for(const [id,expiry] of [[fresh,later],[expired,'2000-01-01T00:00:00.000Z']])sql.prepare("INSERT INTO publication_actions(id,user_id,project_id,kind,version_id,expected_revision,expires_at,status) VALUES(?,?,?,'publish',?,0,?,'pending')").run(id,owner,project,version,expiry);
  const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){throw Error('Unexpected background work');}};
  const paths={fresh:'/api/publication-reviews/'+fresh+'/diff',expired:'/api/publication-reviews/'+expired+'/diff',missing:'/api/publication-reviews/'+missing+'/diff',comparison:'/api/site-versions/'+version+'/diff',corrupt:'/api/site-versions/'+corrupt+'/diff'};
  const request=(path,options={})=>{const headers=new Headers({accept:options.accept??'text/html',...(options.token===null?{}:{cookie:'whumpo_session='+(options.token??token)})});return new Request('https://whumpo.com'+path,{method:options.method??'GET',headers});};
  const state=()=>JSON.stringify({publications:sql.prepare('SELECT * FROM publications').all(),reviews:sql.prepare('SELECT * FROM publication_actions').all(),versions:sql.prepare('SELECT id,digest FROM site_versions').all()});
  return {worker,env,ctx,paths,token,otherToken,request,state,comparisonErrorResponse,close:()=>sql.close()};
 }catch(error){sql.close();throw error;}
}
