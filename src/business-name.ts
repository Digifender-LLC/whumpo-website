/**
 * The one rule for the business name shown in appointment emails (WH-158), shared by the typed control, the model path, `build()` and the records panel so
 * no path accepts what another refuses. A positive charset, not a denylist: letters (with their combining marks, so Hindi, Thai and Tamil work), numbers,
 * ASCII space and ' ’ & . , - ・ ، only, starting with a letter or number. On top of the charset: default-ignorable code points (invisible fillers, variation
 * selectors, tags, joiners), digits and letters that look like a dot, a space before a dot or comma, domain-shaped text, addresses and schemes are refused.
 * Fullwidth dots, ideographic stops, zero-width and control characters (including U+0085) and braces are outside the charset. Persian names that need a
 * zero-width non-joiner are refused on purpose (an invisible character). Pure and import-free so the browser bundle can use it.
 */
export const businessNamePattern=/^[\p{L}\p{N}][\p{L}\p{M}\p{N} '\u2019&.,\u30fb\u060c-]{0,79}$/u;
const invisible=/\p{Default_Ignorable_Code_Point}/u;
const dotLike=/[\u0660\u06f0\ua4f8\ua78f]/u;
const domainShaped=/@|:\/\/|\bwww\.|[\p{L}\p{M}\p{N}-]\.[\p{L}\p{M}]{2,}|\p{Nd}+\.\p{Nd}+\.\p{Nd}+/iu;
/** The empty string when the name is acceptable, otherwise the reason in plain words. Callers pass the NFC-normalized, trimmed name. */
export function businessNameProblem(name:string){
 if(!name)return 'Enter the business name to show in the emails.';
 if(!/[\p{L}\p{N}]/u.test(name)||!businessNamePattern.test(name)||invisible.test(name)||/ {2}| [.,]/.test(name))return 'Use letters, numbers, spaces and . , \' & - only, up to 80 characters.';
 if(dotLike.test(name)||domainShaped.test(name))return 'Leave out links, domain names and email addresses.';
 return '';
}
