import {useEffect} from 'react';
import {Link} from '@tanstack/react-router';
import {Brand} from './components/brand';
import {LegalLinks} from './legal-links';

// Owner content still to supply is marked PLACEHOLDER on the page itself; tests/managed-hosting.mjs fails if a price or currency amount appears.
const addOns=[
 {category:'PLACEHOLDER category A',items:[{name:'PLACEHOLDER add-on one',description:'PLACEHOLDER: one-line description of this add-on goes here.'}]},
 {category:'PLACEHOLDER category B',items:[{name:'PLACEHOLDER add-on two',description:'PLACEHOLDER: one-line description of this add-on goes here.'}]},
 {category:'PLACEHOLDER category C',items:[{name:'PLACEHOLDER add-on three',description:'PLACEHOLDER: one-line description of this add-on goes here.'}]}
];
const steps=[
 ['Talk to your rep','Your sales rep meets you in person and learns what your site needs.'],
 ['Pick what you need','Your rep walks you through the basic site and the add-ons, and shows you what applies.'],
 ['Get your quote','Anything beyond the base price is quoted in person by your rep.'],
 ['Stay in touch','Your rep stays your point of contact for your hosting.']
];
const faq=[
 ['What does the base price cover?','PLACEHOLDER: owner to answer. See "What the base price covers" above for what is stated so far.'],
 ['How much do add-ons cost?','Add-ons are quoted in person by your sales rep. There is no price list on this page.'],
 ['Can I move to a premium or bespoke site later?','PLACEHOLDER: owner to answer.'],
 ['What happens if I want to stop?','PLACEHOLDER: owner to answer.'],
 ['Who do I contact for support?','Your sales rep is your point of contact. PLACEHOLDER: owner to add any other support route.']
];
const eyebrow='text-xs font-semibold tracking-[.16em] uppercase text-link';
const h2='text-3xl font-bold mt-3 sm:text-4xl';
const card='rounded-lg border border-line bg-surface-raised p-6';
const ph='font-semibold text-ink'; // PLACEHOLDER text stays at full ink contrast

export function ManagedHosting(){
 useEffect(()=>{document.title='Managed hosting — Whumpo'},[]);
 return <div className="landing bg-surface text-ink min-h-screen">
  <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:p-4">Skip to content</a>
  <header className="landing-container py-6"><Brand/></header>
  <main id="main-content" tabIndex={-1}>
   <section className="landing-container py-12 border-b border-line" aria-labelledby="hosting-heading">
    <p className={eyebrow}>Managed hosting</p>
    <h1 id="hosting-heading" className="mt-4 text-4xl font-bold sm:text-5xl max-w-3xl">We host your website, so you do not have to.</h1>
    <p className="mt-5 text-lg text-ink-muted max-w-2xl">Managed hosting means we run the place your website lives and look after it for you. Your sales rep is your point of contact. Ask them anything on this page.</p>
    <p className="mt-4 max-w-2xl text-ink-muted">This page goes with your conversation with your rep. It lists what we offer so your rep can point to it.</p>
   </section>

   <section id="included" className="landing-container py-12 border-b border-line" aria-labelledby="included-heading">
    <p className={eyebrow}>Basic sites</p>
    <h2 id="included-heading" className={h2}>What the base price covers</h2>
    <p className="mt-4 max-w-2xl text-ink-muted">The base price covers hosting for basic sites only. Premium and bespoke sites are not covered by the base price.</p>
    <div className={card+' mt-6 max-w-2xl'}>
      <p className="text-sm font-semibold text-ink-muted">Base price</p>
      <p className={ph+' mt-1 text-2xl'}>PLACEHOLDER: base price to be supplied by the owner</p>
      <p className={ph+' mt-4'}>PLACEHOLDER: list of what the base price includes, to be supplied by the owner.</p>
    </div>
   </section>

   <section id="add-ons" className="landing-container py-12 border-b border-line" aria-labelledby="addons-heading">
    <p className={eyebrow}>Add-ons</p>
    <h2 id="addons-heading" className={h2}>Add-ons you can ask for</h2>
    <p className="mt-4 max-w-2xl text-ink-muted">Anything beyond the base price comes with an additional cost. Costs are quoted in person by your sales rep.</p>
    <p className={ph+' mt-4 max-w-2xl'}>PLACEHOLDER: these three entries only show the layout. The real list comes from the owner. They are not real offerings.</p>
    <div className="mt-6 grid gap-6 md:grid-cols-3">
     {addOns.map(group=><section key={group.category} aria-label={group.category} className={card}>
      <h3 className="text-lg font-bold">{group.category}</h3>
      <ul className="mt-4 space-y-4">{group.items.map(item=><li key={item.name}>
       <p className="font-semibold">{item.name}</p>
       <p className="mt-1 text-sm text-ink-muted">{item.description}</p>
       <p className="mt-2 text-sm font-semibold text-ink">Quoted in person</p>
      </li>)}</ul>
     </section>)}
    </div>
   </section>

   <section id="how" className="landing-container py-12 border-b border-line" aria-labelledby="how-heading">
    <p className={eyebrow}>How it works</p>
    <h2 id="how-heading" className={h2}>How it works with your rep</h2>
    <ol className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">{steps.map(([title,text],i)=><li key={title} className={card}>
     <span className="font-display text-2xl font-bold text-link" aria-hidden="true">{String(i+1).padStart(2,'0')}</span>
     <h3 className="mt-3 text-lg font-bold"><span className="sr-only">Step {i+1}: </span>{title}</h3>
     <p className="mt-2 text-sm text-ink-muted">{text}</p>
    </li>)}</ol>
   </section>

   <section id="site-types" className="landing-container py-12 border-b border-line" aria-labelledby="types-heading">
    <p className={eyebrow}>Site types</p>
    <h2 id="types-heading" className={h2}>Basic site or premium site</h2>
    <div className="mt-6 grid gap-6 md:grid-cols-2">
     <article className={card}><h3 className="text-lg font-bold">Basic site</h3><p className="mt-2 text-sm text-ink-muted">Covered by the base price.</p></article>
     <article className={card}><h3 className="text-lg font-bold">Premium or bespoke site</h3><p className="mt-2 text-sm text-ink-muted">Not covered by the base price. Premium and bespoke sites are quoted separately, in person, by your sales rep.</p></article>
    </div>
   </section>

   <section id="faq" className="landing-container py-12 border-b border-line" aria-labelledby="faq-heading">
    <p className={eyebrow}>Questions</p>
    <h2 id="faq-heading" className={h2}>Frequently asked questions</h2>
    <div className="mt-6 max-w-3xl space-y-3">{faq.map(([q,a])=><details key={q} className={card+' !p-0'}>
     <summary className="min-h-11 cursor-pointer px-6 py-4 font-semibold">{q}</summary>
     <p className="px-6 pb-4 text-sm text-ink-muted">{a}</p>
    </details>)}</div>
   </section>

   <section id="contact" className="landing-container py-12" aria-labelledby="contact-heading">
    <div className="rounded-xl bg-surface-inverse text-ink-inverse p-8 sm:p-12">
     <h2 id="contact-heading" className="text-3xl font-bold sm:text-4xl">Talk to your rep</h2>
     <p className="mt-3 max-w-2xl">Ask your sales rep about managed hosting, add-ons, or a premium site. They will quote any extra costs in person.</p>
     <p className="mt-4 font-semibold">PLACEHOLDER: contact details (phone, email) to be supplied by the owner.</p>
    </div>
   </section>
  </main>
  <footer className="landing-container pb-9 flex justify-between items-center gap-6 flex-wrap"><Link to="/" className="inline-flex min-h-11 items-center underline underline-offset-4">Back to Whumpo</Link><LegalLinks/></footer>
 </div>;
}
