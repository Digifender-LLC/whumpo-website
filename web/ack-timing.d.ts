export function presentWithAcknowledgment<T>(main:Promise<T>,options:{showAck:(text:string)=>void;hideAck:()=>void;readAck?:()=>Promise<string|null>}):Promise<T>;
