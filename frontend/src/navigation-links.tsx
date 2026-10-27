import {Link} from '@tanstack/react-router';
import {ArrowLeft} from 'lucide-react';
import {Button} from './components/ui/button';
import {returnTarget} from './lib/workspace-navigation';
/** The one return link for fixed pages: "Back to <where you came from>". */
export function ReturnLink(){
 const {view,label}=returnTarget(),content=<><ArrowLeft className="size-4"/>Back to {label}</>;
 return <Button asChild variant="quiet" className="min-h-11 h-auto whitespace-normal">{view==='chat'?<Link to="/workspace" search={{signup:false}}>{content}</Link>:<Link to="/workspace/$view" params={{view}} search={{}}>{content}</Link>}</Button>;
}
