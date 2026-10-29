const units:[Intl.RelativeTimeFormatUnit,number][]=[['year',31536e6],['month',2592e6],['day',864e5],['hour',36e5],['minute',6e4]];
const rtf=new Intl.RelativeTimeFormat('en',{numeric:'auto'});
/** "2 hours ago", "in 3 days", "now". Accepts epoch milliseconds or anything Date parses. */
export function relativeTime(value:number|string|Date,now=Date.now()){
 const diff=new Date(value).getTime()-now;if(!Number.isFinite(diff))return '';
 for(const [unit,size] of units)if(Math.abs(diff)>=size)return rtf.format(Math.trunc(diff/size),unit);
 return 'just now';
}
/** A deadline keeps its exact local time, because people act on it, and adds the relative hint. */
export function Deadline({value}:{value:number|string|Date}){
 const date=new Date(value);if(Number.isNaN(date.getTime()))return null;
 return <time dateTime={date.toISOString()}>{date.toLocaleString()} ({relativeTime(date)})</time>;
}
/** Relative text for people; the exact local time stays in the tooltip and the machine-readable attribute. */
export function TimeAgo({value}:{value:number|string|Date}){
 const date=new Date(value);if(Number.isNaN(date.getTime()))return null;
 return <time dateTime={date.toISOString()} title={date.toLocaleString()}>{relativeTime(date)}</time>;
}
