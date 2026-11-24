import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, rename, rm } from "node:fs/promises";

export function digest(value:string):string {
  return createHash("sha256").update(value).digest("hex");
}
export async function atomicJson(path:string,value:unknown):Promise<void>{
  const tmp=path+"."+randomUUID()+".tmp";
  try{
    await writeFile(tmp,JSON.stringify(value,null,2)+"\n",{encoding:"utf8",mode:0o600});
    await rename(tmp,path);
  }finally{await rm(tmp,{force:true}).catch(()=>{});}
}
export async function readCheckpoint(path:string):Promise<unknown>{
  return JSON.parse(await readFile(path,"utf8"));
}
export function isDigest(value:unknown):value is string{
  return typeof value==="string"&&/^[0-9a-f]{64}$/.test(value);
}
