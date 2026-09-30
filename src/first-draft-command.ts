export const firstAppProjectId=(content:string)=>/^\/first-app ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.exec(content)?.[1];
export const firstDraftProjectId=(content:string)=>/^\/first-draft ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.exec(content)?.[1];
export function displayChatRequest(content:string){
 if(firstAppProjectId(content))return 'Build and test my first private app using my saved brief.';
 if(firstDraftProjectId(content))return 'Build my first private website draft using my saved brief.';
 if(/^\/design-app-page [0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(content))return 'Design the visitor page for my approved app and show me the review.';
 const id='[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
 if(new RegExp('^/app-status '+id+'$').test(content))return 'Show the current status and usage of my app.';
 if(new RegExp('^/brief '+id+'$').test(content))return 'Show my saved project brief.';
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
 return content;
}
