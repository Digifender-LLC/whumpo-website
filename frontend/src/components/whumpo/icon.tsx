import {cn} from '@/lib/utils';
// The design system's 12 icons: rounded 2px strokes on a 24px grid, drawn in currentColor.
// Provisional until a production icon set is approved (docs/design/README.md).
const paths={
 home:"<path d=\"M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19z\"/>",
 globe:"<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5S9.6 5.8 12 3.5z\"/>",
 database:"<ellipse cx=\"12\" cy=\"6\" rx=\"7.5\" ry=\"2.75\"/><path d=\"M4.5 6v6c0 1.5 3.4 2.75 7.5 2.75s7.5-1.25 7.5-2.75V6M4.5 12v6c0 1.5 3.4 2.75 7.5 2.75s7.5-1.25 7.5-2.75v-6\"/>",
 storage:"<path d=\"M7.5 18.5a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17.6 9.6a4.45 4.45 0 0 1-.6 8.9z\"/>",
 server:"<rect x=\"4\" y=\"4.5\" width=\"16\" height=\"6.5\" rx=\"2\"/><rect x=\"4\" y=\"13\" width=\"16\" height=\"6.5\" rx=\"2\"/><path d=\"M8 7.75h.01M8 16.25h.01M12 7.75h4M12 16.25h4\"/>",
 person:"<circle cx=\"12\" cy=\"8\" r=\"3.75\"/><path d=\"M4.75 20c.6-3.7 3.6-6 7.25-6s6.65 2.3 7.25 6\"/>",
 chat:"<path d=\"M5.5 5h13A1.5 1.5 0 0 1 20 6.5v8.5a1.5 1.5 0 0 1-1.5 1.5H11l-4.5 3.5v-3.5h-1A1.5 1.5 0 0 1 4 15V6.5A1.5 1.5 0 0 1 5.5 5z\"/><path d=\"M9 10.75h.01M12 10.75h.01M15 10.75h.01\"/>",
 spark:"<path d=\"M12 3.5c.5 4.4 2.6 6.9 7.5 8.5-4.9 1.6-7 4.1-7.5 8.5-.5-4.4-2.6-6.9-7.5-8.5 4.9-1.6 7-4.1 7.5-8.5z\"/>",
 check:"<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"m8.5 12.25 2.4 2.4 4.6-4.9\"/>",
 alert:"<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 7.75v5M12 16.25h.01\"/>",
 clock:"<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 7.5V12l3 2\"/>",
 send:"<path d=\"M12 19V5.5M6.5 11 12 5.5l5.5 5.5\"/>"
} as const;
export type IconName=keyof typeof paths;
export const iconNames=Object.keys(paths) as IconName[];
export function Icon({name,size=20,title,className}:{name:IconName;size?:number;title?:string;className?:string}){
 return <svg className={cn('block shrink-0',className)} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" role={title?'img':undefined} aria-hidden={title?undefined:true} aria-label={title} dangerouslySetInnerHTML={{__html:paths[name]}}/>;
}
