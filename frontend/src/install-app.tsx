import {useState,useSyncExternalStore} from 'react';
import {Download,Check,Smartphone} from 'lucide-react';
import {Button} from './components/ui/button';
import {Card,CardHeader,CardTitle,CardDescription,CardContent} from './components/ui/card';
import {installSnapshot,promptInstall,subscribeInstall} from './lib/pwa';

export function InstallApp(){
 const {available,installed}=useSyncExternalStore(subscribeInstall,installSnapshot,installSnapshot);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const iphone=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 return <Card className="workspace-card shadow-none rounded-lg"><CardHeader><CardTitle className="text-xl font-bold flex items-center gap-2"><Smartphone className="size-5"/>Whumpo, a tap away</CardTitle><CardDescription>Keep your workspace on your home screen.</CardDescription></CardHeader><CardContent className="space-y-4">
  {installed?<p className="flex items-center gap-2 text-sm"><Check className="size-4"/>Whumpo is installed on this device.</p>:<>
   {available?<Button className="min-h-12" disabled={busy} onClick={async()=>{setBusy(true);setNotice('');const result=await promptInstall();setBusy(false);setNotice(result==='accepted'?'Your browser is adding Whumpo.':result==='dismissed'?'You can add Whumpo later from your browser’s menu.':'Use your browser’s menu to add Whumpo.');}}><Download className="size-4"/>{busy?'Opening install…':'Add Whumpo to your device'}</Button>:<p className="text-sm leading-relaxed">{iphone?<>In Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. Keep <strong>Open as Web App</strong> on if it’s shown, then tap <strong>Add</strong>.</>:<>Open your browser’s menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>. On a computer, look for the install icon in the address bar.</>}</p>}
   <p className="text-xs text-muted-foreground">An internet connection is needed for Chat and your projects.</p>
  </>}
  {notice&&<p role="status" className="text-sm">{notice}</p>}
 </CardContent></Card>;
}
