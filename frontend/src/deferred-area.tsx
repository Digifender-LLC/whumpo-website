import {Component,Suspense,type ReactNode} from 'react';
import {Button} from './components/ui/button';
import {SkeletonCard} from './view-states';

/** Keep navigation outside this boundary so a failed panel never traps the customer. */
export class DeferredArea extends Component<{children:ReactNode;label:string},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){
  if(this.state.failed)return <div className="page-pad space-y-4" role="alert"><h2 className="text-heading">This page couldn’t open.</h2><p className="text-body-sm text-ink-muted">Check your connection, then reload. Any unsaved changes will be lost.</p><Button onClick={()=>window.location.reload()}>Reload page</Button></div>;
  return <Suspense fallback={<div className="page-pad"><SkeletonCard label={this.props.label} lines={5}/></div>}>{this.props.children}</Suspense>;
 }
}
