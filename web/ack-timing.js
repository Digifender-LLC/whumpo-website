export const ACK_DELAY_MS = 700;
export const ACK_MIN_VISIBLE_MS = 1000;
export const FALLBACK_ACK = 'Your message is on its way. I’m waiting for the response.';

/** Presentation only: never delays backend work or creates another main request. */
export async function presentWithAcknowledgment(main, {
  showAck, hideAck, readAck = async () => null,
  now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout
}) {
  let ready=false, closed=false, shownAt=null, ack=null, polls=0, pollTimer;
  const poll=async()=>{
    if(ready||closed)return;
    try{const value=await readAck();if(!ready&&!closed&&typeof value==='string'&&value.length<=180)ack=value;}catch{/* Generic receipt remains available. */}
    if(!ready&&!closed&&++polls<3&&!ack)pollTimer=setTimer(poll,200);
  };
  pollTimer=setTimer(poll,200);
  const ackTimer=setTimer(()=>{
    if(ready||closed)return;
    shownAt=now();showAck(ack||FALLBACK_ACK);
  },ACK_DELAY_MS);
  try{
    const response=await main;
    ready=true;clearTimer(ackTimer);clearTimer(pollTimer);
    if(shownAt!==null){const remaining=ACK_MIN_VISIBLE_MS-(now()-shownAt);if(remaining>0)await new Promise(resolve=>setTimer(resolve,remaining));}
    return response;
  }finally{
    closed=true;clearTimer(ackTimer);clearTimer(pollTimer);hideAck();
  }
}
