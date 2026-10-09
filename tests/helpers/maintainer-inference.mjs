import {build} from 'esbuild';
/** Source modules that can dispatch, route, meter or continue owner-maintenance (Whumpo AI) model inference.
 * Visitor, service and scheduled entry points must not reach any of them (WH-073); keep this list a superset of
 * every inference caller and of the modules that exist only to serve one. Paths are esbuild metafile inputs. */
export const inferenceModules=/^src\/(?:ai|ai-chat|ai-gateway|acknowledgment|site-agent|agent-[a-z-]+|standard-ai[a-z-]*|chat|backend-chat|app-upgrade-chat|app-recovery-chat|app-page-design|gateway-[a-z-]+|model-[a-z-]+|inference-routing)\.ts$|^src\/chat-interactions\//;
/** Every input an entry point's static import graph reaches that matches `inferenceModules` (sorted; empty when independent).
 * The `.wasm` engine of the runtime Worker is stubbed because only the module graph is inspected. */
export async function inferenceReach(entry){
 const out=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'node',write:false,metafile:true,logLevel:'silent',loader:{'.wasm':'empty'}});
 return Object.keys(out.metafile.inputs).filter(path=>inferenceModules.test(path)).sort();
}
