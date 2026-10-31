/**
 * The one rule for the business name shown in appointment emails (WH-158), shared by the typed control, the model path, `build()` and the records panel so
 * no path accepts what another refuses. A positive charset, not a denylist: letters (with their combining marks, so Hindi, Thai and Tamil work), numbers,
 * ASCII space and ' & . , - only. Fullwidth dots, ideographic stops, zero-width and control characters (including U+0085) and braces are outside it.
 * Domain-shaped text, addresses and schemes are refused on top of that. Pure and import-free so the browser bundle can use it.
 */
export const businessNamePattern=/^[\p{L}\p{N}][\p{L}\p{M}\p{N} '&.,-]{0,79}$/u;
const domainShaped=/@|:\/\/|\bwww\.|[\p{L}\p{M}\p{N}-]\.[\p{L}\p{M}]{2,}|\d+\.\d+\.\d+/iu;
/** The empty string when the name is acceptable, otherwise the reason in plain words. Callers pass the NFC-normalized, trimmed name. */
export function businessNameProblem(name:string){
 if(!name)return 'Enter the business name to show in the emails.';
 if(!businessNamePattern.test(name)||/ {2}/.test(name))return 'Use letters, numbers, spaces and . , \' & - only, up to 80 characters.';
 if(domainShaped.test(name))return 'Leave out links, domain names and email addresses.';
 return '';
}
