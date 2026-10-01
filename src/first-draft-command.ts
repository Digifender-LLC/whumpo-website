export const firstAppProjectId=(content:string)=>/^\/first-app ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.exec(content)?.[1];
export const firstDraftProjectId=(content:string)=>/^\/first-draft ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.exec(content)?.[1];
