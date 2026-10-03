import {copyJSON} from '../project-specification/v2/json';
import {readViewBinding} from '../workspace-view-bindings';
import {InteractionError} from './protocol';
import {InteractionStoreError,readInteraction} from './store';
import {isWorkspaceViewDefinition} from './view-definition';

/** Immutable Chat definition selects the binding. Client selectors cannot
 * retarget it; late dismissal or access loss discards already-read facts. */
export async function readTemporaryViewComponent(db:D1Database,user:string,input:unknown){
 const r=copyJSON(input,4096) as {version:1;interactionId:string;definitionDigest:string;kind:string};
 if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).sort().join(',')!=='definitionDigest,interactionId,kind,version')throw new InteractionError('SHAPE');
 if(r.version!==1)throw new InteractionError('VERSION');
 const current=await readInteraction(db,user,r.interactionId),e=current.envelope,d=e.definition;
 if(r.definitionDigest!==e.definitionDigest)throw new InteractionError('DIGEST');
 if(!isWorkspaceViewDefinition(d)||current.state!=='open'||current.replacementInteractionId)throw new InteractionStoreError(409,'adapter_unavailable');
 const kind=d.workspaceView.widgets.find(k=>k===r.kind);
 if(!kind)throw new InteractionStoreError(404,'not_found');
 return readViewBinding(db,user,kind,e.scope.projectId,async()=>{
  const latest=await readInteraction(db,user,r.interactionId);
  if(latest.envelope.definitionDigest!==e.definitionDigest||latest.answerRevision!==current.answerRevision||latest.state!=='open'||latest.replacementInteractionId)throw new InteractionStoreError(409,'interaction_changed');
 });
}
