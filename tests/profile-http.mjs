import assert from 'node:assert/strict';
const base=process.env.BASE_URL||'http://localhost:8793';if(!/^http:\/\/localhost:/.test(base))throw Error('Synthetic local accounts only');
const email='profile-'+crypto.randomUUID()+'@example.test',password='Initial-synthetic-password!',next='Replacement-synthetic-password!';
async function call(path,method='GET',data,cookie='',origin=base){const r=await fetch(base+'/api'+path,{method,headers:{origin,cookie,'content-type':'application/json'},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
const a=await call('/auth/register','POST',{email,password});assert.equal(a.status,200);
assert.equal((await call('/profile')).status,401);
assert.equal((await call('/profile','PATCH',{revision:0,name:'Synthetic'},a.cookie,'https://untrusted.example')).status,403);
const profile=await call('/profile','PATCH',{revision:0,name:'Synthetic',about_me:'Local test',share_context:false,theme:'dark'},a.cookie);assert.equal(profile.status,200);assert.equal(profile.data.theme,'dark');
const changed=await call('/profile/password','POST',{currentPassword:password,newPassword:next},a.cookie);assert.equal(changed.status,200,JSON.stringify(changed.data));
assert.equal((await call('/me','GET',null,a.cookie)).status,401);assert.equal((await call('/me','GET',null,changed.cookie)).status,200);
assert.equal((await call('/auth/login','POST',{email,password})).status,401);assert.equal((await call('/auth/login','POST',{email,password:next})).status,200);
console.log('Real Worker profile HTTP passed: private reads, origin rejection, saved preferences, password replacement, old-session revocation and fresh login.');
