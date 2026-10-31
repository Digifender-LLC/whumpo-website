// Journey fixture: the actual RecordList, wired to whatever /api routes the test serves. Project and resource come from the query string.
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {RecordList} from '../../frontend/src/records-panel';
import '../../frontend/src/styles.css';
const q=new URLSearchParams(location.search),client=new QueryClient({defaultOptions:{queries:{retry:false}}});
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><main className="mx-auto max-w-[900px] space-y-6 p-4"><RecordList project={q.get('project')!} resourceId={q.get('resource')!} recordId="request" onChanged={()=>{}}/></main></QueryClientProvider>);
