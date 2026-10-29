const groups:readonly (readonly [string,readonly (readonly [string,string])[]])[]=[
 ['Policies',[['Draft terms','https://digifender.com/legal/whumpo/terms'],['Draft privacy policy','https://digifender.com/legal/whumpo/privacy'],['Draft cookie notice','https://digifender.com/legal/whumpo/cookies']]],
 ['More',[['More Whumpo policies','https://digifender.com/legal/whumpo'],['Legal contact','mailto:legal@digifender.com'],['A Digifender product','https://digifender.com/']]],
];
const link='inline-flex min-h-11 items-center underline underline-offset-4 text-ink-muted hover:text-ink';
export function LegalLinks() {
  return (
    <nav aria-label="Legal" className="flex flex-wrap gap-x-12 gap-y-4 text-caption">
      {groups.map(([title, links]) => (
        <div key={title}>
          <p className="font-semibold text-ink">{title}</p>
          <ul className="mt-1 flex flex-col">
            {links.map(([label, href]) => (
              <li key={label}><a className={link} href={href}>{label}</a></li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
