import {Link} from '@tanstack/react-router';
export function Brand({compact=false}:{compact?:boolean}){return <Link to="/" aria-label="Whumpo home" className="flex items-center gap-2.5 text-foreground"><img src="/brand/mark.svg" alt="" width="38" height="38"/><span className={'wordmark text-[32px] '+(compact?'sidebar-brand-name':'')}>Whumpo</span></Link>}
