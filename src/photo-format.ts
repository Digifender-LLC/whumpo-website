export class FileError extends Error { constructor(public status:number,message:string){super(message);} }
export const maxPhotoBytes=1048576;
/** Baseline JPEG envelope validation and metadata removal; not a pixel decoder. */
export function cleanPhoto(bytes:Uint8Array) {
 const bad=()=>new FileError(400,'Use the photo picker to resize and prepare a JPEG photo');
 if(bytes.length<20 || bytes.length>maxPhotoBytes || bytes[0]!==255 || bytes[1]!==216)throw bad();
 let i=2,width=0,height=0,quantization=false,huffman=false;const chunks=[bytes.slice(0,2)];
 while(i<bytes.length){
  const start=i;if(bytes[i++]!==255)throw bad();const marker=bytes[i++];
  if(i+2>bytes.length)throw bad();const length=(bytes[i]<<8)|bytes[i+1],end=i+length;
  if(length<2||end>bytes.length)throw bad();
  if((marker>=224&&marker<=239)||marker===254){i=end;continue;} // EXIF, GPS, comments, thumbnails and profiles.
  if(![192,196,219,221,218].includes(marker))throw bad();
  if(marker===192){
   if(width||length<11||bytes[i+2]!==8)throw bad();
   height=(bytes[i+3]<<8)|bytes[i+4];width=(bytes[i+5]<<8)|bytes[i+6];const components=bytes[i+7];
   if(![1,3].includes(components)||length!==8+3*components||width<1||height<1||width>1600||height>1600)throw bad();
  }
  if(marker===219)quantization=true;if(marker===196)huffman=true;
  chunks.push(bytes.slice(start,end));i=end;
  if(marker===218){
   const count=bytes[start+4];
   if(!width||!quantization||!huffman||![1,3].includes(count)||length!==6+2*count||bytes[end-3]!==0||bytes[end-2]!==63||bytes[end-1]!==0)throw bad();
   let finished=false;
   for(let n=i;n<bytes.length;n++){
    if(bytes[n]!==255)continue;
    const next=bytes[++n];if(next===0||(next>=208&&next<=215))continue;
    if(next===217&&n===bytes.length-1&&n>i+1){finished=true;break;}throw bad();
   }
   if(!finished)throw bad();chunks.push(bytes.slice(i));
   const output=new Uint8Array(chunks.reduce((sum,c)=>sum+c.length,0));let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}
   return {bytes:output,width,height};
  }
 }
 throw bad();
}
