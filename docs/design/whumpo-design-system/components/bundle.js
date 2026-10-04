/* @ds-bundle: {"format":4,"namespace":"Whumpo","components":[{"name":"Brand"},{"name":"Icon"},{"name":"Button"},{"name":"StatusBadge"},{"name":"ChatMessage"},{"name":"Composer"},{"name":"ProgressCard"},{"name":"ServiceTile"},{"name":"ApprovalCard"}]} */
(function(){
var R=window.React,h=R.createElement;
var ICONS={"home": "<path d=\"M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19z\"/>", "globe": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5S9.6 5.8 12 3.5z\"/>", "database": "<ellipse cx=\"12\" cy=\"6\" rx=\"7.5\" ry=\"2.75\"/><path d=\"M4.5 6v6c0 1.5 3.4 2.75 7.5 2.75s7.5-1.25 7.5-2.75V6M4.5 12v6c0 1.5 3.4 2.75 7.5 2.75s7.5-1.25 7.5-2.75v-6\"/>", "storage": "<path d=\"M7.5 18.5a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17.6 9.6a4.45 4.45 0 0 1-.6 8.9z\"/>", "server": "<rect x=\"4\" y=\"4.5\" width=\"16\" height=\"6.5\" rx=\"2\"/><rect x=\"4\" y=\"13\" width=\"16\" height=\"6.5\" rx=\"2\"/><path d=\"M8 7.75h.01M8 16.25h.01M12 7.75h4M12 16.25h4\"/>", "person": "<circle cx=\"12\" cy=\"8\" r=\"3.75\"/><path d=\"M4.75 20c.6-3.7 3.6-6 7.25-6s6.65 2.3 7.25 6\"/>", "chat": "<path d=\"M5.5 5h13A1.5 1.5 0 0 1 20 6.5v8.5a1.5 1.5 0 0 1-1.5 1.5H11l-4.5 3.5v-3.5h-1A1.5 1.5 0 0 1 4 15V6.5A1.5 1.5 0 0 1 5.5 5z\"/><path d=\"M9 10.75h.01M12 10.75h.01M15 10.75h.01\"/>", "spark": "<path d=\"M12 3.5c.5 4.4 2.6 6.9 7.5 8.5-4.9 1.6-7 4.1-7.5 8.5-.5-4.4-2.6-6.9-7.5-8.5 4.9-1.6 7-4.1 7.5-8.5z\"/>", "check": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"m8.5 12.25 2.4 2.4 4.6-4.9\"/>", "alert": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 7.75v5M12 16.25h.01\"/>", "clock": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 7.5V12l3 2\"/>", "send": "<path d=\"M12 19V5.5M6.5 11 12 5.5l5.5 5.5\"/>"};
function cx(){return Array.prototype.filter.call(arguments,Boolean).join(" ");}
function Icon(p){var n=p.name,s=p.size||20,b=ICONS[n]||ICONS.spark;
  return h("svg",{className:cx("wh-icon",p.className),width:s,height:s,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round",role:p.title?"img":undefined,"aria-hidden":p.title?undefined:true,"aria-label":p.title,dangerouslySetInnerHTML:{__html:b}});}
function Brand(p){var size=p.size||"md";
  return h("span",{className:cx("wh-brand","wh-brand-"+size,p.className)},
    p.src?h("img",{className:"wh-brand-mark",src:p.src,alt:p.wordmark===false?"Whumpo":"",width:size==="sm"?32:44,height:size==="sm"?32:44}):null,
    p.wordmark===false?null:h("span",{className:"wh-brand-text"},h("span",{className:"wh-brand-word"},"Whumpo"),p.tagline?h("span",{className:"wh-brand-tag"},p.tagline):null));}
function Button(p){var v=p.variant||"secondary",rest={};for(var k in p)if(["variant","icon","size","className","children"].indexOf(k)<0)rest[k]=p[k];
  return h("button",Object.assign({type:"button"},rest,{className:cx("wh-btn","wh-btn-"+v,p.size==="sm"&&"wh-btn-sm",p.className)}),p.icon?h(Icon,{name:p.icon,size:p.size==="sm"?16:18}):null,p.children);}
var ST={ready:["check","Ready"],working:["clock","Working"],attention:["alert","Needs you"],idle:["spark","Not started"]};
function StatusBadge(p){var s=p.status||"idle",d=ST[s]||ST.idle;
  return h("span",{className:cx("wh-badge","wh-badge-"+s,p.className)},h(Icon,{name:d[0],size:14}),p.children||d[1]);}
function ChatMessage(p){var me=p.from==="you";
  return h("div",{className:cx("wh-msg",me?"wh-msg-you":"wh-msg-whumpo",p.className)},
    !me&&p.avatarSrc?h("img",{className:"wh-msg-avatar",src:p.avatarSrc,alt:"",width:32,height:32}):null,
    h("div",{className:"wh-msg-body"},h("div",{className:"wh-bubble"},p.children),p.time?h("div",{className:"wh-msg-time"},p.time):null));}
function Composer(p){var st=R.useState(p.defaultValue||""),v=p.value!=null?p.value:st[0];
  function set(x){if(p.value==null)st[1](x);p.onChange&&p.onChange(x);}
  function send(e){e.preventDefault();if(!v.trim())return;p.onSend&&p.onSend(v);set("");}
  return h("form",{className:cx("wh-composer",p.className),onSubmit:send},
    h("input",{className:"wh-composer-input",value:v,placeholder:p.placeholder||"Tell Whumpo what you need…","aria-label":p.label||"Message Whumpo",onChange:function(e){set(e.target.value);}}),
    h("button",{className:"wh-composer-send",type:"submit","aria-label":"Send",disabled:!v.trim()},h(Icon,{name:"send",size:18})));}
function Ring(p){var r=26,c=2*Math.PI*r,o=c*(1-Math.max(0,Math.min(100,p.percent))/100);
  return h("div",{className:"wh-ring",role:"progressbar","aria-valuenow":p.percent,"aria-valuemin":0,"aria-valuemax":100,"aria-label":p.label},
    h("svg",{width:64,height:64,viewBox:"0 0 64 64"},h("circle",{cx:32,cy:32,r:r,className:"wh-ring-track"}),h("circle",{cx:32,cy:32,r:r,className:"wh-ring-fill",strokeDasharray:c,strokeDashoffset:o,transform:"rotate(-90 32 32)"})),
    h("span",{className:"wh-ring-num"},Math.round(p.percent)+"%"));}
var SI={done:"check",active:"clock",pending:null};
function ProgressCard(p){var steps=p.steps||[],done=steps.filter(function(s){return s.state==="done";}).length,pc=p.percent!=null?p.percent:(steps.length?done/steps.length*100:0);
  return h("section",{className:cx("wh-card","wh-progress",p.className)},
    h("h3",{className:"wh-card-title"},p.title),
    h("div",{className:"wh-progress-row"},h(Ring,{percent:pc,label:p.title}),
      h("ol",{className:"wh-steps"},steps.map(function(s,i){return h("li",{key:i,className:"wh-step wh-step-"+(s.state||"pending")},
        SI[s.state]?h(Icon,{name:SI[s.state],size:16}):h("span",{className:"wh-step-dot","aria-hidden":true}),
        h("span",null,s.label),h("span",{className:"wh-sr"},s.state==="done"?" (done)":s.state==="active"?" (in progress)":" (not started)"));}))));}
function ServiceTile(p){
  return h("div",{className:cx("wh-tile",p.className)},h("span",{className:"wh-tile-icon"},h(Icon,{name:p.icon||"globe",size:20})),
    h("span",{className:"wh-tile-text"},h("span",{className:"wh-tile-name"},p.name),h(StatusBadge,{status:p.status||"ready"},p.statusLabel)));}
function ApprovalCard(p){
  return h("section",{className:cx("wh-card","wh-approval",p.className),"aria-label":p.title},
    h("div",{className:"wh-approval-head"},h(StatusBadge,{status:"attention"},"Needs your approval"),h("h3",{className:"wh-card-title"},p.title)),
    h("dl",{className:"wh-approval-facts"},
      h("div",null,h("dt",null,"What happens"),h("dd",null,p.outcome)),
      h("div",null,h("dt",null,"Cost"),h("dd",{className:"wh-approval-cost"},p.cost)),
      p.risk?h("div",null,h("dt",null,"Risk"),h("dd",null,p.risk)):null),
    h("div",{className:"wh-approval-actions"},h(Button,{variant:"primary",onClick:p.onApprove},p.approveLabel||"Approve"),h(Button,{variant:"quiet",onClick:p.onDecline},p.declineLabel||"Not now")));}
var ns={Brand:Brand,Icon:Icon,Button:Button,StatusBadge:StatusBadge,ChatMessage:ChatMessage,Composer:Composer,ProgressCard:ProgressCard,ServiceTile:ServiceTile,ApprovalCard:ApprovalCard,icons:Object.keys(ICONS)};
window.Whumpo=Object.assign(window.Whumpo||{},ns);
})();
