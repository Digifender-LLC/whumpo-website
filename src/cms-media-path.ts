// The only query-bearing CMS bridge route: canonical bounded metadata pagination.
export const cmsMediaListPath=/^\/_emdash\/api\/media\?page=(?:[1-9]\d{0,2}|1000)&limit=20$/;
export function cmsMediaPath(page:number){return '/_emdash/api/media?page='+page+'&limit=20';}
