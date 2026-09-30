import {nativeDraftIdentityAllowed} from '../../../src/cms-draft-identity';
import {isCMSMediaUpload,verifyCMSMediaUpload} from '../../../src/cms-media-upload-bridge';
import {env} from 'cloudflare:workers';
import {cmsBridgeConfig,verifyCMSRequest,cmsRequestAllowed} from '../../../src/cms-bridge';
export async function authenticate(request:Request){
 const config=cmsBridgeConfig(env as unknown as Record<string,unknown>);
 if(isCMSMediaUpload(request))await verifyCMSMediaUpload(request,config);
 else {const verified=await verifyCMSRequest(request,config);if(!cmsRequestAllowed(request.method,verified.path,verified.body)&&!nativeDraftIdentityAllowed(request.method,verified.path,verified.body,verified.id))throw new Error('CMS operation not authorized');}
 return {email:config.ownerId+'@owners.townhello.invalid',name:'TownHello project owner',role:50,subject:config.ownerId};
}
