export type Answer=string|number|boolean|string[];
export type Answers=Record<string,Answer>;
export type FieldType='text'|'long-text'|'choice'|'multi-choice'|'boolean'|'number'|'date'|'datetime'|'resource'|'attachment';
export type ContentSource={binding:'site.content@1';contentId:string;revision:number};
type CommonField={id:string;label:string;help:string;required:boolean;binding:'answer.value@1';
 default?:{value:Answer;provenance:'saved'|'user'|'suggested'};
 when?:{fieldId:string;equals:Answer};source?:ContentSource;group?:number};
export type Field=CommonField&(
 {type:'text'|'long-text';constraints:{maxLength:number}}|
 {type:'choice'|'multi-choice';constraints:{options:{id:string;label:string}[]}}|
 {type:'boolean'|'date';constraints:Record<string,never>}|
 {type:'number';constraints:{min:number;max:number;step:number}}|
 {type:'datetime';constraints:{zone:string}}|
 {type:'resource'|'attachment';constraints:{collection:'projects'|'photos';multiple:boolean;maxItems:number}}
);
export type Card={id:string;binding:string;display:string;limit:number;reviewId:string|null};
export type Definition={version:1;kind:'form'|'view';template:'content-change@1'|'project-brief@1'|'project-select@1'|'choice@1'|'custom@1'|'status@1';
 title:string;summary:string;presentation:'inline'|'panel'|'dialog';fields:Field[];cards:Card[];
 submitBinding:'interaction.answers@1'|null;continuationBinding:'site.content-prepare@1'|null};
export type InteractionScope={accountId:string;actorId:string;conversationId:string;projectId:string|null;taskId:string;originTurnId:string};
export type UnsignedInteraction={version:1;id:string;scope:InteractionScope;createdAt:string;expiresAt:string;definition:Definition};
export type IssuedInteraction=UnsignedInteraction&{definitionDigest:string};
export type ClientCapabilities={versions:number[];fieldTypes:FieldType[];bindings:string[]};
export type Mutation={version:1;requestId:string;interactionId:string;definitionDigest:string;expectedAnswerRevision:number}&(
 {operation:'save-draft'|'submit';answers:Answers}|{operation:'cancel';answers?:never}
);
export type OwnedResources={projects?:readonly string[];photos?:readonly string[]};
export type InteractionReceipt={version:1;requestId:string;requestDigest:string;interactionId:string;operation:Mutation['operation'];answerRevision:number;createdAt:string};
export type Continuation={id:string;state:'not-started'|'pending'|'succeeded'|'failed'|'unknown';resultTurnId:string|null;reason:string|null};
export type InteractionRead={version:1;envelope:IssuedInteraction;projectName:string|null;previousInteractionId:string|null;replacementInteractionId:string|null;
 state:'open'|'submitted'|'canceled'|'superseded'|'expired';answerRevision:number;draft:Answers;observedAt:string;draftRetainUntil:string|null;
 submission:null|{id:string;answers:Answers;answersDigest:string;answerRevision:number;createdAt:string;continuation:Continuation|null}};
