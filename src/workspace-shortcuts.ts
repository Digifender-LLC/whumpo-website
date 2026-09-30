// Saved workflow actions are capability names, never model-authored commands or URLs.
export const workspaceShortcuts = {
  project: {label:'Project status',command:'/project'},
  versions: {label:'Saved versions',command:'/versions'},
  health: {label:'Website health',command:'/health'},
  checkWebsite: {label:'Check website now',command:'/check-site'},
  application: {label:'Application status',command:'/app-status'},
} as const;
export type WorkspaceShortcut = keyof typeof workspaceShortcuts;
export function shortcutCommand(kind:WorkspaceShortcut,projectId:string|null){
  if(!projectId||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(projectId)||!Object.hasOwn(workspaceShortcuts,kind))return null;
  return workspaceShortcuts[kind].command+' '+projectId;
}
