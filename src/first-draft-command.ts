import {confirmationControls} from './chat-controls';
export const firstAppProjectId=(content:string)=>/^\/first-app ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.exec(content)?.[1];
export const firstDraftProjectId=(content:string)=>/^\/first-draft ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.exec(content)?.[1];
export function displayChatRequest(content:string){
 if(firstAppProjectId(content))return 'Build and test my first private app using my saved brief.';
 if(firstDraftProjectId(content))return 'Build my first private website draft using my saved brief.';
 if(/^\/design-app-page [0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(content))return 'Design the visitor page for my approved app and show me the review.';
 for(const control of Object.values(confirmationControls))if(new RegExp('^/'+control.verb+' [0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$').test(content))return control.label+'.';
 const id='[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
 if(new RegExp('^/confirm-specification '+id+' [0-9a-f]{64} [0-9]{1,15}$').test(content))return 'Save the exact reviewed private website version.';
 const shortcutLabels:Record<string,string>={project:'Show my project status.',versions:'Show my saved website versions.',health:'Show the saved health report for my website.','check-site':'Check whether my published website is responding.'};
 for(const [verb,label] of Object.entries(shortcutLabels))if(new RegExp('^/'+verb+' '+id+'$').test(content))return label;
 if(new RegExp('^/app-status '+id+'$').test(content))return 'Show the current status and usage of my app.';
 if(new RegExp('^/brief '+id+'$').test(content))return 'Show my saved project brief.';
 if(/^\/ai-history(?: [1-9]\d{0,2}| 1000)?$/.test(content))return 'Show my standard AI request history.';
 if(new RegExp('^/ai-request '+id+'$').test(content))return 'Show the saved status of this AI request.';
 const starter=new RegExp('^/build (ocean|clay|forest) '+id+'$').exec(content);
 if(starter)return 'Make a private starter preview with a '+({ocean:'fresh and bright',clay:'warm and cozy',forest:'calm and natural'}[starter[1]])+' feel.';
 // Presentation only: recognize complete requests, never interpret prose or grant approval.
 const media='[0-9A-HJKMNP-TV-Z]{26}';
 const imported=new RegExp('^/import-wordpress '+id+' '+id+' ([1-9][0-9]{0,15})(?: [|] ('+media+'(?: '+media+'){0,3}))?$').exec(content);
 if(imported&&Number.isSafeInteger(Number(imported[1])))return imported[2]?'Review this WordPress article with the local images I selected.':'Review this WordPress article for a private import.';
 if(new RegExp('^/cms-import-review '+id+'$').test(content))return 'Show my saved WordPress import review.';
 if(new RegExp('^/confirm-cms-import '+id+'$').test(content))return 'Import or recover this exact reviewed WordPress article as a private draft.';
 if(new RegExp('^/wordpress-inspect '+id+' '+id+'$').test(content))return 'Check the articles in my saved WordPress export.';
 if(new RegExp('^/wordpress-sources '+id+'$').test(content))return 'Show my saved WordPress exports.';
 if(new RegExp('^/confirm-app-restore '+id+' '+id+' RESTORE$').test(content))return 'Restore the exact reviewed application data.';
 if(new RegExp('^/confirm-app-upgrade '+id+' UPGRADE$').test(content))return 'Apply the exact reviewed app upgrade.';
 if(new RegExp('^/confirm-app-rollback '+id+' ROLLBACK$').test(content))return 'Apply the exact reviewed app rollback.';
 if(new RegExp('^/cancel-app-upgrade '+id+' CANCEL$').test(content))return 'Discard this reviewed upgrade check.';
 if(new RegExp('^/backend '+id+'$').test(content))return 'Read the saved program for this review.';
 if(new RegExp('^/backend-result '+id+'$').test(content))return 'Read the saved test result for this review.';
 if(new RegExp('^/verify-domain '+id+'$').test(content))return 'Check the saved domain ownership proof.';
 const domain=new RegExp('^/domain ([a-zA-Z0-9.-]{1,253}) '+id+'$').exec(content);
 if(domain)return 'Prepare ownership verification for '+domain[1]+'.';
 if(new RegExp('^/unpublish(?: '+id+')?$').test(content))return 'Prepare a review to take my website offline.';
 return content;
}
