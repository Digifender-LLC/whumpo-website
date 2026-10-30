// Component acceptance fixture only; it creates no server interaction or action.
import {createRoot} from 'react-dom/client';
import {NoticeSetup,type Setup} from '../../frontend/src/records-panel';
import '../../frontend/src/styles.css';
const project='11111111-1111-4111-8111-111111111111';
const base:Setup={delivery:'spending-limit-unset',forms:[],notices:{sent:0,waiting:0,notSent:0}};
const saved:Setup={delivery:'inactive',forms:[{instanceId:'requests',formId:'appointment',notices:{owner:true,staff:false,receipt:true},businessName:'Garden Salon',revision:2}],notices:{sent:3,waiting:1,notSent:4}};
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-[900px] space-y-6 p-4">
 <div id="fresh"><NoticeSetup project={project} instance="requests" form="appointment" submit="visitor" setup={base}/></div>
 <div id="saved"><NoticeSetup project={project} instance="requests" form="appointment" submit="visitor" setup={saved}/></div>
 <div id="anonymous"><NoticeSetup project={project} instance="requests" form="walk-in" submit="public" setup={{...base,delivery:'active'}}/></div>
</main>);
