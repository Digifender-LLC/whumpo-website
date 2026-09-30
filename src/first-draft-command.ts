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
 return content;
}
