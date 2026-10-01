// Disposable acceptance entry. It is not part of the deployed route tree.
import {createRoot} from 'react-dom/client';
import {createRootRoute,createRouter,RouterProvider} from '@tanstack/react-router';
import {IdentityGate,IdentitySecurity} from '../../frontend/src/identity/flow';
import '../../frontend/src/styles.css';
function Fixture(){return <IdentityGate signup={new URLSearchParams(location.search).has('signup')}><main className="p-5"><h1 className="text-2xl">Workspace admission reached</h1><IdentitySecurity/></main></IdentityGate>}
const root=createRootRoute({component:Fixture}),router=createRouter({routeTree:root});
createRoot(document.getElementById('root')!).render(<RouterProvider router={router}/>);
