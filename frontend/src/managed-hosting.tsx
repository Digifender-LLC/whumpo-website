import {useEffect} from 'react';
import {Link} from '@tanstack/react-router';
import {Brand} from './components/brand';
import {Button} from './components/ui/button';
import {LegalLinks} from './legal-links';

// Owner content still to supply is marked PLACEHOLDER on the page itself; tests/managed-hosting.mjs fails if a price or currency amount appears.
const addOns=[
 {category:'Domain and account',items:[
  {name:'Custom domain registration and management',description:'We register and manage your domain, in your name.'},
  {name:'Business email setup',description:'Mailboxes and phone setup, including the DNS work.'},
  {name:'Extra pages',description:'Additional pages on a template.'},
  {name:'Site migration',description:'Move a site from another builder, with domain and email transfer.'},
  {name:'Self-edit content dashboard',description:'Edit your own content in a simple dashboard.'},
  {name:'Analytics setup and a periodic report',description:'One place for website and listing insights, reviewed with your rep.'},
  {name:'Content updates',description:'Small text, photo and hours changes, by request, or through a prepaid update plan.'},
  {name:'Priority support',description:'Faster edit turnaround for subscribers.'}
 ]},
 {category:'Lead capture and communication',items:[
  {name:'Contact form',description:'A contact form with spam protection.'},
  {name:'Quote or estimate request form',description:'Photo upload and alerts included.'},
  {name:'Intake and new-client forms',description:'Collect details from new clients before you meet.'},
  {name:'Click-to-call and click-to-text bar',description:'A call and text bar for phones.'},
  {name:'Missed-call text-back',description:'An automatic text to callers you could not answer.'},
  {name:'Live chat',description:'Chat routed to your phone or inbox, if you will answer it.'},
  {name:'Website chat assistant',description:'Answers questions about your site\'s own information, with handoff to phone or form.'},
  {name:'AI receptionist setup',description:'Set up through a partner service.'},
  {name:'Newsletter and text signup widget',description:'Let visitors sign up for your newsletter or texts.'}
 ]},
 {category:'Booking, reservations and scheduling',items:[
  {name:'Online booking embed',description:'For supported scheduling tools.'},
  {name:'Restaurant reservations or waitlist link',description:'Link visitors to your reservations or waitlist.'},
  {name:'Class and event registration',description:'Registration with payment.'},
  {name:'Deposits and no-show protection',description:'Set up in your booking tool.'}
 ]},
 {category:'Commerce, ordering and payments',items:[
  {name:'Online ordering integration',description:'Works with your existing ordering platform: order buttons, menu sync checks and ordering links.'},
  {name:'Direct-ordering setup',description:'Help taking orders without third-party delivery apps.'},
  {name:'Product catalog',description:'A catalog of your products, without checkout.'},
  {name:'Online store setup',description:'Sell your products online.'},
  {name:'Gift cards',description:'Offer gift cards to your customers.'},
  {name:'Payment links, invoices and deposits',description:'Through a hosted payment provider.'},
  {name:'Loyalty program page',description:'A page that explains your loyalty program.'},
  {name:'Catering request form',description:'Let customers request catering online.'}
 ]},
 {category:'Content and pages',items:[
  {name:'HTML menu page',description:'A real web page menu, not a PDF, with updates.'},
  {name:'Blog or news section',description:'Share news and posts on your site.'},
  {name:'Blog posts written with your approval',description:'We write, you approve.'},
  {name:'Photo gallery, portfolio, or before-and-after page',description:'Show your work.'},
  {name:'Events calendar',description:'List your upcoming events.'},
  {name:'Specials and seasonal promo banners',description:'Highlight current offers on your site.'},
  {name:'Coupon or promo landing page',description:'With a QR code.'},
  {name:'Careers page',description:'With an application form.'},
  {name:'Reviews widget',description:'Shows live reviews on your site.'},
  {name:'Service-area pages',description:'Pages for the areas you serve.'},
  {name:'FAQ page',description:'Answer common questions in one place.'},
  {name:'Team and staff bios',description:'Introduce your people.'},
  {name:'Other language versions',description:'Spanish or other languages, human-reviewed.'}
 ]},
 {category:'Local visibility',items:[
  {name:'Business profile setup and optimization',description:'On the major search and map listing: categories, services, photos, hours, and links.'},
  {name:'Ongoing business profile management',description:'Regular posts, photo uploads, holiday hours, questions, and review replies.'},
  {name:'Other listings',description:'Setup on other major map, search and neighbourhood listings.'},
  {name:'Citation building',description:'Consistent listings across directories.'},
  {name:'On-page local SEO',description:'Titles, business data markup, and consistent name, address and phone details.'},
  {name:'Ongoing local search checks',description:'Regular checks and improvements.'},
  {name:'Review-generation kit',description:'A short review link, QR cards, message templates and a staff script.'},
  {name:'Automated review requests',description:'By text or email after a visit or job.'},
  {name:'Review response management',description:'We help you respond to reviews.'}
 ]},
 {category:'Marketing',items:[
  {name:'Email newsletter setup',description:'Signup form and template.'},
  {name:'Newsletter, done for you',description:'We prepare your newsletter on a regular basis.'},
  {name:'Text marketing setup',description:'Opt-in and consent handling, and regular messages.'},
  {name:'Social links, feed embed and share previews',description:'Connect your site to your social accounts.'},
  {name:'Social media posting',description:'Posting on a platform of your choice.'},
  {name:'Local advertising setup',description:'Search and local service listings.'},
  {name:'Ad campaign management',description:'We run your campaigns.'},
  {name:'Campaign landing pages',description:'A page built for each campaign.'},
  {name:'QR codes',description:'For menus, reviews, ordering and Wi-Fi.'},
  {name:'Print design',description:'Cards, flyers and table tents.'}
 ]},
 {category:'Creative',items:[
  {name:'Smartphone photo session',description:'With edited photos.'},
  {name:'Professional photography',description:'Arranged through a local photographer.'},
  {name:'Copywriting for pages',description:'We write the words for your pages.'},
  {name:'Logo design',description:'A logo for your business.'},
  {name:'Brand kit',description:'Logo, colours, fonts and templates.'},
  {name:'Short promo video or social reels pack',description:'Short video for your promotions.'}
 ]},
 {category:'Compliance and accessibility',items:[
  {name:'Accessibility baseline on every build',description:'Built following WCAG 2.1 AA practices: alt text, colour contrast, keyboard navigation, HTML menus and labelled forms.'},
  {name:'Accessibility audit and fixes',description:'For an existing or inherited site.'},
  {name:'Ongoing accessibility checks',description:'After content changes.'},
  {name:'Privacy policy, cookie notice and terms templates',description:'Templates only. These are not legal advice.'}
 ]},
 {category:'Advanced',items:[
  {name:'Client portal or member area',description:'Built on an off-the-shelf tool.'},
  {name:'Customer accounts and order history',description:'Through a platform feature.'},
  {name:'Integrations and automation',description:'Such as form to spreadsheet or CRM.'}
 ]}
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
    <p className="mt-4 max-w-2xl font-semibold">Currently serving Val Verde, TX.</p>
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
    <p className="mt-4 max-w-2xl text-ink-muted">Add-on availability depends on your site. Your rep will recommend what fits, and quote the cost in person.</p>
    <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
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
     <div className="mt-6 flex flex-wrap items-center gap-4">
      <Button asChild variant="secondary" size="lg" className="min-h-11"><a href="tel:+18336339838">Call Digifender</a></Button>
      <span className="font-semibold">(833) 633-9838</span>
     </div>
     <p className="mt-4 font-semibold">PLACEHOLDER: contact details (email, address) to be supplied by the owner.</p>
    </div>
   </section>
  </main>
  <footer className="landing-container pb-9 flex justify-between items-center gap-6 flex-wrap"><Link to="/" className="inline-flex min-h-11 items-center underline underline-offset-4">Back to Whumpo</Link><LegalLinks/></footer>
 </div>;
}
