type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
/** Refuse rich content instead of flattening or deleting formatting on save. */
export function editableCMS(value: unknown): {title: string; text: string} | null {
  const snapshot=record(value), item=record(snapshot?.item), data=record(item?.data);
  const title=data?.title, blocks=data?.content;
  if(typeof title!=='string'||title.length>100||!Array.isArray(blocks)||blocks.length!==1)return null;
  const block=record(blocks[0]);
  if(!block||Object.keys(block).some(k=>!['_type','_key','style','markDefs','children'].includes(k))||block._type!=='block'||block.style!=='normal'||!Array.isArray(block.markDefs)||block.markDefs.length||!Array.isArray(block.children)||block.children.length!==1)return null;
  const span=record(block.children[0]);
  if(!span||Object.keys(span).some(k=>!['_type','_key','text','marks'].includes(k))||span._type!=='span'||typeof span.text!=='string'||!Array.isArray(span.marks)||span.marks.length||new TextEncoder().encode(span.text).length>2400)return null;
  return {title,text:span.text};
}
