import {isCMSMediaUpload,verifyCMSMediaUpload} from '../../../src/cms-media-upload-bridge';
import {env} from 'cloudflare:workers';
import {cmsBridgeConfig,verifyCMSRequest,cmsRequestAllowed} from '../../../src/cms-bridge';
export async function authenticate(request:Request){
 const config=cmsBridgeConfig(env as unknown as Record<string,unknown>);
 if(isCMSMediaUpload(request))await verifyCMSMediaUpload(request,config);
 else {const verified=await verifyCMSRequest(request,config);if(!cmsRequestAllowed(request.method,verified.path,verified.body))throw new Error('CMS operation not authorized');}
 return {email:config.ownerId+'@owners.whumpo.invalid',name:'Whumpo project owner',role:50,subject:config.ownerId};
}
