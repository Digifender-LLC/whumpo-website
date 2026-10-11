/** WH-142 common connector review binding and receipt-state view (docs/connectors.md, "Actions, receipts and unknown
 * outcomes"). Pure, read-only functions over the frozen catalog and the existing `github_backups` and
 * `cloudflare_dns_actions` rows. Nothing here writes, migrates or renames stored history: each table keeps its own state
 * names, and this module only maps them onto the common vocabulary. No credential, token, ciphertext or provider payload
 * is read or returned. Platform Worker only (it loads the catalog). */
import {connectorCatalog,receiptStates,plain,type ConnectorOperation,type Price} from './connector-catalog/catalog';
import {hashToken} from './security';

export type ReceiptProvider='github'|'cloudflare';
export type ConnectorReceiptState=typeof receiptStates[number];
/** The one reviewed action each existing table records. */
export const receiptActions=Object.freeze({github:'backup.commit',cloudflare:'dnsRecord.create'} as const);

/** Stored state -> common state. GitHub has no `observed` or `unchanged`: every `complete` backup was verified by reading
 *  the files back, but the row does not record whether the commit reply, an existing copy or a later read-only check
 *  established it, so `complete` maps to `applied` with `verified-readback` evidence and never claims `observed`. */
export const receiptStateMaps=Object.freeze({
 github:Object.freeze({pending:'review',dispatching:'dispatching',uncertain:'uncertain',complete:'applied',failed:'failed'}),
 cloudflare:Object.freeze({review:'review',sending:'dispatching',uncertain:'uncertain',applied:'applied',unchanged:'unchanged',observed:'observed'}),
} as const satisfies Record<ReceiptProvider,Readonly<Record<string,ConnectorReceiptState>>>);
const evidence:Record<ReceiptProvider,Readonly<Record<string,string>>>={
 github:{complete:'verified-readback'},
 cloudflare:{applied:'provider-acknowledged',unchanged:'existing-record',observed:'readback-after-uncertain'},
};

/** Canonical JSON (sorted keys), byte-compatible with the reference runtime's `digest` input. */
export function canonicalJSON(value:unknown):string{
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError('Non-finite number');return JSON.stringify(value);}
 if(Array.isArray(value))return '['+value.map(canonicalJSON).join(',')+']';
 if(!plain(value))throw new TypeError('Unsupported value');
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJSON(value[k])).join(',')+'}';
}
export const connectorDigest=(value:unknown)=>hashToken(canonicalJSON(value));

function operation(provider:ReceiptProvider){const operations:Readonly<Record<string,ConnectorOperation>>|undefined=connectorCatalog.providers[provider]?.operations,op=operations?.[receiptActions[provider]];if(!op||op.kind!=='action')throw new TypeError('Undeclared receipt action');return op;}
/** The catalog's explicit customer price for the provider's reviewed action. */
export function actionPrice(provider:ReceiptProvider):Price{const {customerUnits,basis}=operation(provider).price;return {customerUnits,basis};}
export const operationDigest=(provider:ReceiptProvider)=>connectorDigest(operation(provider));
export function priceText(price:Price){return price.basis==='plan-inclusion'&&price.customerUnits===0?'included in your plan; no per-use charge':`${price.customerUnits} customer units per use (quoted)`;}

/** Derives the review digest from the row's immutable review columns, its credential ID and the current catalog
 *  declaration and price. It is not stored: confirmation recomputes it and must receive the same value back, so a changed
 *  declaration, price, credential or review row makes the review stale. `request` must hold only columns that the
 *  table's identity trigger keeps immutable. */
export async function reviewBinding(provider:ReceiptProvider,credentialId:string|null,request:Record<string,unknown>){
 const price=actionPrice(provider),opDigest=await operationDigest(provider),requestDigest=await connectorDigest(request);
 const reviewDigest=await connectorDigest({provider,operationId:receiptActions[provider],operationDigest:opDigest,requestDigest,credentialId,price});
 return {price,operationDigest:opDigest,reviewDigest};
}
export type ReviewBinding={reviewDigest:string;price:Price};
/** Checks the owner's echo of the review (`{reviewDigest, acceptedPrice}`). `missing` for an absent or malformed echo,
 *  `stale` when it differs from the current derivation. */
export function reviewBindingProblem(expected:ReviewBinding,echo:unknown):'missing'|'stale'|null{
 if(!plain(echo)||Object.keys(echo).some(k=>!['reviewDigest','acceptedPrice'].includes(k))||typeof echo.reviewDigest!=='string'||!/^[0-9a-f]{64}$/.test(echo.reviewDigest))return 'missing';
 const p=echo.acceptedPrice;
 if(!plain(p)||Object.keys(p).sort().join()!=='basis,customerUnits'||!Number.isSafeInteger(p.customerUnits)||Number(p.customerUnits)<0||typeof p.basis!=='string')return 'missing';
 return echo.reviewDigest===expected.reviewDigest&&canonicalJSON(p)===canonicalJSON(expected.price)?null:'stale';
}
/** A quoted price would need a billing-ledger debit with an exact receipt; none exists for these actions yet. */
export const chargeable=(price:Price)=>price.customerUnits>0;

/** Rows do not store a price. A review states the current catalog price, which its confirmation must echo. A receipt past
 *  review was necessarily confirmed at the plan-inclusion price: `chargeable` refuses every other price before the claim,
 *  and the catalog only pairs zero units with plan inclusion. So a later catalog change never rewrites a settled price. */
const settledPrice:Price=Object.freeze({customerUnits:0,basis:'plan-inclusion'});
/** Read-only common receipt view over one stored row. A review past its expiry reads `expired`. */
export function connectorReceiptView(provider:ReceiptProvider,row:{state:string;expiresAt:string;reviewDigest?:string},now=new Date().toISOString()){
 const map:Readonly<Record<string,ConnectorReceiptState>>=receiptStateMaps[provider],mapped=map[row.state];
 if(!mapped)throw new TypeError('Unknown stored receipt state');
 const state:ConnectorReceiptState=mapped==='review'&&row.expiresAt<=now?'expired':mapped,price=mapped==='review'?actionPrice(provider):{...settledPrice};
 return {provider,operationId:receiptActions[provider],state,recordedState:row.state,authority:'owner-request' as const,price,priceText:priceText(price),evidence:evidence[provider][row.state]??null,...(state==='review'&&row.reviewDigest?{reviewDigest:row.reviewDigest}:{})};
}
export type ConnectorReceiptView=ReturnType<typeof connectorReceiptView>;

/** Chat lines. The review turn's saved text is the owner's echo when a Chat confirmation control is used. */
export const receiptLine=(r:ConnectorReceiptView)=>`Receipt state: ${r.state} · Authority: owner request · Price: ${r.priceText}`;
export const reviewDigestLine=(digest:string)=>`Review digest: ${digest}`;
export function reviewEchoFromText(text:string|null|undefined){
 if(!text)return;
 const digests=[...text.matchAll(/^Review digest: ([0-9a-f]{64})$/gm)],prices=[...text.matchAll(/^Receipt state: review · Authority: owner request · Price: (.+)$/gm)];
 if(digests.length!==1||prices.length!==1)return;
 const shown=prices[0][1],quoted=shown.match(/^([1-9][0-9]{0,8}) customer units per use \(quoted\)$/);
 const acceptedPrice:Price|undefined=shown==='included in your plan; no per-use charge'?{customerUnits:0,basis:'plan-inclusion'}:quoted?{customerUnits:Number(quoted[1]),basis:'quoted'}:undefined;
 return acceptedPrice&&{reviewDigest:digests[0][1],acceptedPrice};
}
