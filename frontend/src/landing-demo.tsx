import {Icon,type IconName} from './components/whumpo/icon';
import {ChatMessage} from './components/whumpo/chat-message';
import {ServiceTile} from './components/whumpo/service-tile';
// Proof without invented customers: four verifiable product facts, and one static, clearly illustrative exchange.
const facts:readonly (readonly [IconName,string,string])[]=[
 ['person','Passkeys, no password','Sign in with your device. There is no password to forget or leak.'],
 ['check','Your approval first','Nothing is published or paid for until you say yes.'],
 ['globe','Offline whenever you choose','Take any site offline yourself, at any time.'],
 ['chat','Plain-language reviews','Every change is explained in words before it happens.'],
];
export function TrustRow(){
 return <section aria-labelledby="trust-heading" className="landing-container py-12 border-b border-line"><h2 id="trust-heading" className="sr-only">What you can rely on</h2><ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">{facts.map(([icon,h,p])=><li key={h} className="flex gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-sm bg-action-soft text-link"><Icon name={icon}/></span><div><p className="text-body font-semibold">{h}</p><p className="text-body-sm text-ink-muted mt-1">{p}</p></div></li>)}</ul></section>;
}
export function Demo(){
 return <section id="demo" aria-labelledby="demo-heading" className="landing-container py-24"><div className="grid lg:grid-cols-[1fr_1.1fr] gap-12 items-center"><div className="max-w-xl"><p className="text-caption font-semibold tracking-widest uppercase text-link">SEE IT IN ACTION</p><h2 id="demo-heading" className="text-display mt-4">Say what you need.<br/>Review what you get.</h2><p className="text-ink-muted mt-5">An illustration of a chat with Whumpo. You ask in your own words, Whumpo drafts it, and you decide whether it goes live.</p></div>
 <figure className="rounded-xl border border-line bg-surface-raised shadow-md p-4 sm:p-6 flex flex-col gap-4 m-0"><ChatMessage from="you" label="You">I run a small bakery. Can you make me a simple website?</ChatMessage><ChatMessage from="whumpo" avatarSrc="/brand/whumpo-mark-48.png" label="Whumpo">Happy to. I drafted a home page with your menu and opening hours. Have a look, and I will only publish it when you say so.</ChatMessage><ServiceTile name="Corner Bakery website" icon="globe" status="ready"/><figcaption className="text-caption text-ink-muted">Illustration only. Not a real customer or conversation.</figcaption></figure></div></section>;
}
