export const firstDraftProjectId=(content:string)=>/^\/first-draft ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.exec(content)?.[1];
export function displayChatRequest(content:string){
 if(firstDraftProjectId(content))return 'Build my first private website draft using my saved brief.';
 const id='[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
 if(new RegExp('^/brief '+id+'$').test(content))return 'Show my saved project brief.';
 const starter=new RegExp('^/build (ocean|clay|forest) '+id+'$').exec(content);
 if(starter)return 'Make a private starter preview with a '+({ocean:'fresh and bright',clay:'warm and cozy',forest:'calm and natural'}[starter[1]])+' feel.';
 return content;
}
