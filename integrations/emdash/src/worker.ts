import {invalidateTermCache} from 'emdash';
import handler, {createScheduledHandler, PluginBridge} from '@emdash-cms/cloudflare/worker';
import {cmsGateway} from '../../../src/cms-gateway';
export {PluginBridge};
export default {...handler, async fetch(request,env,ctx){if(env.EMDASH_SITE_URL!==env.WHUMPO_CMS_ORIGIN)return Response.json({error:'CMS origin is not configured'},{status:503});return cmsGateway(request,env,r=>handler.fetch(r,env,ctx),invalidateTermCache);}, scheduled:createScheduledHandler({generalCron:'17 * * * *'})};
