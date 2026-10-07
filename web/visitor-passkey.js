import {startRegistration,startAuthentication} from '@simplewebauthn/browser';
/** Shared presentation adapter. Credential validation and sessions stay in the maintained visitor gateway. */
export async function visitorPasskey(api,kind,inviteCode){
 const {options}=await api('auth/'+kind+'/options',kind==='signup'?{inviteCode}:{});
 const credential=kind==='login'?await startAuthentication({optionsJSON:options}):await startRegistration({optionsJSON:options});
 return api('auth/'+kind+'/verify',{credential});
}
