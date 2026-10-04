/** Server-side Turnstile Siteverify shared by public intake paths (the contact form and anonymous public module forms,
 * docs/contact-forms.md#submission-boundary). The response is bounded to 8 KiB, redirects are refused, the request has a
 * ten-second timeout and success also requires the exact hostname, action and cdata. Tokens, verification responses and
 * submitted values are never logged. Network failures propagate to the caller, which maps them to its own unavailable state. */
export type TurnstileExpectation={hostname:string;action:string;cdata:string};
export type TurnstileStage='verification-request'|'verification-response';
export async function verifyTurnstile(fetcher:typeof fetch,secret:string,token:string,ip:string,expected:TurnstileExpectation,stage:(s:TurnstileStage)=>void=()=>{}):Promise<'verified'|'failed'|'unavailable'>{
 stage('verification-request');
 const response=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret,response:token,remoteip:ip}),redirect:'manual',signal:AbortSignal.timeout(10000)});
 // Siteverify response is read with a hard bound, including chunked responses.
 stage('verification-response');
 const reader=response.body?.getReader();if(!response.ok||!reader)return 'unavailable';
 let raw='',size=0;const decoder=new TextDecoder();
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();return 'unavailable';}raw+=decoder.decode(value,{stream:true});}
 raw+=decoder.decode();
 let check:{success?:boolean;hostname?:string;action?:string;cdata?:string};try{check=JSON.parse(raw);}catch{return 'unavailable';}
 return check?.success===true&&check.hostname===expected.hostname&&check.action===expected.action&&check.cdata===expected.cdata?'verified':'failed';
}
