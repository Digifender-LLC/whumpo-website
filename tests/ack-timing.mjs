import assert from 'node:assert/strict';
import {presentWithAcknowledgment,FALLBACK_ACK} from '../web/ack-timing.js';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/acknowledgment.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {parseAcknowledgment}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
assert.match(parseAcknowledgment('{"intent":"troubleshooting"}'),/problem you described/);
for(const raw of ['{"ack":"I deployed your site"}','{"intent":"editing","claim":"fixed"}','{"intent":"__proto__"}','bad'])assert.match(parseAcknowledgment(raw),/Got your message/);
async function scenario(answerAt,{ack='Got your message. I’m considering the details.',fail=false}={}){
 let time=0,sequence=0;const timers=new Map(),events=[];
 const setTimer=(fn,delay)=>{const id=++sequence;timers.set(id,{at:time+delay,fn});return id;},clearTimer=id=>timers.delete(id);
 const main=new Promise((resolve,reject)=>setTimer(()=>fail?reject(Error('network')):resolve('answer'),answerAt));
 const operation=presentWithAcknowledgment(main,{now:()=>time,setTimer,clearTimer,showAck:text=>events.push({event:'ack',at:time,text}),hideAck:()=>events.push({event:'hide',at:time}),readAck:async()=>ack});
 operation.then(()=>events.push({event:'answer',at:time}),()=>events.push({event:'error',at:time}));
 for(let guard=0;guard<50;guard++){
  for(let i=0;i<10;i++)await Promise.resolve();
  const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next)break;
  time=next[1].at;timers.delete(next[0]);next[1].fn();
 }
 await operation.catch(()=>{});return events;
}
let events=await scenario(650);assert.ok(!events.some(e=>e.event==='ack'));assert.equal(events.find(e=>e.event==='answer').at,650);
events=await scenario(730);assert.equal(events.find(e=>e.event==='ack').at,700);assert.equal(events.find(e=>e.event==='answer').at,1700);
events=await scenario(3000);assert.equal(events.find(e=>e.event==='answer').at,3000);
events=await scenario(730,{ack:null});assert.equal(events.find(e=>e.event==='ack').text,FALLBACK_ACK);assert.equal(events.find(e=>e.event==='answer').at,1700);
events=await scenario(730,{fail:true});assert.equal(events.find(e=>e.event==='error').at,730);
events=await scenario(100,{fail:true});assert.ok(!events.some(e=>e.event==='ack'));
console.log('Acknowledgment timing passed: fast-answer suppression, 700/730→1700 ms spacing, long-answer delivery, safe fallback, no delay for errors and structured intent isolation.');
