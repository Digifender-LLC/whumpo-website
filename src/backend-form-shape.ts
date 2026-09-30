export type BackendField={key:string;label:string}&({type:'number'}|{type:'boolean'}|{type:'text';optional?:true}|{type:'choice';options:{value:string;label:string}[]});
export type BackendForm={title:string;description:string;buttonLabel:string;fields:BackendField[]};
