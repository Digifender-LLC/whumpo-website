import assert from 'node:assert/strict';
const base=process.env.BASE_URL||'http://localhost:8793';if(!/^http:\/\/localhost:/.test(base))throw Error('Local testing only');
async function request(path,method='GET',data,token='',origin=base){const r=await fetch(base+'/api'+path,{method,headers:{origin,'content-type':'application/json',cookie:token},body:data?JSON.stringify(data):undefined});const body=await r.json();return {status:r.status,body,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
const email='dashboard-preview@example.test',password='Synthetic-local-preview-2026!';
let a=await request('/auth/register','POST',{email,password});if(a.status===409)a=await request('/auth/login','POST',{email,password});assert.equal(a.status,200);const cookie=a.cookie;
assert.equal((await request('/workspace/dashboard')).status,401);
assert.equal((await request('/workspace/layout','PUT',{revision:0,layout:{widgets:['usage'],tabs:[]}},cookie,'https://untrusted.example')).status,403);
assert.equal((await request('/workspace/dashboard','GET',null,cookie)).status,200);
let config=(await request('/workspace/layout','GET',null,cookie)).body;
let saved=await request('/workspace/layout','PUT',{revision:config.revision,layout:{widgets:['projects','usage','storage','activity'],tabs:[{id:'tab-editorial',label:'Publishing desk',projectId:null,widgets:['cms','activity']}]}},cookie);assert.equal(saved.status,200);
assert.equal((await request('/workspace/layout','PUT',{revision:config.revision,layout:config.layout},cookie)).status,409);
let project=await request('/projects','POST',{name:'Neighborhood Journal',purpose:'A local community publication'},cookie);assert.equal(project.status,201);
console.log('Dashboard HTTP passed: authentication, CSRF, persistence and stale-save protection. Synthetic local browser fixture available.');
