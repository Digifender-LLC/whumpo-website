// Component acceptance fixture only; it creates no server interaction or action.
import {createRoot} from 'react-dom/client';
import {PublicFormNote} from '../../frontend/src/records-panel';
import '../../frontend/src/styles.css';
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-[900px] space-y-6 p-4">
 {(['bound','inactive','unpublished','stale','none'] as const).map(s=><div id={s} key={s}><PublicFormNote state={s}/></div>)}
</main>);
