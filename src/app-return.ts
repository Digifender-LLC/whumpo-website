// /app/return: the verified App Link the browser handoff lands on. When the Android app is installed the OS opens it with the query
// (code, state); otherwise this page loads. It is static: no script, no echo of the query, never cached, never sends a referrer.
const body=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>Return to Whumpo</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;min-height:100dvh;place-items:center;padding:16px;text-align:center}main{max-width:26rem}</style></head><body><main><h1>Return to the Whumpo app</h1><p>Open the Whumpo app on this phone to finish signing in. If the app did not open, go back to it and start again.</p></main></body></html>`;
export function appReturnPage(request:Request):Response|null{
 const url=new URL(request.url);
 if(url.pathname!=='/app/return')return null;
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response(null,{status:405,headers:{allow:'GET, HEAD','cache-control':'no-store'}});
 return new Response(request.method==='HEAD'?null:body,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-frame-options':'DENY',
  'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}});
}
