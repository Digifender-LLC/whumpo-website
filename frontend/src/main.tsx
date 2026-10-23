import React,{lazy} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClientProvider} from '@tanstack/react-query';
import {createRootRoute,createRoute,createRouter,RouterProvider,Outlet} from '@tanstack/react-router';
import {queryClient} from './lib/api';
import {Landing} from './landing';
import {DeferredArea} from './deferred-area';
import {initializePwa} from './lib/pwa';
initializePwa();
const Workspace=lazy(()=>import('./workspace').then(module=>({default:module.Workspace})));
function WorkspaceEntry(){return <DeferredArea label="Opening your workspace…"><Workspace/></DeferredArea>;}
import './styles.css';
const rootRoute=createRootRoute({component:Outlet});
const homeRoute=createRoute({getParentRoute:()=>rootRoute,path:'/',component:Landing});
const workspaceRoute=createRoute({getParentRoute:()=>rootRoute,path:'/workspace',validateSearch:(search:Record<string,unknown>):{signup?:boolean;project?:string;interaction?:string;turn?:string;review?:string;service?:string;ref?:string}=>{
 // Preserve the presence of invalid/ambiguous locators for the single strict
 // workspace resolver. Dropping them here would reopen an unrelated saved item.
 const locator=(value:unknown)=>value===undefined?undefined:typeof value==='string'?value:'';
 return {ref:typeof search.ref==='string'?search.ref:undefined,service:locator(search.service),review:locator(search.review),interaction:locator(search.interaction),turn:locator(search.turn),project:typeof search.project==='string'&&/^[0-9a-f-]{36}$/.test(search.project)?search.project:undefined,signup:search.signup===true||search.signup==='true'||search.signup==='1'};
},component:WorkspaceEntry});
const workspaceView=createRoute({getParentRoute:()=>workspaceRoute,path:'$view',component:()=>null});
const router=createRouter({routeTree:rootRoute.addChildren([homeRoute,workspaceRoute.addChildren([workspaceView])]),defaultNotFoundComponent:()=> <main className="page-pad"><h1 className="text-4xl font-bold">That page isn’t here.</h1><a href="/workspace" className="underline">Return to Whumpo</a></main>});
declare module '@tanstack/react-router'{interface Register{router:typeof router}}
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router}/></QueryClientProvider></React.StrictMode>);
