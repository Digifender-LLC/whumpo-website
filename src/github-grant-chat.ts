import {ConnectionError} from './github-connection';
import {githubGrantReviews,readGitHubGrant,reviewGitHubGrant,confirmGitHubGrant,cancelGitHubGrant,type GitHubGrantReview} from './github-grant-revocation';
import {linkChatReviewReply,requireReviewedReply} from './chat-review-receipts';
import type {BackupChatOptions} from './backup-chat';

const id=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
export function describeGitHubGrant(r:GitHubGrantReview){
 const status={review:'Awaiting your decision',expired:'Review expired',cancelled:'Cancelled before sending',dispatching:'Result not yet confirmed',uncertain:'Result not yet confirmed',revoked:'GitHub confirmed access removal'}[r.state];
 return `GitHub access review ${r.id}\n${status}\nAccount: ${r.login} (GitHub ID ${r.githubUserId})\nSaved credentials covered: ${r.credentialCount}\n\n${r.disclosure}\n\n`+(r.state==='review'?`Use the review card to confirm or cancel. Review expires ${r.expiresAt}.`:r.state==='revoked'?`GitHub confirmed this request at ${r.settledAt}. This saved receipt does not describe any later authorizations.`:['dispatching','uncertain'].includes(r.state)?'Whumpo has disabled the reviewed local access. The provider result needs recovery; this request will not be sent again.':r.state==='cancelled'?'This review made no request to GitHub.':'Ask for a new review if you still want to remove access.');
}
/** Model operations can prepare or read only. Confirmation never enters this vocabulary. */
export async function githubGrantAction(db:D1Database,user:string,turn:string,action:Record<string,unknown>,options:BackupChatOptions={}){
 const read=action.operation==='read';
 if(action.kind!=='githubAccess'||!['review','read','list'].includes(String(action.operation))||Object.keys(action).some(k=>!['kind','operation',...(read?['reviewId']:[])].includes(k))||read&&!id(action.reviewId))throw new ConnectionError(400,'Choose preparation, saved review, or history for GitHub access removal.');
 if(action.operation==='list'){
  const {reviews}=await githubGrantReviews(db,user);
  return {reply:reviews.length?reviews.map(r=>`${r.id} · ${r.login} · ${r.state}`).join('\n')+'\nAsk to open one saved GitHub access review. Reading history approves nothing.':'No GitHub access removal reviews are saved.',statements:[] as D1PreparedStatement[]};
 }
 const review=read?await readGitHubGrant(db,user,String(action.reviewId)):await reviewGitHubGrant(db,user,turn,options.github),reply=describeGitHubGrant(review);
 await linkChatReviewReply(db,user,turn,reply);
 return {reply,statements:[] as D1PreparedStatement[]};
}
/** Returned closure is invoked only after the explicit customer Chat turn is saved. */
export function githubGrantChatControl(db:D1Database,user:string,command:string,options:BackupChatOptions={}){
 const match=/^\/github-grant-(confirm|cancel) ([0-9a-f-]{36})$/.exec(command);
 if(!match||!id(match[2]))return;
 return async()=>{
  try{return describeGitHubGrant(match[1]==='confirm'?await confirmGitHubGrant(db,user,match[2],'REVOKE_APP_ACCESS',options.github,options.githubTransport,await requireReviewedReply(db,user,'githubGrant',match[2])):await cancelGitHubGrant(db,user,match[2]));}
  catch(error){return (error instanceof ConnectionError?error.message:'The access removal result could not be confirmed.')+' Open the saved review in Settings → External connections to check its current state. This Chat request will not be sent again.';}
 };
}
/** Only a server receipt and matching saved reply can attach a current action card. */
export async function githubGrantChatActions(db:D1Database,user:string,turns:Record<string,unknown>[],receipts:Map<string,{kind:string;review_id:string}>){
 for(const turn of turns)delete turn.github_grant_review;
 for(const turn of turns.filter(t=>receipts.get(String(t.id))?.kind==='githubGrant').slice(0,20)){
  const receipt=receipts.get(String(turn.id))!;
  turn.github_grant_review=await readGitHubGrant(db,user,receipt.review_id);
 }
}
