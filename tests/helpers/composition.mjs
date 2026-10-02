// Synthetic planning setup for tests whose focus is the downstream lifecycle.
// The connected planner suite separately verifies missing/foreign/stale plan rejection.
import {currentSiteFixtureHandlers} from '../current-site-fixture.mjs';
export async function fixtureExtensionPlan(db,user,project,turn,scope='custom.computation',baseVersionId){
 const {compositionPlans:{prepareCompositionPlan}}=await currentSiteFixtureHandlers();
 const existing=await db.prepare('SELECT id FROM composition_plans WHERE id=? AND user_id=? AND project_id=?').bind(turn,user,project).first();
 if(existing)return turn;
 if(!baseVersionId)baseVersionId=(await db.prepare('SELECT id FROM backend_versions WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 1').bind(project).first())?.id;
 await prepareCompositionPlan(db,user,turn,{kind:'capabilities',operation:'plan',projectId:project,needs:[scope],extension:{missing:'The fixture requires a bounded custom JSON transformation absent from the shared helpers.',...(baseVersionId?{baseVersionId}:{})}});
 return turn;
}
