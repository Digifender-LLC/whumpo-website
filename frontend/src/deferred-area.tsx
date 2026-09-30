import {Component,Suspense,type ReactNode} from 'react';
import {Button} from './components/ui/button';

/** Keep navigation outside this boundary so a failed panel never traps the customer. */
export class DeferredArea extends Component<{children:ReactNode;label:string},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){
  if(this.state.failed)return <div className="page-pad space-y-4" role="alert"><h2 className="text-xl font-bold">This page couldn’t open.</h2><p className="text-sm text-muted-foreground">Check your connection, then reload. Any unsaved changes will be lost.</p><Button onClick={()=>window.location.reload()}>Reload page</Button></div>;
  return <Suspense fallback={<div className="page-pad" role="status" aria-live="polite"><p className="text-sm text-muted-foreground">{this.props.label}</p></div>}>{this.props.children}</Suspense>;
 }
}
