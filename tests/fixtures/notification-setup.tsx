// Component acceptance fixture only; it creates no server interaction or action.
import {createRoot} from 'react-dom/client';
import {NoticeSetup,type Setup} from '../../frontend/src/records-panel';
import '../../frontend/src/styles.css';
const project='11111111-1111-4111-8111-111111111111';
const base:Setup={delivery:'spending-limit-unset',forms:[]};
const counts={sent:3,waiting:1,notSent:4};
const form=(formId:string,sending:Setup['forms'][number]['sending'],notices:{owner:boolean;staff:boolean;receipt:boolean})=>({instanceId:'requests',formId,notices,businessName:'Garden Salon',revision:2,sending,counts});
const saved:Setup={delivery:'inactive',forms:[form('appointment','inactive',{owner:true,staff:false,receipt:true})]};
const later:Setup={delivery:'active',forms:[form('walk-in','active',{owner:true,staff:false,receipt:true}),form('quiet','off',{owner:false,staff:false,receipt:false}),form('nobody','needs-address',{owner:true,staff:false,receipt:false})]};
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-[900px] space-y-6 p-4">
 <div id="fresh"><NoticeSetup project={project} instance="requests" form="appointment" submit="visitor" setup={base}/></div>
 <div id="saved"><NoticeSetup project={project} instance="requests" form="appointment" submit="visitor" setup={saved}/></div>
 <div id="anonymous"><NoticeSetup project={project} instance="requests" form="walk-in" submit="public" setup={later}/></div>
 <div id="quiet"><NoticeSetup project={project} instance="requests" form="quiet" submit="visitor" setup={later}/></div>
 <div id="nobody"><NoticeSetup project={project} instance="requests" form="nobody" submit="visitor" setup={later}/></div>
</main>);
