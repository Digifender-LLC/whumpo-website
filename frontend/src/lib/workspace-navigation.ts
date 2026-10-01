/** Callback query text never supplies a destination or a success assertion. */
export function providerReturn(search:string):{view:'connections'|'billing';notice:string}|undefined{
 const params=new URLSearchParams(search);
 if(params.has('connection'))return {view:'connections',notice:params.has('connection_error')||params.has('error')?'The connection was not completed. You can try again here.':'Checking the latest connection status…'};
 if(params.has('checkout'))return {view:'billing',notice:params.get('checkout')==='canceled'?'Checkout was canceled. Check your latest balance here.':'Checking your latest balance…'};
}
