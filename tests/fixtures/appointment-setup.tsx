// Component acceptance fixture only; it creates no server interaction or action.
import {createRoot} from 'react-dom/client';
import {AppointmentFormSetup} from '../../frontend/src/records-panel';
import type {RecordsSetup} from '../../src/shared-modules/shape';
import '../../frontend/src/styles.css';
const project='11111111-1111-4111-8111-111111111111';
const states:Record<string,RecordsSetup>={
 website:{state:'website-required',instanceId:null,publicForm:'none'},
 fresh:{state:'not-configured',instanceId:null,publicForm:'none'},
 saved:{state:'saved',instanceId:'appointments',publicForm:'none'},
 off:{state:'registered',instanceId:'appointments',publicForm:'inactive'},
 unpublished:{state:'registered',instanceId:'appointments',publicForm:'unpublished'},
 stale:{state:'registered',instanceId:'appointments',publicForm:'stale'},
 bound:{state:'registered',instanceId:'appointments',publicForm:'bound'},
};
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-[900px] space-y-6 p-4">
 {Object.entries(states).map(([id,setup])=><div key={id} id={id}><AppointmentFormSetup project={project} setup={setup}/></div>)}
</main>);
