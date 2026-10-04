/** WH-125/126 registration with the WH-105 Chat/view contract. Adapter table only: it owns no table, eligibility rule
 * or ownership check, and a model is never a caller. Visitor-, staff- and public-submitted module values are never
 * a binding output, Chat history or model input; owners read them in their dedicated dashboard panels (WH-127+). */
export const moduleBindings=Object.freeze({
 'module.instances@1':{mode:'read',scope:'project',handler:'readModuleInstances',surface:'view widget modules (saved page and Chat temporary view)',inclusion:'identity and ownership only',modelContext:'instance ids, kinds, states and revisions'},
 moduleActivationReview:{mode:'prepare',scope:'project',handler:'prepareModuleActivationCommand',surface:'ChatControl moduleActivationReview',inclusion:'activate: current core.forms (records) or core.editing prepare; disable: identity and ownership only',modelContext:'review summary without configuration values'},
 // WH-126 owner visitor access setup: prepares the existing exact specification review for the fixed standard access
 // instance; saving is specificationApply and activation is moduleActivationReview/Apply. Never a model action.
 accessModuleReview:{mode:'prepare',scope:'project',handler:'prepareAccessModuleCommand',surface:'ChatControl accessModuleReview (Visitors panel)',inclusion:'identity and ownership only (activation re-checks core.editing)',modelContext:'specification review summary'},
 // WH-128 owner photo collection setup: prepares the existing exact specification review for the fixed standard files
 // instance (one owner-only collection); saving is specificationApply and activation is moduleActivationReview/Apply.
 filesModuleReview:{mode:'prepare',scope:'project',handler:'prepareFilesModuleCommand',surface:'ChatControl filesModuleReview (Photos panel)',inclusion:'identity and ownership only (activation re-checks core.editing)',modelContext:'specification review summary'},
 // WH-128 published gallery: prepares the existing exact specification review that sets one page's photos to the newest
 // approved owner-filed photos of an owner collection; saving is specificationApply and going public is the existing
 // exact publication review. Never a model action.
 galleryPageReview:{mode:'prepare',scope:'project',handler:'prepareGalleryPageCommand',surface:'ChatControl galleryPageReview',inclusion:'identity and ownership only (saving and publication keep their own checks)',modelContext:'specification review summary (owner photo ids and names only)'},
 moduleActivationApply:{mode:'confirm',scope:'review',handler:'applyModuleActivationCommand',surface:'ChatControl moduleActivationApply (recent sign-in)',inclusion:'activate: current inclusion confirm composed into the receipt insert; disable: identity and ownership only',modelContext:'applied receipt summary'},
 // WH-126 access module: owner staff roster and exact staff role reviews. Visitor ids are opaque; no credential,
 // recovery code, session, document or visitor-submitted value is a binding output.
 'access.roles@1':{mode:'read',scope:'project',handler:'readAccessRoles',surface:'view widget access-roles (saved page and Chat temporary view)',inclusion:'identity and ownership only',modelContext:'access instance ids, opaque visitor ids, staff state and dates'},
 accessRoleReview:{mode:'prepare',scope:'project',handler:'prepareAccessRoleCommand',surface:'ChatControl accessRoleReview',inclusion:'grant: current core.editing prepare; revoke: identity and ownership only',modelContext:'review summary with opaque visitor id'},
 accessRoleApply:{mode:'confirm',scope:'review',handler:'applyAccessRoleCommand',surface:'ChatControl accessRoleApply (recent sign-in)',inclusion:'grant: current core.editing confirm composed into the receipt insert; revoke: identity and ownership only',modelContext:'applied receipt summary'},
 // WH-127 records counts per registered records instance. Field labels, values, entry ids and visitor ids are never a
 // binding output; owners read values only in the dashboard records panel (GET /api/projects/P/module-records/R/S).
 'records.summary@1':{mode:'read',scope:'project',handler:'readRecordsSummary',surface:'view widget records-summary (saved page and Chat temporary view) and the owner records panel',inclusion:'identity and ownership only',modelContext:'records instance ids, states, revisions, retention, counts by submitter kind, form and view ids with audiences'},
 'whumpo-modules@1':{mode:'serve',scope:'resource',handler:'handleModuleRequest',surface:'shared module request engine; visitor origin POST /modules (WH-126) and workspace origin POST /api/projects/P/modules (owner, WH-127) with access.me/access.list, records handlers (forms.submit, records.get/view/update/remove) and files handlers (files.putBytes on the visitor upload route POST /modules/upload, owner files.putBytes filing an existing owner photo on the workspace route, files.gallery, files.read) and collections.readPublic (approved directory snapshot only, WH-129)',inclusion:'serving checks activation and the principal, never the owner subscription',modelContext:'never'},
} as const);
