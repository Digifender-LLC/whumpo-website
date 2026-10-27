import {useEffect} from 'react';
import {useQuery} from '@tanstack/react-query';
import type {Profile} from './api';
const KEY='whumpo.theme',valid=(v:unknown):v is 'light'|'dark'|'system'=>v==='light'||v==='dark'||v==='system';
export const clearSavedTheme=()=>{try{localStorage.removeItem(KEY);}catch{}};
const stored=()=>{try{const v=localStorage.getItem(KEY);return valid(v)?v:undefined;}catch{return undefined;}};
// Subscribes to the cached session without a queryFn and never fetches, so identity-only pages stay profile-free.
// A display preference kept in localStorage covers direct loads where the session cache is empty; cleared with other device records at sign-out.
export function useWorkspaceTheme(){
 const saved=useQuery<Profile>({queryKey:['session'],enabled:false}).data?.theme,theme=valid(saved)?saved:stored()??'system';
 useEffect(()=>{if(valid(saved))try{localStorage.setItem(KEY,saved);}catch{}},[saved]);
 useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)'),apply=()=>document.documentElement.classList.toggle('dark',theme==='dark'||theme==='system'&&media.matches);apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);},[theme]);
}
