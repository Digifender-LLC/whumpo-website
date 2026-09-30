import type {BackendField} from '../../backend-form-shape';
import type {SiteConfig} from '../../components';
export type ModuleId='content'|'records'|'files'|'access'|'notifications'|'automation';
export type SpecificationPage={id:string;path:string;component:'site-page@1';audience:'public'|'staff';headline:string;description:string;aboutTitle:string;aboutText:string;sections:{heading:string;text:string}[]};
export type SpecificationRule={id:string;trigger:{type:'form.accepted';formId:string};effect:{type:'notification.send';integrationId:string;recipient:'staff';template:'submission-link@1'}};
export type ProjectSpecification={
 schemaVersion:1;name:string;design:{theme:SiteConfig['theme']};modules:{id:ModuleId;version:1}[];
 content:{id:string;text:string}[];pages:SpecificationPage[];
 records:{id:string;schemaVersion:1;fields:BackendField[];read:'owner'|'staff';write:'owner'|'staff'}[];
 forms:{id:string;recordId:string;title:string;description:string;buttonLabel:string;submit:'public'|'visitor';uploadCollectionId:string|null}[];
 files:{id:string;read:'owner'|'staff';upload:'visitor';maxBytes:number;mimeTypes:('image/jpeg'|'image/png')[]}[];
 access:{roles:[]|['staff']};integrations:{id:string;capability:'email.staff'}[];rules:SpecificationRule[];
};
export type SpecificationReview='schema'|'permissions'|'integration'|'spending';
export type SpecificationOperation=
 |{type:'content.replace';contentId:string;text:string}
 |{type:'design.setTheme';theme:SiteConfig['theme']}
 |{type:'records.addField';recordId:string;field:Extract<BackendField,{type:'text'}>&{optional:true}}
 |{type:'files.setPolicy';collectionId:string;read:'owner'|'staff';upload:'visitor'}
 |{type:'pages.setAudience';pageId:string;audience:'public'|'staff'}
 |{type:'rules.put';rule:SpecificationRule};
