// Linux-only, opt-in Orca integration. Private display, session/accessibility
// buses, settings and silent Speech Dispatcher; no access to real account UI.
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,stat,open} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const siteSafety=process.argv.includes('--site-safety');
const savedTurns=process.argv.includes('--saved-turns'),crossTab=process.argv.includes('--cross-tab');
const identityJourney=process.argv.includes('--identity'),recoveryJourney=process.argv.includes('--recovery'),accountHelp=process.argv.includes('--account-help');
if([identityJourney,recoveryJourney,accountHelp,savedTurns,crossTab,siteSafety].filter(Boolean).length>1)throw Error('Choose one identity, recovery or account-help journey.');
const wait=ms=>new Promise(done=>setTimeout(done,ms));
async function run(command,args,options={}){
 const child=spawn(command,args,{stdio:'inherit',...options});
 return new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(Error(`${command} exited ${code??signal}`)));});
}
if(!process.argv.includes('--isolated-session')){
 const dir=await mkdtemp('/tmp/whumpo-orca-');
 for(const name of ['config','cache','data','runtime','speech','logs'])await mkdir(dir+'/'+name,{mode:0o700});
 // Only child processes receive these paths. The user's dconf, display,
 // accessibility bus and existing Orca process are never changed or replaced.
 const {chromium}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
 const env={...process.env,WHUMPO_ORCA_SESSION:dir,WHUMPO_CHROMIUM:process.env.WHUMPO_CHROMIUM||chromium.executablePath(),XDG_CONFIG_HOME:dir+'/config',XDG_CACHE_HOME:dir+'/cache',XDG_DATA_HOME:dir+'/data',XDG_RUNTIME_DIR:dir+'/runtime'};
 delete env.DBUS_SESSION_BUS_ADDRESS;delete env.AT_SPI_BUS_ADDRESS;delete env.WAYLAND_DISPLAY;env.XDG_SESSION_TYPE='x11';
 await run('dbus-run-session',['--',process.execPath,fileURLToPath(import.meta.url),...(siteSafety?['--site-safety']:crossTab?['--cross-tab']:identityJourney?['--identity']:recoveryJourney?['--recovery']:accountHelp?['--account-help']:savedTurns?['--saved-turns']:[]),'--isolated-session',dir],{env});
 console.log('Isolated Orca speech-generation evidence: '+dir+'/speech-evidence.jsonl');
}else{
 const dir=process.argv.at(-1),children=[],files=[];
 if(process.env.WHUMPO_ORCA_SESSION!==dir||process.env.XDG_CONFIG_HOME!==dir+'/config'||process.env.XDG_RUNTIME_DIR!==dir+'/runtime'||!process.env.DBUS_SESSION_BUS_ADDRESS)throw Error('Run this fixture through its private session launcher.');
 async function service(command,args,env){
  const file=await open(dir+'/logs/'+command+'.process.log','w');files.push(file);
  const child=spawn(command,args,{env,stdio:['ignore',file.fd,file.fd,'pipe']});children.push(child);
  child.on('error',error=>{child.startError=error;});return child;
 }
 try{
  await writeFile(dir+'/speech/speechd.conf','LogLevel 3\nAudioOutputMethod "alsa"\nAudioALSADevice "null"\nAddModule "dummy" "sd_dummy" ""\nDefaultModule dummy\nDisableAutoSpawn\n');
  const display=await service('Xvfb',['-displayfd','3','-screen','0','1280x1000x24','-nolisten','tcp'],process.env);
  let number='';display.stdio[3].on('data',bytes=>number+=bytes);
  for(let i=0;!number.includes('\n')&&i<50;i++){if(display.startError)throw display.startError;if(display.exitCode!==null)throw Error('Private Xvfb failed');await wait(100);}
  if(!/^\d+\n/.test(number))throw Error('Private display did not start');
  const env={...process.env,DISPLAY:':'+number.trim(),SPEECHD_ADDRESS:'unix_socket:'+dir+'/speech.sock',NO_AT_BRIDGE:'0',WHUMPO_ORCA_LOG:dir+'/orca.log',WHUMPO_ORCA_EVIDENCE:dir+'/speech-evidence.jsonl'};
  await service('speech-dispatcher',['-s','-C',dir+'/speech','-L',dir+'/logs','-S',dir+'/speech.sock','-P',dir+'/speech.pid','-t','0'],env);
  for(let i=0;i<50;i++){if(await stat(dir+'/speech.sock').catch(()=>null))break;if(i===49)throw Error('Private speech sink did not start');await wait(100);}
  await run('gsettings',['set','org.gnome.desktop.a11y.applications','screen-reader-enabled','true'],{env});
  // Automatic whole-page reading changes DOM focus while our controls are
  // exercised. Use Orca's ordinary focus-driven mode in this private profile.
  await run('gsettings',['set','org.gnome.Orca.Document:/org/gnome/orca/default/document/','say-all-on-load','false'],{env});
  // Orca's debug file is buffered. Flush it on its own event loop so each
  // checkpoint observes generated speech before an idle reader exits.
  const launcher="import runpy, sys\nfrom gi.repository import GLib\nfrom orca import debug\ndef flush():\n if debug.debugFile: debug.debugFile.flush()\n return True\nGLib.timeout_add(50, flush)\nsys.argv=['orca','--debug-file',sys.argv[1]]\nrunpy.run_path('/usr/bin/orca',run_name='__main__')\n";
  const orca=await service('python3',['-u','-c',launcher,dir+'/orca.log'],env);
  for(let i=0;i<50;i++){if(orca.startError)throw orca.startError;if(orca.exitCode!==null)throw Error('Private Orca failed');if(await stat(dir+'/orca.log').catch(()=>null))break;await wait(100);}
  await run(process.execPath,siteSafety?['tests/workspace-identity-browser.mjs','--d1','--site-safety']:crossTab?['tests/workspace-identity-browser.mjs','--d1','--cross-tab']:accountHelp?['tests/workspace-identity-browser.mjs','--d1','--account-help']:identityJourney?['tests/workspace-identity-browser.mjs','--d1','--accessibility']:recoveryJourney?['tests/identity-browser.mjs','--d1']:['tests/chat-interaction-browser.mjs','--d1',...(savedTurns?['--saved-turns']:[])],{env});
 }finally{
  for(const child of children.reverse()){
   if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),wait(1500)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
  }
  for(const file of files)await file.close();
 }
}
