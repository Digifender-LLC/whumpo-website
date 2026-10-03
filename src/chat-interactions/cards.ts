import {viewComponents} from '../workspace-view-contract';
import {assertFeature} from '../feature-admission';
import {FeatureInclusionError} from '../feature-inclusion';
import {copyJSON} from '../project-specification/v2/json';
import {readViewBinding} from '../workspace-view-bindings';
import {InteractionError} from './protocol';
import {InteractionStoreError,readInteraction} from './store';
import {readProjectStatusCard,type ProjectStatusCard} from './card-shape';

/** Resolve one immutable maintained binding through the existing domain read.
 * No submitted/draft answers, arbitrary selectors, effects or model dispatch. */
export async function readInteractionCard(db:D1Database,user:string,input:unknown):Promise<ProjectStatusCard>{
 const r=copyJSON(input,4096) as {version:number;interactionId:string;definitionDigest:string;cardId:string};
 if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).sort().join(',')!=='cardId,definitionDigest,interactionId,version')throw new InteractionError('SHAPE');
 if(r.version!==1)throw new InteractionError('VERSION');
 const current=await readInteraction(db,user,r.interactionId),e=current.envelope;
 if(r.definitionDigest!==e.definitionDigest)throw new InteractionError('DIGEST');
 const card=e.definition.cards.find(c=>c.id===r.cardId);
 if(e.definition.template!=='content-change@1'||!e.scope.projectId||!['open','submitted'].includes(current.state)||current.replacementInteractionId||!card||card.id!=='project-status'||card.binding!=='project.status@1'||card.display!=='status'||card.limit!==1||card.reviewId!==null)throw new InteractionStoreError(409,'adapter_unavailable');
 const gate={userId:user,projectId:e.scope.projectId,featureId:viewComponents.projects.feature,operation:'read' as const};
 const shared=await readViewBinding(db,user,'projects',e.scope.projectId);
 let status:ProjectStatusCard['status']=shared.status,data:ProjectStatusCard['data']=shared.kind==='projects'&&shared.status==='ready'?shared.data.items[0]:null;
 // A failed or late read must not expose previously fetched private data.
 const latest=await readInteraction(db,user,r.interactionId);
 if(latest.envelope.definitionDigest!==e.definitionDigest||latest.answerRevision!==current.answerRevision||latest.state!==current.state||latest.replacementInteractionId!==current.replacementInteractionId)throw new InteractionStoreError(409,'interaction_changed');
 try{await assertFeature(db,gate);}catch(error){if(!(error instanceof FeatureInclusionError))throw error;status='denied';}
 const result=readProjectStatusCard({version:1,interactionId:e.id,definitionDigest:e.definitionDigest,cardId:card.id,binding:card.binding,source:'project_service_status',asOf:latest.observedAt,status,data:status==='ready'?data:null});
 if(!result)throw new InteractionStoreError(503,'card_unavailable');
 return result;
}
