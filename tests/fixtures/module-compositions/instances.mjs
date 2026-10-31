// The one composition of four module instances both WH-130 compositions are written against. The local acceptance
// (tests/shared-modules-compositions.mjs) and the live deployed check (tests/module-live.mjs) import this, so the two
// cannot drift. `pins(kind)` returns the current catalog pins {module,schema} for a module kind.
// Access (staff role), records (visitor, staff and public forms; a staff desk and a visitor own view), files (staff-only
// intake, visitor own gallery) and the directory content collection.
export const fields=[{key:'name',label:'Name',type:'text',optional:false,read:'owner'},
 {key:'topic',label:'Topic',type:'choice',options:[{value:'repair',label:'Repair'},{value:'visit',label:'Visit'}],optional:false,read:'submitter'},
 {key:'note',label:'Note',type:'text',optional:true,read:'staff'},{key:'urgent',label:'Urgent',type:'boolean',optional:false,read:'submitter'},
 {key:'count',label:'Count',type:'number',optional:false,read:'staff'}];
const collection=(cid,read,upload,gallery)=>({id:cid,read,upload,maxBytes:1048576,mediaTypes:['image/jpeg'],gallery});
export function moduleInstances(pins){
 const accessInstance={id:'members',kind:'access',...pins('access'),dependencies:[],config:{roles:['staff'],enrollment:'invitation'}};
 const recordsInstance=(schemaFields=fields,fieldsRevision=1)=>({id:'requests',kind:'records',...pins('records'),dependencies:['members'],config:{retentionDays:90,
  schemas:[{id:'request',fieldsRevision,fields:schemaFields,staffWrite:['note','count']}],
  forms:[{id:'request-form',recordId:'request',submit:'visitor',uploadCollectionId:null},{id:'staff-form',recordId:'request',submit:'staff',uploadCollectionId:null},{id:'public-form',recordId:'request',submit:'public',uploadCollectionId:null}],
  views:[{id:'mine',recordId:'request',audience:'visitor',scope:'own',fields:['topic','urgent'],limit:10},{id:'desk',recordId:'request',audience:'staff',scope:'all',fields:['topic','note','count'],limit:50}]}});
 const filesInstance={id:'media',kind:'files',...pins('files'),dependencies:['members'],config:{collections:[collection('intake','staff',['staff'],{audience:'staff'}),collection('mine','submitter',['visitor'],{audience:'visitor'})]}};
 const contentInstance={id:'listings',kind:'content',...pins('content'),dependencies:[],config:{collections:[{id:'directory',type:'directory-listing@1'}]}};
 return {accessInstance,recordsInstance,filesInstance,contentInstance};
}
