/** Versioned launch packaging, never a grant or runtime authorization decision. */
export const connectionProviders = [
  {id:'github',name:'GitHub'}, {id:'cloudflare',name:'Cloudflare'},
  {id:'gmail',name:'Gmail'}, {id:'google-calendar',name:'Google Calendar'},
  {id:'outlook-email',name:'Outlook email'}, {id:'microsoft-calendar',name:'Microsoft Calendar'},
  {id:'hubspot',name:'HubSpot'}
] as const;
export type ConnectionProviderId = typeof connectionProviders[number]['id'];
type FeatureDefinition = {id:string;name:string;implementation:'private-test'|'planned';connection?:ConnectionProviderId};
const core = [
  {id:'core.editing',name:'Website and supported app editing',implementation:'private-test'},
  {id:'core.forms',name:'Supported forms and basic contact handling',implementation:'private-test'},
  {id:'core.publication',name:'Reviewed publishing and saved versions',implementation:'private-test'},
  {id:'core.insights',name:'Basic traffic and health information',implementation:'private-test'},
  {id:'core.security',name:'Account security and exact action reviews',implementation:'private-test'},
  {id:'core.recovery',name:'Basic account and supported project recovery',implementation:'private-test'},
  {id:'core.export',name:'Supported source and data export',implementation:'private-test'},
  {id:'ai.standard',name:'Standard assistance under unlimited fair use',implementation:'private-test'}
] as const satisfies readonly FeatureDefinition[];
const creator = [
  {id:'creator.brand-kits',name:'Versioned brand kits',implementation:'planned'},
  {id:'creator.saved-sections',name:'Saved reusable page sections',implementation:'planned'},
  {id:'creator.shared-styles',name:'Shared styles with reviewed project updates',implementation:'planned'},
  {id:'creator.guest-feedback',name:'Private guest feedback without an account',implementation:'private-test'}
] as const satisfies readonly FeatureDefinition[];
const business = [
  {id:'connections.github',name:'GitHub connection',implementation:'private-test',connection:'github'},
  {id:'connections.cloudflare',name:'Cloudflare connection',implementation:'private-test',connection:'cloudflare'},
  {id:'connections.gmail',name:'Gmail connection',implementation:'planned',connection:'gmail'},
  {id:'connections.google-calendar',name:'Google Calendar connection',implementation:'planned',connection:'google-calendar'},
  {id:'connections.outlook-email',name:'Outlook email connection',implementation:'planned',connection:'outlook-email'},
  {id:'connections.microsoft-calendar',name:'Microsoft Calendar connection',implementation:'planned',connection:'microsoft-calendar'},
  {id:'connections.hubspot',name:'HubSpot connection',implementation:'planned',connection:'hubspot'},
  {id:'business.leads',name:'Lead stages, notes and due dates',implementation:'private-test'},
  {id:'business.reminders',name:'Follow-up reminders',implementation:'planned'},
  {id:'business.workflows',name:'Reviewed form-to-record-to-notification workflows',implementation:'planned'},
  {id:'business.conversions',name:'Conversion summaries',implementation:'planned'}
] as const satisfies readonly FeatureDefinition[];
const pro = [
  {id:'pro.members',name:'Workspace members and roles',implementation:'planned'},
  {id:'pro.approvals',name:'Team approval workflows',implementation:'planned'},
  {id:'pro.staging',name:'Private staging and reviewed release promotion',implementation:'planned'},
  {id:'pro.portfolio',name:'Portfolio reports',implementation:'planned'},
  {id:'pro.bulk-updates',name:'Reviewed changes across selected projects',implementation:'planned'}
] as const satisfies readonly FeatureDefinition[];
const definitions = [...core,...creator,...business,...pro];
export type LaunchFeatureId = typeof definitions[number]['id'];
export const launchFeatureCatalogue = {
  version:1,
  purpose:'launch-packaging-only',
  commercialActivation:false,
  features:definitions.map((feature:Omit<FeatureDefinition,'id'>&{id:LaunchFeatureId})=>({
    ...feature,
    configuration:feature.connection?'per-account-consent-required':'not-a-provider-connection',
    customerAcceptance:'pending'
  }))
} as const;
const starterFeatures = core.map(f=>f.id);
const creatorFeatures = [...starterFeatures,...creator.map(f=>f.id)];
const businessFeatures = [...creatorFeatures,...business.map(f=>f.id)];
export const launchFeaturesByPlan = {
  explore:{inherits:null,externalConnections:false,featureIds:[]},
  starter:{inherits:null,externalConnections:false,featureIds:starterFeatures},
  personal:{inherits:'starter',externalConnections:false,featureIds:creatorFeatures},
  business:{inherits:'personal',externalConnections:true,featureIds:businessFeatures},
  'business-pro':{inherits:'business',externalConnections:true,featureIds:[...businessFeatures,...pro.map(f=>f.id)]}
} as const;

export const connectionProviderNames = connectionProviders.map(p=>p.name).join(', ');
export const externalConnectionsLaunchNotice = `Planned for Business and Business Pro: ${connectionProviderNames}. External account connections are not included with Starter or Creator. Each provider needs setup, customer consent and acceptance before availability.`;
export const launchAvailabilityNotice = 'These are planned launch inclusions. Some features are still in testing; planned features are not available yet. Saving preferences or starting a sandbox subscription does not enable them.';
export const commonFeatureNotice = 'All four plans retain security, exact action reviews, basic recovery, supported export and standard assistance under fair use. Standard assistance uses no customer credits; advanced-model spending requires separate consent and remains unavailable.';
export const guestFeedbackNotice = 'Planned guest links expire and can be revoked. Guests need no account and gain no workspace, editing, publishing or spending access.';
export const launchHighlights = {
  explore:['Free, invite-only private preview'],
  starter:['Website or small app editing','Supported forms and basic traffic information','Standard assistance under fair use'],
  personal:creator.map(f=>f.name),
  business:['Seven external account connections','Lead stages, notes and due dates','Follow-up reminders and configured workflows','Conversion summaries'],
  'business-pro':['Workspace members, roles and approvals','Private staging and reviewed releases','Portfolio reports','Reviewed changes across selected projects']
} as const;

/** Packaging lookup only. Unknown/legacy IDs must not inherit a current launch tier. */
export function launchPackaging(planId:string) {
  return Object.hasOwn(launchFeaturesByPlan,planId)
    ? launchFeaturesByPlan[planId as keyof typeof launchFeaturesByPlan] : null;
}
