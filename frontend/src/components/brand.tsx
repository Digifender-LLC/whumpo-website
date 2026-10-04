import {Link} from '@tanstack/react-router';
import {cn} from '@/lib/utils';
// The approved mark with the typeset wordmark. Below ~90px wide, use the mark alone.
export function Brand({size='md',wordmark=true,tagline,compact=false,className}:{size?:'sm'|'md';wordmark?:boolean;tagline?:string;compact?:boolean;className?:string}){
 const px=size==='sm'?32:44;
 return <Link to="/" aria-label="Whumpo home" className={cn('flex min-h-11 items-center gap-3 text-ink',className)}>
  <img src="/brand/whumpo-mark-48.png" srcSet="/brand/whumpo-mark-96.png 2x, /brand/whumpo-mark-192.png 4x" alt="" width={px} height={px} className={cn('shrink-0 object-cover',size==='sm'?'size-8 rounded-sm':'size-11 rounded-md')}/>
  {wordmark&&<span className={cn('flex flex-col',compact&&'sidebar-brand-name')}><span className={cn('wordmark',size==='sm'?'text-xl':'text-2xl')}>Whumpo</span>{tagline&&<span className="text-[10px] leading-[14px] font-semibold tracking-[.16em] uppercase text-ink-muted">{tagline}</span>}</span>}
 </Link>;
}
