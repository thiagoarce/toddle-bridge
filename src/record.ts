import { chromium, type Page } from "playwright";
import { resolve } from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { atomicJson, digest, readCheckpoint } from "./explore-checkpoint.ts";
const origin="https://web.toddleapp.com";
const workflows=["planning","assignment","message","announcement","unit","materials","assessment","free"];
const arg=process.argv.indexOf("--workflow");
const workflow=arg<0?"free":process.argv[arg+1];
if(!workflows.includes(workflow))throw Error("Workflow: "+workflows.join(", "));
if(!process.argv.includes("--authorized-test-demo"))throw Error("Use --authorized-test-demo only in an authorized test environment with fictitious data.");
const screenshots=process.argv.includes("--screenshots");
const variantIndex=process.argv.indexOf("--variant");
const variant=variantIndex<0?"general":process.argv[variantIndex+1]??"";
if(!/^[a-z0-9][a-z0-9-]{0,39}$/.test(variant))throw Error("Use a generic variant slug (lowercase letters, numbers, hyphens; no personal names).");
const maxScreenshots=180;
const labels=["Home","Courses","My courses","Planning","Classroom","Unit planning","Unit planner","Weekly planners","Weekly planner","Daily planner","Lesson planning","Lesson plans","Learning experiences","Learning engagements","Learning experience","Learning engagement","Activities","Activity","Assignments","Assignment","Assignments manager","Assessment","Assessments","Class stream","Stream","Announcements","Class announcements","School announcements","School library","School policies and resources","Resources","Calendar","Class calendar","Continuum","Create","New","Add","Interdisciplinary unit","Subject specific unit","Import from MB Library","Unit","Unit plan","Lesson plan","Create unit","Create assignment","Create announcement","Create activity","Create lesson plan","Add lesson","Add unit","Add learning experience","Add learning engagement","Add attachment","Attach file","Upload","Title","Description","Instructions","Subject","Date","Due date","Start date","End date","Time","Save","Save draft","Publish","Send","Schedule","Scheduled","Draft","Drafts","Cancel","Close","Back","Next","Previous","Search","Filter","More options","List view","Grid view","Card view","Timeline view","Week view","Day view","Overview","Details","Curriculum","Learning goals","Learning objectives","Learning tasks","Tasks","Teaching and learning","All published","Edit","Messaging","Messages","Message","New message","Compose","New conversation","Recipients","Select recipients","Teachers","Students","Select class","Select classes","Add recipients","Type a message","Planejamento","Atividades","Criar","Salvar","Publicar","Cancelar","Editar","Voltar","Enviar","Mensagens"];
const routeWords=["platform","courses","course","class","classes","classroom","planning","planner","planners","weekly","weeklyplanner","weeklyplanners","weekly-planners","unit","units","unitplans","unit-plans","lesson","lessons","lessonplans","lesson-plans","learningexperiences","learningengagements","learning-experiences","learning-engagements","activities","assignments","assignment","assignments-manager","announcements","school-announcements","school-library","resources","calendar","curriculum","overview","stream","cardview","listview","gridview","timelineview","create","new","edit","view","drafts","scheduled","assessment","assessments","continuum","import","messages","messaging","conversation","conversations"];
const names=new Set(labels),words=new Set(routeWords);
const components=new Set(["ClassCardV2__container","ButtonCard__container","TeacherCoursesV2__container","GlobalMenuTray__iconContainer","GlobalMenuTray__messagingIconContainer"]);
const roles=new Set(["button","link","tab","menuitem","textbox","combobox","checkbox","radio","switch","listbox","option","heading","dialog","navigation","main","form","searchbox","spinbutton","grid","table","toolbar","menu","tabpanel","unknown","input"]);
const tags=new Set(["button","a","input","textarea","select","summary","h1","h2","h3","h4","form","nav","main","dialog","table","div","span","section","label","li","other"]);
const types=new Set(["text","search","email","date","datetime-local","time","number","checkbox","radio","file","submit","button","reset","url","tel","range","color","month","week"]);
const shape=(path:string)=>"/"+path.split("/").filter(Boolean).slice(0,30).map(s=>words.has(s.toLowerCase())?s.toLowerCase():":segment").join("/");
const platform=(path:string)=>path.match(/^\/platform\/([0-9]+)(?:\/|$)/)?.[1]??null;
const excluded=/\/(?:students?|studentprofiles?|grades|gradebook|reports|progress-?reports|behaviour|behavior|parents?)(?:\/|$)/i;
const allowed=(path:unknown,scope:string):path is string=>typeof path==="string"&&path.length<=3000&&platform(path)===scope&&!excluded.test(path);
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const pick=(set:Set<string>,v:unknown)=>typeof v==="string"&&set.has(v)?v:null;
const int=(v:unknown,max=4000)=>typeof v==="number"&&Number.isInteger(v)&&v>=0&&v<=max?v:0;
function structure(value:unknown){
  const v=obj(value);
  if(!Array.isArray(v.controls))return null;
  return {scanned:int(v.scanned),truncated:v.truncated===true,controls:v.controls.slice(0,250).map(entry=>{
    const e=obj(entry),c=obj(e.control);
    return {control:{tag:pick(tags,c.tag)??"other",role:pick(roles,c.role)??"unknown",type:pick(types,c.type),name:pick(names,c.name),component:pick(components,c.component),required:c.required===true,disabled:c.disabled===true,editable:c.editable===true,destination:typeof c.destination==="string"?shape(c.destination):null},count:int(e.count)};
  }).filter(e=>e.count>0)};
}
function action(value:unknown){
  const v=obj(value);
  if(!Array.isArray(v.box)||v.box.length!==4||!v.box.every(n=>typeof n==="number"&&Number.isFinite(n)&&Math.abs(n)<=100000))return null;
  return {label:pick(names,v.label),tag:pick(tags,v.tag)??"other",role:pick(roles,v.role)??"unknown",component:pick(components,v.component),ordinal:typeof v.ordinal==="number"&&Number.isInteger(v.ordinal)&&v.ordinal>=0&&v.ordinal<=4000?v.ordinal:null,region:pick(new Set(["menu","dialog","navigation","body"]),v.region)??"body",box:v.box.map(n=>Math.round(Number(n)))};
}
type Structure=NonNullable<ReturnType<typeof structure>>;
type Action=NonNullable<ReturnType<typeof action>>;
type State={id:number;fingerprint:string;route:string;structure:Structure};
type Click={session:number;page:number;from:number;to:number|null;action:Action;status:string;elapsedMs:number};
type Screenshot={session:number;page:number;state:number;click:number|null;elapsedMs:number;file:string;reason:"stable-state"|"after-click"};
type Report={screenshots?:Screenshot[];sessionVariants?:{session:number;variant:string;visual:boolean}[];version:1;mode:"manual-navigation-recorder";workflow:string;scope:string;sessions:number;states:State[];clicks:Click[];observations:{session:number;page:number;from:number;to:number;elapsedMs:number}[]};
const dir=resolve(".local","reports");
const file=resolve(dir,"toddle-record-"+workflow+".json");
await mkdir(dir,{recursive:true});
const capture=(await readFile(new URL("./capture-dom.js",import.meta.url),"utf8")).trim();
const listener=(await readFile(new URL("./record-clicks.js",import.meta.url),"utf8")).trim();
const config=JSON.stringify({labels,routeWords});
const initScript="("+listener+")({..."+config+",capture:"+capture+"})";
const expression="(()=>{const d=("+capture+")({approvedOrigin:"+JSON.stringify(origin)+",..."+config+"});if(!d)return null;const {controls,scanned,truncated}=d;return {path:location.pathname,structure:{controls,scanned,truncated}};})()";
const context=await chromium.launchPersistentContext(resolve(".local","browser-profile"),{headless:false,acceptDownloads:false});
const terminal=createInterface({input:process.stdin,output:process.stdout});
let stop=false,scope="",dirty=false;
let report:Report|undefined;
const started=Date.now(),elapsed=()=>Date.now()-started;
const seen=new Map<string,number>(),pages=new Map<Page,number>(),last=new Map<Page,number>();
const pending=new Map<Page,{index:number;at:number}>();
const stable=new Map<Page,{id:number;since:number}>();
const photographed=new Set<string>();
const lastFinishedClick=new Map<Page,number>();
let shotCount=0,shotFailures=0;
const buffer:{page:Page;path:string;structure:Structure;action:Action;at:number}[]=[];
const stopNow=()=>{stop=true;};
process.on("SIGINT",stopNow);context.on("close",stopNow);
function pageId(page:Page){if(!pages.has(page))pages.set(page,pages.size+1);return pages.get(page)!;}
function state(path:string,data:Structure){
  const fingerprint=digest(path+"|"+JSON.stringify(data)),old=seen.get(fingerprint);
  if(old!==undefined)return old;
  const id=report!.states.length;
  report!.states.push({id,fingerprint,route:shape(path),structure:data});seen.set(fingerprint,id);dirty=true;
  console.log("State "+(id+1)+": "+shape(path));return id;
}
function finish(page:Page,id:number|null,status:string){
  const p=pending.get(page);if(!p)return;
  const c=report!.clicks[p.index];c.to=id;c.status=status;pending.delete(page);lastFinishedClick.set(page,p.index);dirty=true;
}
function ingest(){
  while(buffer.length){
    const e=buffer.shift()!;
    if(!allowed(e.path,scope))continue;
    const id=state(e.path,e.structure);
    if(pending.has(e.page))finish(e.page,id,"next-click");
    last.set(e.page,id);
    const index=report!.clicks.length;
    report!.clicks.push({session:report!.sessions,page:pageId(e.page),from:id,to:null,action:e.action,status:"pending",elapsedMs:e.at});
    pending.set(e.page,{index,at:e.at});dirty=true;
    console.log("Click "+(index+1)+": "+(e.action.label??e.action.component??e.action.role));
  }
}
async function persist(){if(report&&dirty){await atomicJson(file,report);dirty=false;}}
async function photograph(page:Page,id:number,click:number|null,reason:Screenshot["reason"]){
  if(!screenshots||stop||!report||shotCount>=maxScreenshots||page.isClosed())return;
  const key=pageId(page)+"|"+id+"|"+(click??"state");
  if(photographed.has(key))return;
  try{
    const u=new URL(page.url());if(u.origin!==origin||!allowed(u.pathname,scope))return;
    // Only the browser viewport, never the OS desktop or login page. The operator
    // must use a demo with fictitious data; screenshots are NOT automatically redacted.
    const bytes=await page.screenshot({type:"jpeg",quality:78,fullPage:false,timeout:3000});
    if(stop||page.isClosed())return;
    const now=new URL(page.url());if(now.origin!==origin||now.pathname!==u.pathname||!allowed(now.pathname,scope))return;
    const v=obj(await page.evaluate(expression)),data=structure(v.structure);
    if(!data||v.path!==u.pathname||digest(u.pathname+"|"+JSON.stringify(data))!==report.states[id]?.fingerprint)return;
    const folder="toddle-record-"+workflow+"-images/session-"+String(report.sessions).padStart(4,"0");
    const relative=folder+"/shot-"+String(shotCount+1).padStart(4,"0")+"-state-"+id+".jpg";
    await mkdir(resolve(dir,folder),{recursive:true});
    await writeFile(resolve(dir,relative),bytes,{mode:0o600});
    (report.screenshots??=[]).push({session:report.sessions,page:pageId(page),state:id,click,elapsedMs:elapsed(),file:relative,reason});
    photographed.add(key);shotCount++;dirty=true;
    console.log("Screenshot "+shotCount+"/"+maxScreenshots+": state "+id+(click===null?"":" after click "+(click+1)));
    if(shotCount===maxScreenshots)console.log("Screenshot session limit reached; structural recording continues.");
  }catch{shotFailures++;if(shotFailures<=3)console.log("Screenshot skipped; structural recording continues.");}
}
try{
  await context.exposeBinding("__toddleRecordClick",(source,value:unknown)=>{
    if(stop||!report||source.frame!==source.page.mainFrame())return;
    const v=obj(value),a=action(v.action),data=structure(v.structure);
    if(a&&data&&allowed(v.path,scope)&&buffer.length<1000)buffer.push({page:source.page,path:v.path,structure:data,action:a,at:elapsed()});
  });
  await context.addInitScript(initScript);
  const page=context.pages().find(p=>{try{return new URL(p.url()).origin===origin;}catch{return false;}})??context.pages().find(p=>p.url()==="about:blank")??await context.newPage();
  if(!page.url().startsWith(origin+"/")){
    const saved=(await readFile(resolve(".local","explore-start.txt"),"utf8").catch(()=>"")).trim();
    let start=origin+"/";
    try{const u=new URL(saved);if(u.origin===origin&&/^\/platform\/[0-9]+\/courses\/?$/.test(u.pathname)&&!u.search&&!u.hash)start=u.href;}catch{}
    await page.goto(start,{waitUntil:"domcontentloaded",timeout:30000});
  }
  await page.waitForURL(u=>u.origin===origin&&!!platform(u.pathname),{timeout:180000});
  scope=platform(new URL(page.url()).pathname)!;
  const old=await readCheckpoint(file).catch(e=>{if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e;}) as Report|null;
  if(old&&(old.version!==1||old.workflow!==workflow||old.scope!==digest(scope)||!Array.isArray(old.states)||!Array.isArray(old.clicks)||!Array.isArray(old.observations)))throw Error("Incompatible recording; preserve the existing file before starting another scope.");
  report=old??{version:1,mode:"manual-navigation-recorder",workflow,scope:digest(scope),sessions:0,states:[],clicks:[],observations:[]};
  for(const s of report.states)seen.set(s.fingerprint,s.id);
  for(const c of report.clicks)if(c.status==="pending")c.status="interrupted";
  report.sessions++;(report.sessionVariants??=[]).push({session:report.sessions,variant,visual:screenshots});dirty=true;
  // Install in existing documents as well as future ones.
  for(const p of context.pages())await p.evaluate(initScript).catch(()=>{});
  await persist();
  const steps:Record<string,string[]>={
    planning:["Open a representative class","Open Planning > Weekly planners","Choose a week and open a lesson or planning editor","Inspect date, title, subject, instructions and attachment controls","If authorized, use fictitious content in the demo; otherwise stop before saving"],
    assignment:["Open a class and its assignment or activity area","Open the creation interface","Inspect title, instructions, class, due date and attachment controls","Inspect draft and publication options; use only fictitious content"],
    message:["Open Messaging in the demo","Open a new message or conversation","Select a fictitious test recipient","Inspect subject, composer, attachment and Send controls","Send only a fictitious message to the authorized test recipient"],
    announcement:["Open Announcements","Open Create announcement","Inspect title, body, audience and scheduling options","Use fictitious content; publish only in the authorized demo"],
    unit:["Open Planning > Unit planning","Open a fictitious or authorized demo unit","Inspect its tabs, learning experiences and assessment structure"],
    materials:["Open a demo planning or activity editor","Locate Add attachment or resource picker","Use only a fictitious test file if uploading"],
    assessment:["Open a demo class assignment or assessment editor","Inspect assessment type, criteria and due date","Use fictitious data only; do not enter real grades"],
    free:["Navigate normally within the authorized demo"]
  };
  console.log("RECORDING: "+workflow+"; operate the authorized demo normally. Press Enter in terminal to finish.");
  steps[workflow].forEach((step,i)=>console.log("  "+(i+1)+". "+step));
  console.log("No automated clicks, typed text logging or network interception.");
  if(screenshots)console.log("VISUAL MODE: local viewport screenshots may contain all visible data. Use only fictitious demo data; review/redact images before sharing. Variant: "+variant+".");
  else console.log("Screenshots disabled. Add --screenshots to enable visual recording in the authorized fictitious demo.");
  void terminal.question("").then(stopNow,stopNow);
  while(!stop&&context.pages().some(p=>!p.isClosed())){
    ingest();
    for(const p of context.pages()){
      if(p.isClosed())continue;
      try{
        const u=new URL(p.url());if(u.origin!==origin||!allowed(u.pathname,scope))continue;
        const v=obj(await p.evaluate(expression)),data=structure(v.structure);
        if(!data||!allowed(v.path,scope))continue;
        const id=state(v.path,data),prior=last.get(p),event=pending.get(p);
        if(prior!==undefined&&prior!==id){
          report.observations.push({session:report.sessions,page:pageId(p),from:prior,to:id,elapsedMs:elapsed()});dirty=true;
        }
        last.set(p,id);
        if(event&&elapsed()-event.at>=1800)finish(p,id,report.clicks[event.index].from===id?"no-observed-change":"changed");
        if(screenshots){
          const previous=stable.get(p);
          if(previous?.id!==id)stable.set(p,{id,since:elapsed()});
          else if(elapsed()-previous.since>=450){
            const index=lastFinishedClick.get(p);
            const c=index===undefined?undefined:report.clicks[index];
            const related=c?.to===id&&c.session===report.sessions&&!pending.has(p)?index!:null;
            if(index!==undefined&&c?.to!==id)lastFinishedClick.delete(p);
            if(related!==null){
              await photograph(p,id,related,"after-click");
              // An after-click image also documents the stable state.
              if(photographed.has(pageId(p)+"|"+id+"|"+related)){photographed.add(pageId(p)+"|"+id+"|state");lastFinishedClick.delete(p);}
            }else if(!pending.has(p))await photograph(p,id,null,"stable-state");
          }
        }
      }catch{/* A navigation can replace the execution context; poll again. */}
    }
    await persist();
    await new Promise(r=>setTimeout(r,400));
  }
}finally{
  if(report){ingest();for(const p of pending.keys())finish(p,last.get(p)??null,"interrupted");await persist();console.log("Saved "+report.states.length+" states and "+report.clicks.length+" clicks: "+file);if(screenshots)console.log("Saved "+shotCount+" local screenshots this session; review before sharing.");}
  terminal.close();process.off("SIGINT",stopNow);await context.close().catch(()=>{});
}
