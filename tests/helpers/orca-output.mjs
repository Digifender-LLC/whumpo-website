import {readFile,appendFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);

/** Optional real Orca speech-generation evidence, never a DOM/ARIA substitute.
 * The isolated runner supplies a synthetic-only log and a silent speech sink. */
export async function hearOrca(label,action,expected,readCurrentItem=false){
 const log=process.env.WHUMPO_ORCA_LOG;
 if(!log){await action();return;}
 if(!process.env.WHUMPO_ORCA_SESSION||process.env.XDG_CONFIG_HOME!==process.env.WHUMPO_ORCA_SESSION+'/config')throw Error('Orca checks require the isolated runner.');
 const start=(await readFile(log,'utf8')).length;
 await action();
 let output='',length=start;
 for(let i=0;i<100;i++){
  // For field metadata, use Orca's normal Where Am I command. This reads its
  // actual AT-SPI focus; repeated read-only observations never move DOM focus.
  if(readCurrentItem&&i%5===0)await execute('gdbus',['call','--session','--dest','org.gnome.Orca.Service','--object-path','/org/gnome/Orca/Service/WhereAmIPresenter','--method','org.gnome.Orca.Module.ExecuteCommand','WhereAmIBasic','true'],{timeout:3000});
  const text=await readFile(log,'utf8');length=text.length;
  output=text.slice(start).split('\n').filter(line=>line.includes('SPEECH OUTPUT:')).join('\n');
  if(expected.every(pattern=>pattern.test(output))){
   await appendFile(process.env.WHUMPO_ORCA_EVIDENCE,JSON.stringify({label,readCurrentItem,output})+'\n');return;
  }
  await new Promise(done=>setTimeout(done,100));
 }
 throw Error(`Orca checkpoint ${label} (log ${start}..${length}) missing ${expected.filter(pattern=>!pattern.test(output))}: ${output.slice(-4000)}`);
}
