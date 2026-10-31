import {boundAppointment} from './shared-modules/records-setup';
/** WH-070: the "Request an appointment" link on a published site root. Kept out of `published-html.ts` because that file is
 * a pinned input of the project-service-clients@4 compiler, whose identity must not change. Applied on top of
 * `publishedHTML` by the serving path and by the site health check. Both queries repeat the SQL predicate below as a literal (the
 * tenant SQL surface gate refuses concatenated SQL); tests/records-setup.mjs asserts that each contains it byte for byte. The link only says where the hosted form is; whether it is open is decided by that page. */
/** Reference copy; true while the project's standard appointment form is active and bound to publication `s` (alias of `publications`). */
export const appointmentLinkSQL="EXISTS(SELECT 1 FROM module_instances i JOIN module_activations a ON a.instance_id=i.id AND a.state='active' AND a.publication_revision=s.revision WHERE i.project_id=s.project_id AND i.kind='records' AND EXISTS(SELECT 1 FROM json_each(i.config_json,'$.forms') f WHERE json_extract(f.value,'$.id')='appointment' AND json_extract(f.value,'$.submit')='public'))";
export const withAppointmentLink=(html:string,projectId:string,enabled:boolean)=>enabled?html.replace('</main>',`<section aria-label="Appointments" style="margin:40px 0"><h2>Request an appointment</h2><p><a href="https://app-${projectId}.whumpo.site/forms/appointment" target="_blank" rel="noopener noreferrer">Request an appointment ↗</a></p></section></main>`):html;
/** The link is shown only when the SQL pre-filter matched AND the hosted page would be open (`boundAppointment`: current catalog pin, not held, not contained). */
export const appointmentLinkShown=async(db:D1Database,project:string,prefilter:number)=>prefilter===1&&!!await boundAppointment(db,project);
