import type {SiteConfig} from '../../components';
import type {ModuleInstance} from './modules';
export type {ModuleInstance,ModuleKind,ModulePin,RecordsConfig,FilesConfig,AccessConfig,CollectionsConfig,RecordField} from './modules';
/** Compiler/library modules. Shared records, files, access and collections are pinned `instances`, not module IDs. */
export type ModuleId='content'|'notifications'|'automation';
export type SpecificationPage={id:string;path:string;component:'site-page@1'|'photo-page@1';photos:{id:string;alt:string}[];audience:'public'|'staff';headline:string;description:string;aboutTitle:string;aboutText:string;sections:{heading:string;text:string}[]};
export type SpecificationRule={id:string;trigger:{type:'form.accepted';formId:string};effect:{type:'notification.send';integrationId:string;recipient:'staff';template:'submission-link@1'}};
export type ProjectSpecification={
 schemaVersion:3;name:string;design:{theme:SiteConfig['theme']};modules:{id:ModuleId;version:1|2}[];
 content:{id:string;text:string}[];pages:SpecificationPage[];
 instances:ModuleInstance[];
 integrations:{id:string;capability:'email.staff'}[];rules:SpecificationRule[];
};
export type SpecificationReview='schema'|'permissions'|'integration'|'spending';
/** WH-067 hook class of an accepted change. `migration-required` never returns: it rejects with MIGRATION_REQUIRED. */
export type SpecificationMigration='none'|'additive-optional';
export type SpecificationOperation=
 |{type:'content.replace';contentId:string;text:string}
 |{type:'project.setName';name:string}
 |{type:'pages.setSections';pageId:string;sections:{heading:string;text:string}[]}
 |{type:'pages.setPhotos';pageId:string;photos:{id:string;alt:string}[]}
 |{type:'design.setTheme';theme:SiteConfig['theme']}
 |{type:'modules.put';instance:ModuleInstance}
 |{type:'records.addField';instanceId:string;schemaId:string;field:Record<string,unknown>}
 |{type:'pages.setAudience';pageId:string;audience:'public'|'staff'}
 |{type:'rules.put';rule:SpecificationRule};
