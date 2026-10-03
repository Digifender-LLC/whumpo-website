/** Callback query text never supplies a destination or a success assertion. */
export function providerReturn(search:string):{view:'chat'|'connections'|'billing';notice:string;interactionId?:string}|undefined{
 const params=new URLSearchParams(search);
 if(params.has('connection')){
  const id=params.get('interaction'),known=params.get('connection')==='github'||params.get('connection')==='cloudflare';
  const interactionId=known&&id&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)?id:undefined;
  return {view:interactionId?'chat':'connections',...(interactionId?{interactionId}:{}),notice:params.has('connection_error')||params.has('error')?'Authorization needs a status check. Your saved connection may be unchanged or its outcome unconfirmed.':'Checking the latest connection status…'};
 }
 if(params.has('checkout'))return {view:'billing',notice:params.get('checkout')==='canceled'?'Checkout was canceled. Check your latest balance here.':'Checking your latest balance…'};
}
