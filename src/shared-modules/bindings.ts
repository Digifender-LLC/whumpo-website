/** WH-125 registration with the WH-105 Chat/view contract. Adapter table only: it owns no table, eligibility rule
 * or ownership check, and a model is never a caller. Visitor-, staff- and public-submitted module values are never
 * a binding output, Chat history or model input; owners read them in their dedicated dashboard panels (WH-127+). */
export const moduleBindings=Object.freeze({
 'module.instances@1':{mode:'read',scope:'project',handler:'readModuleInstances',surface:'view widget modules (saved page and Chat temporary view)',inclusion:'identity and ownership only',modelContext:'instance ids, kinds, states and revisions'},
 moduleActivationReview:{mode:'prepare',scope:'project',handler:'prepareModuleActivationCommand',surface:'ChatControl moduleActivationReview',inclusion:'activate: current core.forms (records) or core.editing prepare; disable: identity and ownership only',modelContext:'review summary without configuration values'},
 moduleActivationApply:{mode:'confirm',scope:'review',handler:'applyModuleActivationCommand',surface:'ChatControl moduleActivationApply (recent sign-in)',inclusion:'activate: current inclusion confirm composed into the receipt insert; disable: identity and ownership only',modelContext:'applied receipt summary'},
 'whumpo-modules@1':{mode:'serve',scope:'resource',handler:'handleModuleRequest',surface:'shared module request engine; WH-125 registers no kind handlers or routes',inclusion:'serving checks activation and the principal, never the owner subscription',modelContext:'never'},
} as const);
