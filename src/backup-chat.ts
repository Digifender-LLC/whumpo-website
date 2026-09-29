import {ConnectionError,githubInstallations,type GitHubConfig} from './github-connection';
import {githubRepositories,listBackups,reviewBackup,confirmBackup} from './github-backups';
export type BackupChatOptions={github?:GitHubConfig;githubTransport?:typeof fetch;files?:R2Bucket};
const uuid=/^[0-9a-f-]{36}$/,positive=(s:string)=>/^[1-9][0-9]*$/.test(s)&&Number.isSafeInteger(Number(s));
type Receipt=Awaited<ReturnType<typeof reviewBackup>>;
function describe(b:Receipt){
 const header=`GitHub backup: ${b.state}\nReview: ${b.id}\nVersion: ${b.versionId}\nRepository: ${b.repository} (${b.private?'private':'PUBLIC — anyone can read these files'})\nBranch: ${b.branch}\nFolder: ${b.path}`;
 if(b.state==='pending')return `${header}\n\nFiles: ${b.files.join(', ')}\nSource size: ${b.bytes} bytes\nSHA-256: ${b.sha256}\n\nConfirming copies this saved website's source and included photos to GitHub in one commit. It excludes account credentials and chat history. Existing repository files are preserved; a changed branch or conflicting folder requires another review. This does not publish or alter your TownHello website.\nReview expires: ${b.expiresAt}\n\nSend /confirm-backup ${b.id} to authorize this exact backup.`;
 if(b.state==='expired')return `${header}\nThis review expired. Prepare a new review with /review-backup VERSION_ID OWNER/REPO REPO_ID.`;
 return `${header}\n${b.detail}\n${b.url?'Verified source copy: '+b.url:['dispatching','uncertain'].includes(b.state)?'/check-backup '+b.id+' reads GitHub without resending a commit. If unresolved, operator reconciliation is required.':'Prepare a fresh review after resolving the reported problem.'}\nThis is a historical receipt, not a guarantee of the repository\'s current contents or visibility.`;
}
/** Runs only after the caller has durably claimed the chat turn. Configuration never enters AI context. */
export function backupChatCommand(db:D1Database,user:string,turnId:string,command:string,options:BackupChatOptions={}){
 const [verb,...args]=command.split(/\s+/);
 if(!['/backups','/github-installations','/github-repos','/review-backup','/confirm-backup','/check-backup'].includes(verb))return;
 const repo=args[1]?.split('/');
 const invalid=['/backups','/github-installations'].includes(verb)?args.length>0:verb==='/github-repos'?args.length<1||args.length>2||!positive(args[0])||args.length===2&&(!positive(args[1])||Number(args[1])>50):verb==='/review-backup'?args.length!==3||!uuid.test(args[0])||repo?.length!==2||!/^[A-Za-z0-9-]{1,39}$/.test(repo[0])||!/^[A-Za-z0-9_.-]{1,100}$/.test(repo[1])||['.','..'].includes(repo[1])||!positive(args[2]):args.length!==1||!uuid.test(args[0]);
 if(invalid)throw new ConnectionError(400,'Use /backups, /github-installations, /github-repos INSTALLATION_ID [PAGE], /review-backup VERSION_ID OWNER/REPO REPO_ID, /confirm-backup REVIEW_ID or /check-backup REVIEW_ID.');
 return async()=>{
  try{
   if(verb==='/backups'){const {backups}=await listBackups(db,user);return (backups.length?backups.map(describe).join('\n\n'):'No GitHub backup reviews yet.')+'\n\nUse /github-installations, then /github-repos INSTALLATION_ID to find authorized repositories. /versions lists saved website versions. /review-backup VERSION_ID OWNER/REPO REPO_ID prepares a review without committing files. Connect or disconnect GitHub in Connected accounts. Guided commands use no AI units.';}
   if(verb==='/github-installations'){const result=await githubInstallations(db,user,options.github,options.githubTransport);return (result.installations.length?result.installations.map(i=>`${i.account} · ${i.repositorySelection==='selected'?'selected repositories':'all repositories'}\nInstallation: ${i.id}\n/github-repos ${i.id}`).join('\n\n'):'No active GitHub App installations found. Choose repositories in Connected accounts.')+(result.truncated?'\nOnly the first 100 installations were checked.':'');}
   if(verb==='/github-repos'){const page=Number(args[1]??1),result=await githubRepositories(db,user,options.github,Number(args[0]),page,options.githubTransport);return (result.repositories.length?result.repositories.map(r=>`${r.owner}/${r.name} · ${r.private?'private':'PUBLIC'} · default branch: ${r.branch}\nRepository ID: ${r.id}`).join('\n\n'):'No writable repositories on this page.')+(result.hasMore?'\n\nNext page: /github-repos '+args[0]+' '+(page+1):'')+'\n\nUse /review-backup VERSION_ID OWNER/REPO REPO_ID to review the exact saved source. Public repositories expose the source and included photos to anyone.';}
   if(verb==='/review-backup')return describe(await reviewBackup(db,options.files,user,{id:turnId,versionId:args[0],owner:repo![0],repo:repo![1],repoId:Number(args[2])},options.github,options.githubTransport));
   if(verb==='/check-backup'){const {backups}=await listBackups(db,user),b=backups.find(b=>b.id===args[0]);if(!b)throw new ConnectionError(404,'Backup review not found.');if(['pending','expired','complete','failed'].includes(b.state))return describe(b)+'\nThis check did not authorize a commit.';}
   return describe(await confirmBackup(db,options.files,user,args[0],options.github,options.githubTransport));
  }catch(cause){return cause instanceof ConnectionError?cause.message+'\nUse /backups to inspect saved reviews.':'The backup command result could not be saved. Use /backups to inspect reviews. This chat message will not be dispatched again.';}
 };
}
