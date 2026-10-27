import {useEffect} from 'react';
import {useQuery} from '@tanstack/react-query';
import type {Profile} from './api';
// Subscribes to the cached session without a queryFn and never fetches, so identity-only pages stay profile-free.
export function useWorkspaceTheme(){
 const theme=useQuery<Profile>({queryKey:['session'],enabled:false}).data?.theme??'system';
 useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)'),apply=()=>document.documentElement.classList.toggle('dark',theme==='dark'||theme==='system'&&media.matches);apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);},[theme]);
}
