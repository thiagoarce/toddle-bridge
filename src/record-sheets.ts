import { chromium } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, basename } from "node:path";

const args=process.argv.slice(2);
function option(name:string,fallback:string){
  const i=args.indexOf("--"+name);
  if(i<0)return fallback;
  if(!args[i+1]||args[i+1].startsWith("--"))throw Error("Missing value for --"+name);
  return args[i+1];
}
const workflow=option("workflow","assignment");
if(!/^[a-z][a-z0-9-]{0,39}$/.test(workflow))throw Error("Invalid workflow");
const per=Number(option("per-sheet","6"));
if(!Number.isInteger(per)||per<1||per>12)throw Error("--per-sheet must be between 1 and 12");
const root=resolve(".local","reports");
const report=JSON.parse(await readFile(resolve(root,"toddle-record-"+workflow+".json"),"utf8"));
type Shot={session:number;state:number;click:number|null;elapsedMs:number;file:string;reason:string};
const shots:Shot[]=Array.isArray(report.screenshots)?report.screenshots.filter((x:Shot)=>x&&Number.isSafeInteger(x.session)&&x.session>0&&Number.isSafeInteger(x.state)&&x.state>=0&&Number.isFinite(x.elapsedMs)&&typeof x.file==="string"):[];
if(!shots.length)throw Error("No screenshots in this workflow report.");
const session=Number(option("session",String(Math.max(...shots.map(s=>s.session)))));
if(!Number.isSafeInteger(session)||session<1)throw Error("Invalid session");
const sessionName="session-"+String(session).padStart(4,"0");
const prefix="toddle-record-"+workflow+"-images/"+sessionName+"/";
const selected=shots.filter(s=>s.session===session).sort((a,b)=>a.elapsedMs-b.elapsedMs||a.file.localeCompare(b.file));
if(!selected.length)throw Error("No screenshots for session "+session);
for(const s of selected){
  if(!s.file.startsWith(prefix)||!/^shot-\d+-state-\d+\.jpg$/.test(s.file.slice(prefix.length)))throw Error("Unexpected screenshot path: "+s.file);
}
const out=resolve(root,"toddle-record-"+workflow+"-sheets",sessionName+"-"+per+"-per-sheet");
await mkdir(out,{recursive:true});
const esc=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const pages=Math.ceil(selected.length/per);
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:2240,height:1000},deviceScaleFactor:1});
  // Render local embedded images only; no authenticated profile or Toddle navigation.
  await page.route("**/*",r=>r.abort());
  for(let n=0;n<pages;n++){
    const batch=selected.slice(n*per,(n+1)*per);
    const cards=await Promise.all(batch.map(async(s,i)=>{
      const bytes=await readFile(resolve(root,s.file));
      const click=s.click===null?"-":Number.isInteger(s.click)?String(s.click+1):"-";
      const time=Math.floor(s.elapsedMs/1000);
      const caption=String(n*per+i+1).padStart(3,"0")+" | "+basename(s.file)+" | state "+s.state+" | click "+click+" | "+Math.floor(time/60)+":"+String(time%60).padStart(2,"0");
      return '<figure><figcaption>'+esc(caption)+'</figcaption><img src="data:image/jpeg;base64,'+bytes.toString("base64")+'"></figure>';
    }));
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src none; img-src data:; style-src \x27unsafe-inline\x27"><style>*{box-sizing:border-box}body{margin:0;background:#e9edf2;color:#152238;font:22px Arial,sans-serif;padding:20px}header{font-size:27px;font-weight:bold;margin:0 0 18px}.grid{display:grid;grid-template-columns:repeat('+Math.min(2,per)+',minmax(0,1fr));gap:16px}figure{margin:0;background:white;border:1px solid #b9c3d0;padding:8px;min-width:0}figcaption{font: bold 20px Arial,sans-serif;padding:8px 4px;overflow-wrap:anywhere}img{display:block;width:100%;height:auto}</style></head><body><header>'+esc(workflow.toUpperCase()+" | session "+session+" | sheet "+(n+1)+"/"+pages+" | screenshots "+(n*per+1)+"-"+(n*per+batch.length)+" of "+selected.length)+'</header><div class="grid">'+cards.join("")+'</div></body></html>',{waitUntil:"load"});
    const ok=await page.evaluate(()=>Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0));
    if(!ok)throw Error("An image could not be decoded.");
    const name=resolve(out,"sheet-"+String(n+1).padStart(3,"0")+".png");
    await page.screenshot({path:name,fullPage:true,animations:"disabled"});
    console.log("Created "+name);
  }
}finally{await browser.close();}
console.log("Done: "+selected.length+" screenshots, "+pages+" sheets. "+out);
console.log("Review and redact any personal information before sharing. Originals and JSON were not modified.");
