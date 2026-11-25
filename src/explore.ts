import { chromium, type Page, type Locator } from "playwright";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { inPlatform } from "./explore-policy.ts";
import { atomicJson, digest, isDigest, readCheckpoint } from "./explore-checkpoint.ts";

const origin = "https://web.toddleapp.com";
const homeCards = ["Assignments manager","School announcements","School policies and resources","School library"];
const tabs = ["Planning","Planner","Unit planner","Unit planning","Lesson planner","Lesson planning","Lesson plans","Learning experiences","Learning engagements","Activities","Assignments","Assignments manager","Class stream","Stream","Announcements","School announcements","Calendar","Resources","Overview","Units","Lessons","Curriculum","Classroom","Class timetable","Timetable","Weekly planner","Daily planner","Yearly planner","Learning plan","Learning goals","Class resources","Course resources","My planning","All assignments","Upcoming","Past","Drafts","Published","Scheduled","List view","Calendar view","Week view","Day view","Unit plans","Unit planning","Lesson plans","Learning experiences","Learning engagement","Learning experience","Assessment","Assessments","Class calendar","Class announcements","Class activities","Tasks","Learning tasks","Class journal","Journal","Curriculum overview","Scope and sequence","Weekly planning","Daily planning","Teaching and learning","Learning resources","Published assignments","Scheduled assignments","Draft assignments"];
const labels = [...homeCards,...tabs,"Create activity","Create lesson plan","Home","Courses","My courses","Create","Add","Edit","Save","Publish","Send","Students","Messaging","Create announcement","Create assignment","Add attachment","Title","Description","Instructions","Due date","Start date","End date","Date","Time","More options","Cancel","Close","Search","Filter","Draft","New","Schedule"];
const routeWords = ["platform","course","courses","class","classes","classroom","planning","planner","unit","units","lesson","lessons","activities","assignments","announcements","calendar","resources","overview","stream","curriculum","assignment-manager","assignments-manager","school-announcements","school-library","learning-experiences"];
const cardSelector = '[role="button"][class*="ClassCardV2__container___"]';
const featureSelector = '[role="button"][class*="ButtonCard__container___"]';
type Action = { kind:"submenu"; label:"Weekly planners" } | { kind:"class"; index:number } | {kind:"feature"|"tab"|"calendar"|"navigation"|"editor"; label:string} | {kind:"visual";label:string;region:string;opener:boolean;interaction?:"hover"};
type VisualCandidate={index:number;label:string;region:string;opener:boolean;x:number;y:number;width:number;height:number};
const visualSelector="button,a[href],[role=button],[role=link],[role=tab],[role=menuitem],summary,input[type=radio],nav li,nav div,nav span,[role=menu] div,[role=menu] span,[role=dialog] div,[role=dialog] span";
const editorOpeners=["Create assignment","Create announcement","Create lesson plan","Create activity"];
type Snapshot = {route:string; scanned:number; truncated:boolean; controls:unknown[];visualControls?:Omit<VisualCandidate,"index">[];};
type Capture = {scanned:number;truncated:boolean;controls:unknown[];candidates:unknown[]}|null;
function readLimit(name:string,fallback:number,max:number){
  const flag="--"+name;
  const index=process.argv.indexOf(flag);
  if(index===-1)return fallback;
  const raw=process.argv[index+1]??"";
  const value=Number(raw);
  if(!/^\d+$/.test(raw)||!Number.isSafeInteger(value)||value<1||value>max)throw Error(flag+" must be an integer between 1 and "+max);
  return value;
}
const maxNewStates=readLimit("max-new-states",250,1000);
const maxDepth=readLimit("max-depth",10,20);
const maxAttempts=readLimit("max-attempts",400,1500);
const report = {version:14,mode:"supervised-demo-explorer",snapshots:[] as Snapshot[],edges:[] as {from:number;to:number;action:string}[],diagnostics:[] as {action:string;reason:string}[],network:{interception:false,observed:0,requestKinds:{} as Record<string,number>,httpErrors:{} as Record<string,number>,failedKinds:{} as Record<string,number>},startup:{stage:"not-started",ui:"unknown",pageErrors:{} as Record<string,number>},limits:{states:maxNewStates,depth:maxDepth,attempts:maxAttempts},exploration:{strategy:"priority-breadth-first-rendered-text",equivalentClassLayouts:0,visualCandidates:0,duplicates:0,queued:0,attempts:0,resumed:false,previousAttempts:0,knownActionsSkipped:0,retriesQueued:0,retriesExhausted:0,incompleteClassRepairs:0,menuRepairs:0,unresolvedMenus:0,noChangeActions:0}};
const dir=resolve(".local","reports"); await mkdir(dir,{recursive:true});
const output=resolve(dir,"toddle-map-explore.json");
const checkpointFile=resolve(dir,"toddle-explore-checkpoint.json");
const fresh=process.argv.includes("--fresh");
const requireResume=process.argv.includes("--resume");
const teachWeekly=process.argv.includes("--teach-weekly");
let taughtWeeklyThisRun=false;
const weeklyRoutesFile=resolve(".local","weekly-routes.json");
let resumed=false;
if(fresh&&requireResume)throw Error("Use either --fresh or --resume, not both");
const allClasses=process.argv.includes("--all-classes");
let reportStarted=false;
const source=await readFile(new URL("./capture-dom.js",import.meta.url),"utf8");
const visualSource=await readFile(new URL("./visual-discovery.js",import.meta.url),"utf8");
async function visualCandidates(page:Page):Promise<VisualCandidate[]>{
  if(!inPlatform(page.url(),origin,platformId))return [];
  const expr=visualSource+"("+JSON.stringify({selector:visualSelector,knownLabels:[...tabs,...homeCards,...editorOpeners,"Create","New","Add","Create unit","Create lesson","Add unit","Add lesson","New unit","New lesson"]})+")";
  return await page.evaluate(expr) as VisualCandidate[];
}
const persist=()=>reportStarted?atomicJson(output,report):Promise.resolve();
const shape=(url:string)=>"/"+new URL(url).pathname.split("/").filter(Boolean).slice(0,30).map(x=>routeWords.includes(x.toLowerCase())?x.toLowerCase():":segment").join("/");
const actionName=(a:Action)=>a.kind==="class"?"Class card "+(a.index+1):a.kind==="visual"&&a.interaction==="hover"?"Hover "+a.label:a.label;
const seen=new Map<string,number>();
const stateUrls=new Map<number,string>();
const stateDialogs=new Map<number,boolean>();
const stateKeys=new Map<number,string>();
type Pending={path:Action[];id:number;actions:Action[]};
const queue:Pending[]=[];
const expanded=new Set<number>();
type Retry={id:number;path:Action[];action:Action;failures:number;reason:string};
const retryLedger=new Map<string,Retry>();
const actionKey=(id:number,a:Action)=>id+"|"+actionName(a);
const completed=new Set<string>();
const retryable=(reason:string)=>/^(?:weekly-planning-trigger-missing|weekly-flyout-entry-not-found|weekly-flyout-interaction-failed|no-visible-change|class-content-not-ready|control-not-ready|navigation-overlay|navigation-unstable|navigation-hidden|navigation-detached|native-click-timeout|native-click-error|capture-unavailable|restored-state-changed|navigation-or-capture-(?:network|timeout|other))$/.test(reason);
const sampledClassLayouts=new Set<string>();
let attempts=0;
let platformId="";
let home="";
let halted=false;
let currentPath: string|null=null;
let failureReason="unknown";
const pathKey=(path:Action[])=>JSON.stringify(path);
function validAction(a:unknown):a is Action{
  if(!a||typeof a!=="object")return false;
  const v=a as Record<string,unknown>;
  if(v.kind==="class")return Number.isInteger(v.index)&&Number(v.index)>=0&&Number(v.index)<12;
  if(typeof v.label!=="string"||!/^[a-zA-Z ]{1,64}$/.test(v.label))return false;
  if(v.kind==="visual")return ["body","navigation","dialog","menu"].includes(String(v.region))&&typeof v.opener==="boolean"&&(v.interaction===undefined||v.interaction==="hover");
  if(v.kind==="submenu")return v.label==="Weekly planners";
  if(v.kind==="feature")return homeCards.includes(v.label);
  if(v.kind==="calendar")return v.label==="Calendar";
  if(v.kind==="editor")return editorOpeners.includes(v.label);
  return (v.kind==="tab"||v.kind==="navigation")&&tabs.includes(v.label);
}
async function saveCheckpoint(){
  if(!reportStarted)return;
  report.exploration.queued=queue.length;
  await atomicJson(checkpointFile,{schema:1,scope:digest(home),allClasses,report,seen:[...seen],dialogs:[...stateDialogs],expanded:[...expanded],classLayouts:[...sampledClassLayouts],queue,retries:[...retryLedger.values()]});
  await persist();
}
function hasClassContent(snapshot:Snapshot|undefined):boolean{
  if(!snapshot)return false;
  const relevant=/^(?:planning|planner|classroom|curriculum|create|unit(?:s| planner| planning| plans)?|lessons?|learning (?:experiences|engagements|goals)|activities|assignments|class stream|stream|class journal|journal|assessments?|resources|timeline view)$/i;
  return (snapshot.visualControls??[]).some(v=>relevant.test(v.label))||
    (snapshot.controls as {control:{name:string|null}}[]).some(c=>typeof c.control.name==="string"&&relevant.test(c.control.name));
}
async function loadCheckpoint(){
  const c=await readCheckpoint(checkpointFile) as {
    schema:number;scope:string;allClasses:boolean;report:typeof report;seen:[string,number][];dialogs:[number,boolean][];expanded:number[];classLayouts:string[];queue:Pending[];retries?:Retry[];
  };
  if(!c||c.schema!==1||c.scope!==digest(home)||c.allClasses!==allClasses||![8,9,10,11,12,13,14].includes(c.report?.version))throw Error("Checkpoint incompatible with this platform, version or class mode");
  const snapshots=c.report.snapshots;
  if(!Array.isArray(snapshots)||!snapshots.length||snapshots.length>10000||!Array.isArray(c.report.edges)||!Array.isArray(c.report.diagnostics))throw Error("Invalid checkpoint report");
  const validId=(id:unknown)=>Number.isInteger(id)&&Number(id)>=0&&Number(id)<snapshots.length;
  if(!Array.isArray(c.seen)||c.seen.length!==snapshots.length||!c.seen.every(e=>Array.isArray(e)&&isDigest(e[0])&&validId(e[1]))||
    !Array.isArray(c.dialogs)||!c.dialogs.every(e=>Array.isArray(e)&&validId(e[0])&&typeof e[1]==="boolean")||
    !Array.isArray(c.expanded)||!c.expanded.every(validId)||!Array.isArray(c.classLayouts)||!c.classLayouts.every(v=>typeof v==="string")||
    !Array.isArray(c.queue)||!c.queue.every(j=>j&&validId(j.id)&&Array.isArray(j.path)&&j.path.length<=report.limits.depth&&j.path.every(validAction)&&Array.isArray(j.actions)&&j.actions.every(validAction)))throw Error("Invalid checkpoint traversal");
  if(c.retries!==undefined&&(!Array.isArray(c.retries)||!c.retries.every(v=>v&&validId(v.id)&&Array.isArray(v.path)&&v.path.length<=report.limits.depth&&v.path.every(validAction)&&validAction(v.action)&&Number.isInteger(v.failures)&&v.failures>=1&&v.failures<=3&&typeof v.reason==="string")))throw Error("Invalid checkpoint retries");
  report.snapshots=c.report.snapshots;
  report.edges=c.report.edges;
  report.diagnostics=c.report.diagnostics;
  report.exploration={...report.exploration,...c.report.exploration,resumed:true,previousAttempts:(c.report.exploration.previousAttempts??0)+c.report.exploration.attempts,attempts:0,queued:c.queue.length,retriesQueued:0,retriesExhausted:0};
  // Network counters describe this execution only; map and progress are cumulative.
  report.limits.states=snapshots.length+maxNewStates;
  for(const [key,id] of c.seen){seen.set(key,id);stateKeys.set(id,key);}
  for(const [id,dialog] of c.dialogs)stateDialogs.set(id,dialog);
  for(const id of c.expanded)expanded.add(id);
  for(const layout of c.classLayouts)sampledClassLayouts.add(layout);
  queue.push(...c.queue);
  for(const e of report.edges){if(e.from===e.to&&/^(?:(?:Hover )?(?:Planning|Classroom)|Weekly planners)$/.test(e.action)&&c.report.version>=11)continue;completed.add(e.from+"|"+e.action);}
  for(const entry of c.retries??[])retryLedger.set(actionKey(entry.id,entry.action),entry);
  // Older versions could mark a loading shell as a completed class visit.
  const classEdges=report.edges.filter(e=>/^Class card [1-9][0-9]*$/.test(e.action));
  const repairJobs:Pending[]=[];
  for(const e of classEdges){
    const key=e.from+"|"+e.action;
    if(classEdges.some(other=>other.from===e.from&&other.action===e.action&&hasClassContent(snapshots[other.to])))continue;
    const action:Action={kind:"class",index:Number(e.action.split(" ").at(-1))-1};
    if(!validAction(action)||snapshots[e.from]?.route!=="/platform/:segment/courses")continue;
    completed.delete(key);
    if((retryLedger.get(key)?.failures??0)>=3)continue;
    if(queue.some(j=>j.id===e.from&&j.actions.some(a=>actionKey(j.id,a)===key))||repairJobs.some(j=>j.id===e.from&&j.actions.some(a=>actionKey(j.id,a)===key)))continue;
    repairJobs.push({id:e.from,path:[],actions:[action]});
    report.exploration.incompleteClassRepairs=(report.exploration.incompleteClassRepairs??0)+1;
  }
  queue.unshift(...repairJobs);
  // Revisit previously captured but unrecognized creation menus once on upgrade.
  if(c.report.version<13){
    for(const e of report.edges){
      if(e.action!=="Create")continue;
      const dest=snapshots[e.to];
      const unknownMenu=(dest?.controls as {control:{role:string};count:number}[]|undefined)?.some(v=>v.control.role==="menuitem"&&v.count>0)&&!(dest.visualControls??[]).some(v=>v.region==="menu");
      if(!unknownMenu)continue;
      const parent=classEdges.find(v=>v.to===e.from);
      if(!parent||!/^Class card [1-9][0-9]*$/.test(parent.action))continue;
      const path:Action[]=[{kind:"class",index:Number(parent.action.split(" ").at(-1))-1}];
      const action:Action={kind:"visual",label:"Create",region:"body",opener:true};
      if(!path.every(validAction))continue;
      const key=actionKey(e.from,action);
      completed.delete(key);expanded.delete(e.to);
      if(!queue.some(j=>j.id===e.from&&j.actions.some(a=>actionKey(j.id,a)===key))){queue.unshift({id:e.from,path,actions:[action]});report.exploration.menuRepairs++;}
    }
    // A click/hover on a selected tab need not change the screen; keep its history,
    // but retry these navigation controls once after the discovery upgrade.
    for(const e of report.edges){
      if(e.from!==e.to||! /^(?:Hover )?(?:Planning|Classroom)$/.test(e.action))continue;
      const parent=classEdges.find(v=>v.to===e.from);
      if(!parent)continue;
      const path:Action[]=[{kind:"class",index:Number(parent.action.split(" ").at(-1))-1}];
      const action:Action={kind:"visual",label:e.action.replace(/^Hover /,""),region:"navigation",opener:false,...(e.action.startsWith("Hover ")?{interaction:"hover" as const}:{})};
      if(!path.every(validAction))continue;
      const key=actionKey(e.from,action);completed.delete(key);
      if(!queue.some(j=>j.id===e.from&&j.actions.some(a=>actionKey(j.id,a)===key)))queue.push({id:e.from,path,actions:[action]});
    }
  }
  // The actual Planning flyout uses a nested Weekly planners entry.
  // Revisit one loaded representative class on upgrade, not every equivalent class.
  if(c.report.version<14||teachWeekly){
    const edge=classEdges.find(e=>hasClassContent(snapshots[e.to])&&(snapshots[e.to].visualControls??[]).some(v=>v.label==="Planning"));
    if(edge){
      const path:Action[]=[{kind:"class",index:Number(edge.action.split(" ").at(-1))-1}];
      const action:Action={kind:"submenu",label:"Weekly planners"};
      const key=actionKey(edge.to,action);
      if(path.every(validAction)&&(!completed.has(key)||teachWeekly)){
        if(teachWeekly)completed.delete(key);
        retryLedger.delete(key);
        if(!queue.some(j=>j.id===edge.to&&j.actions.some(a=>actionKey(j.id,a)===key)))queue.unshift({id:edge.to,path,actions:[action]});
      }
    }
  }
  // Retry transient failures at most twice, in later sessions, not repeatedly in this session.
  const scheduled=new Set(queue.flatMap(j=>j.actions.map(a=>actionKey(j.id,a))));
  for(const [key,v] of retryLedger){
    if(completed.has(key)){retryLedger.delete(key);continue;}
    if(v.failures>=3||!retryable(v.reason)){report.exploration.retriesExhausted++;continue;}
    if(!scheduled.has(key)){queue.push({id:v.id,path:v.path,actions:[v.action]});scheduled.add(key);report.exploration.retriesQueued++;}
  }
  resumed=true;
  console.log("Memory loaded: "+snapshots.length+" saved states, "+queue.length+" pending paths, "+completed.size+" known actions.");
}
async function archivePrevious(){
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  for(const [file,name] of [[output,"map"],[checkpointFile,"checkpoint"]]){
    try{await atomicJson(resolve(dir,"toddle-"+name+"-"+stamp+".json"),await readCheckpoint(file));}
    catch(err){if((err as NodeJS.ErrnoException).code!=="ENOENT")throw err;}
  }
}
async function waitForHome(page:Page){
  await page.locator(cardSelector+", "+featureSelector).first().waitFor({state:"visible",timeout:25000});
}
async function waitForControl(page:Page,a:Action){
  for(let i=0;i<24;i++){
    if(!inPlatform(page.url(),origin,platformId))return null;
    const loc=await find(page,a);
    if(loc && await loc.isVisible() && await loc.isEnabled())return loc;
    await page.waitForTimeout(500);
  }
  return null;
}

function hostGroup(raw:string){
  try{
    const h=new URL(raw).hostname;
    if(h==="web.toddleapp.com")return "toddle-web";
    if(h==="toddleapp.com"||h.endsWith(".toddleapp.com"))return "toddle-service";
    if(["fonts.googleapis.com","fonts.gstatic.com","use.typekit.net","p.typekit.net"].includes(h))return "font-provider";
  }catch{}
  return "external";
}
function bump(target:Record<string,number>,key:string){target[key]=(target[key]??0)+1;}
function errorKind(message:string){
  if(/timeout/i.test(message))return "timeout";
  if(/blocked.by.client/i.test(message))return "blocked-by-client";
  if(/network|fetch|ERR_/i.test(message))return "network";
  if(/referenceerror|is not defined/i.test(message))return "reference-error";
  if(/typeerror/i.test(message))return "type-error";
  if(/syntaxerror/i.test(message))return "syntax-error";
  return "other";
}
async function find(page:Page,a:Action):Promise<Locator|null>{
  if(a.kind==="submenu"){
    const byRole=page.getByRole("menuitem",{name:/^Weekly planners(?:\s+W)?$/i})
      .or(page.getByRole("link",{name:/^Weekly planners(?:\s+W)?$/i}))
      .or(page.getByRole("button",{name:/^Weekly planners(?:\s+W)?$/i})).filter({visible:true});
    if(await byRole.count()===1)return byRole;
    const exact=page.getByText(a.label,{exact:true}).filter({visible:true});
    if(await exact.count()===1)return exact;
    const withShortcut=page.getByText(/^Weekly planners\s+W$/i).filter({visible:true});
    return await withShortcut.count()===1?withShortcut:null;
  }
  if(a.kind==="visual"){
    const matches=(await visualCandidates(page)).filter(v=>v.label.toLowerCase()===a.label.toLowerCase()&&v.region===a.region);
    return matches.length===1?page.locator(visualSelector).nth(matches[0].index):null;
  }
  if(a.kind==="class"){
    if(new URL(page.url()).pathname!==new URL(home).pathname)return null;
    return page.locator(cardSelector).nth(a.index);
  }
  if(a.kind==="feature"){
    if(new URL(page.url()).pathname!==new URL(home).pathname)return null;
    const cards=page.locator(featureSelector);
    const exact=cards.filter({has:page.getByText(a.label,{exact:true})});
    if(await exact.count()===1)return exact;
    const byRole=page.getByRole("button",{name:a.label,exact:true}).and(cards);
    return await byRole.count()===1?byRole:null;
  }
  if(a.kind==="calendar"){
    const loc=page.getByRole("button",{name:"Calendar",exact:true});
    return await loc.count()===1?loc:null;
  }
  if(a.kind==="tab"){
    const loc=page.getByRole("tab",{name:a.label,exact:true});
    return await loc.count()===1?loc:null;
  }
  if(a.kind==="editor"){
    const loc=page.getByRole("button",{name:a.label,exact:true});
    return await loc.count()===1?loc:null;
  }
  // Many Toddle navigation controls are buttons, links or menuitems rather than ARIA tabs.
  const loc=page.getByRole("button",{name:a.label,exact:true})
    .or(page.getByRole("link",{name:a.label,exact:true}))
    .or(page.getByRole("menuitem",{name:a.label,exact:true}));
  return await loc.count()===1?loc:null;
}

function coursePrefix(raw:string):string|null{
  try{
    const u=new URL(raw);
    if(!inPlatform(raw,origin,platformId))return null;
    return u.pathname.match(/^\/platform\/[0-9]+\/courses\/[A-Za-z0-9_-]+(?=\/|$)/)?.[0]??null;
  }catch{return null;}
}
function weeklyTarget(raw:string,base:string,start:string):boolean{
  try{
    const u=new URL(raw);
    return inPlatform(raw,origin,platformId)&&coursePrefix(raw)===base&&u.pathname!==new URL(start).pathname&&!u.search&&!u.hash;
  }catch{return false;}
}
async function knownWeeklyRoutes():Promise<Record<string,string>>{
  try{
    const obj=await readCheckpoint(weeklyRoutesFile);
    if(obj&&typeof obj==="object"&&!Array.isArray(obj))return obj as Record<string,string>;
  }catch{}
  return {};
}
async function openWeekly(page:Page,a:Extract<Action,{kind:"submenu"}>){
  const start=page.url(),base=coursePrefix(start);
  if(!base){failureReason="weekly-no-course";return false;}
  const routes=await knownWeeklyRoutes();
  const key=digest(base);
  const learned=routes[key];
  const accept=()=>weeklyTarget(page.url(),base,start);
  async function finish(){
    for(let i=0;i<30&&!page.isClosed();i++){
      if(accept()){await page.waitForTimeout(1200);return accept();}
      if(!inPlatform(page.url(),origin,platformId)){failureReason="destination-outside-approved-scope";return false;}
      await page.waitForTimeout(300);
    }
    failureReason="no-visible-change";return false;
  }
  const manual=teachWeekly&&!taughtWeeklyThisRun;
  if(!manual&&typeof learned==="string"&&weeklyTarget(learned,base,start)){
    try{
      await page.goto(learned,{waitUntil:"domcontentloaded",timeout:25000});
      if(await finish())return true;
    }catch{}
    if(!inPlatform(page.url(),origin,platformId))return false;
    if(page.url()!==start){await page.goto(start,{waitUntil:"domcontentloaded",timeout:25000});await page.waitForTimeout(1200);}
  }
  const planning:Action={kind:"visual",label:"Planning",region:"navigation",opener:false,interaction:"hover"};
  async function trigger(){
    const role=page.getByRole("button",{name:"Planning",exact:true}).filter({visible:true});
    if(await role.count()===1)return role;
    return await find(page,planning);
  }
  async function finishAndLearn(){
    if(!await finish())return false;
    routes[key]=page.url();
    await atomicJson(weeklyRoutesFile,routes);
    return true;
  }
  async function tryOption(){
    for(let i=0;i<8;i++){
      const option=await find(page,a);
      if(option&&await option.isVisible()&&await option.isEnabled()){
        const safe=await option.evaluate('(el)=>!el.closest("[aria-disabled=true],[inert],button:disabled,[contenteditable=true]")&&!el.matches(":disabled")');
        if(!safe)return false;
        await option.click({timeout:4000});
        return true;
      }
      await page.waitForTimeout(150);
    }
    return false;
  }
  try{
    if(!manual){
      const first=await trigger();
      if(!first)failureReason="weekly-planning-trigger-missing";
      else{
        await first.hover({timeout:5000});
        if(await tryOption())return await finishAndLearn();
        // After the sidebar expands, find the newly rendered label rather than using the old nth locator.
        const label=page.getByText("Planning",{exact:true}).filter({visible:true});
        const expanded=await label.count()===1?label:await trigger();
        if(expanded){
          await expanded.hover({timeout:4000});
          if(await tryOption())return await finishAndLearn();
          const freshTrigger=await trigger();
          if(freshTrigger){await freshTrigger.click({timeout:4000});if(await tryOption())return await finishAndLearn();}
        }
        failureReason="weekly-flyout-entry-not-found";
      }
    }
  }catch{failureReason="weekly-flyout-interaction-failed";}
  if(!manual||page.isClosed()||!inPlatform(page.url(),origin,platformId))return false;
  // Explicit supervised teaching: the operator chooses the page, not the robot.
  console.log("TEACH: Open Planning > Weekly planners in this same test course, then press Enter here.");
  const rl=createInterface({input:process.stdin,output:process.stdout});
  const abort=new AbortController();
  const stop=()=>abort.abort();
  page.once("close",stop);
  try{await rl.question("Press Enter after navigating: ",{signal:abort.signal});}
  catch{failureReason="weekly-teach-cancelled";return false;}
  finally{page.off("close",stop);rl.close();}
  if(!accept()){failureReason="weekly-teach-invalid-target";return false;}
  if(!await finishAndLearn())return false;
  taughtWeeklyThisRun=true;
  console.log("Weekly planners destination learned locally for this course.");
  return true;
}
async function click(page:Page,a:Action){
  if(a.kind==="submenu")return await openWeekly(page,a);
  const loc=await waitForControl(page,a);
  if(!loc){failureReason="control-not-ready";return false;}
  // find() already restricts candidates to known navigation cards, Calendar,
  // and exact allowlisted tab names. A layout wrapper may itself be a form,
  // dialog or toolbar; that alone does not make these controls write actions.
  const guard=await loc.evaluate(`(el) => {
    if(el.closest('[contenteditable="true"],[aria-disabled="true"],[inert],button:disabled') || el.matches(':disabled')) return "disabled-or-editor";
    if(el instanceof HTMLButtonElement && el.form && el.type!=="button") return "form-submit-or-reset";
    if(el.matches('input[type=submit],input[type=reset],input[type=file]')) return "form-action";
    if(el.matches('a[download]')) return "download";
    return null;
  }`);
  if(guard){failureReason=guard;return false;}
  // The selected locator is an explicitly allowed navigation control.
  // Use Playwright's native actionability checks, not a custom hit-test.
  try {
    if(a.kind==="visual"&&a.interaction==="hover")await loc.hover({timeout:5000});
    else if(a.kind==="visual"&&/^(?:timeline|list|grid|week|day) view$/i.test(a.label)){
      const radio=await loc.evaluate('el=>el instanceof HTMLInputElement && el.type==="radio"');
      if(radio){
        const label=page.locator("label").filter({has:loc});
        if(await label.count()===1)await label.click({timeout:5000});else await loc.click({timeout:5000});
      }else await loc.click({timeout:5000});
    }else await loc.click({timeout:10000});
  } catch(err) {
    const msg=err instanceof Error?err.message:"";
    failureReason=/intercepts pointer events/i.test(msg)?"navigation-overlay":
      /not stable/i.test(msg)?"navigation-unstable":
      /not visible/i.test(msg)?"navigation-hidden":
      /not enabled/i.test(msg)?"navigation-disabled":
      /detached/i.test(msg)?"navigation-detached":
      /timeout/i.test(msg)?"native-click-timeout":"native-click-error";
    return false;
  }
  if(a.kind==="class"){
    // A route change is not enough: wait for the actual course interface.
    const deadline=Date.now()+25000;
    let loaded=false;
    while(Date.now()<deadline&&!page.isClosed()&&!halted){
      if(inPlatform(page.url(),origin,platformId)&&new URL(page.url()).pathname!==new URL(home).pathname){
        const state=await inspect(page).catch(()=>null);
        if(state&&hasClassContent(state.snapshot)){
          await page.waitForTimeout(700);
          const confirmed=await inspect(page).catch(()=>null);
          if(confirmed&&hasClassContent(confirmed.snapshot)){loaded=true;break;}
        }
      }
      await page.waitForTimeout(600);
    }
    if(!loaded){failureReason="class-content-not-ready";currentPath=null;return false;}
  }else await page.waitForTimeout(1400);
  if(!inPlatform(page.url(),origin,platformId)){
    const u=new URL(page.url());
    failureReason=u.origin===origin&&u.pathname.startsWith("/platform/"+platformId+"/")?"same-platform-route-excluded":"destination-outside-approved-scope";
    currentPath=null;return false;
  }
  // Give the client-rendered view a bounded period to finish replacing its shell.
  await page.waitForTimeout(900);
  if(!inPlatform(page.url(),origin,platformId)){halted=true;failureReason="destination-outside-approved-scope";return false;}
  return true;
}

async function actions(page:Page):Promise<Action[]>{
  const result:Action[]=[];
  const visual=await visualCandidates(page);
  const inMenu=await page.locator("[role=menu]:visible").count()>0;
  const inDialog=await page.locator("[role=dialog]:visible,dialog[open]:visible").count()>0;
  if(inMenu||inDialog){
    return visual.filter(v=>v.region===(inMenu?"menu":"dialog")).map(v=>({kind:"visual",label:v.label,region:v.region,opener:v.opener}));
  }
  if(new URL(page.url()).pathname===new URL(home).pathname){
    const n=Math.min(await page.locator(cardSelector).count(),12);
    for(let index=0;index<n;index++)result.push({kind:"class",index});
    for(const label of homeCards)result.push({kind:"feature",label});
    result.push({kind:"calendar",label:"Calendar"});
  }else{
    if(visual.some(v=>v.label==="Planning"&&v.region==="navigation"))result.push({kind:"submenu",label:"Weekly planners"});
    // Discover rendered controls first. This includes text inside custom React elements.
    for(const v of visual){
      if(v.region==="navigation"&&/^(Planning|Classroom)$/i.test(v.label))result.push({kind:"visual",label:v.label,region:v.region,opener:false,interaction:"hover"});
      result.push({kind:"visual",label:v.label,region:v.region,opener:v.opener});
    }
    for(const label of [...new Set(tabs)]){if(label==="Calendar")continue;result.push({kind:"tab",label});result.push({kind:"navigation",label});}
    for(const label of editorOpeners)result.push({kind:"editor",label});
  }
  const available:Action[]=[];
  const names=new Set<string>();
  for(const a of result){
    const name=actionName(a);
    if(names.has(name))continue;
    if(a.kind==="visual"||a.kind==="submenu"){
      names.add(name);available.push(a);continue;
    }
    const loc=await find(page,a);
    if(loc && await loc.isVisible() && await loc.isEnabled()){
      const selected=await loc.evaluate('(el)=>el.getAttribute("aria-selected")==="true" || el.getAttribute("aria-current")==="page" || (el instanceof HTMLInputElement && el.type==="radio" && el.checked)');
      if(selected)continue;
      names.add(name);available.push(a);
    }
  }
  return available;
}

async function inspect(page:Page){
  if(!inPlatform(page.url(),origin,platformId))return null;
  const expr=source+"("+JSON.stringify({approvedOrigin:origin,labels,routeWords})+")";
  const data=await page.evaluate(expr) as Capture;
  if(!data||!inPlatform(page.url(),origin,platformId))return null;
  const visual=await visualCandidates(page);
  const snapshot:Snapshot={route:shape(page.url()),scanned:data.scanned,truncated:data.truncated,controls:data.controls,visualControls:visual.map(({index,...v})=>v)};

  // Ignore changes in row counts and loading skeletons when deciding whether to expand a view.
  // Keep URLs only in process memory; the report contains masked routes.
  const dialog=(snapshot.controls as {control:{role:string}}[]).some(c=>["dialog","menu"].includes(c.control.role));
  const features=(snapshot.controls as {control:{name:string|null;role:string;editable:boolean;type:string|null}}[]).filter(c=>c.control.name||c.control.editable||c.control.role==="dialog"||c.control.role==="textbox").map(c=>JSON.stringify([c.control.role,c.control.name,c.control.editable,c.control.type])).sort();
  const visualSignature=visual.map(v=>v.region+"|"+v.label.toLowerCase()).sort();
  const key=digest(page.url()+"|"+JSON.stringify([...new Set(features)])+"|"+JSON.stringify(visualSignature));
  return {snapshot,key,dialog,visualCount:visual.length};
}
async function capture(page:Page){
  const inspected=await inspect(page);
  if(!inspected)return null;
  const {snapshot,key,dialog,visualCount}=inspected;
  report.exploration.visualCandidates+=visualCount;
  if(seen.has(key)){const id=seen.get(key)!;stateUrls.set(id,page.url());report.exploration.duplicates++;return {id,fresh:false};}
  const id=report.snapshots.length;
  report.snapshots.push(snapshot);seen.set(key,id);stateKeys.set(id,key);stateUrls.set(id,page.url());stateDialogs.set(id,dialog);
  console.log("Captured state "+(id+1)+"/"+report.limits.states+"; requests observed: "+report.network.observed);
  return {id,fresh:true};
}

async function restore(page:Page,path:Action[]){
  if(currentPath===pathKey(path)&&inPlatform(page.url(),origin,platformId))return true;
  currentPath=null;
  await page.goto(home,{waitUntil:"domcontentloaded",timeout:25000});
  await waitForHome(page);
  if(!inPlatform(page.url(),origin,platformId)){halted=true;failureReason="restore-outside-approved-scope";return false;}
  for(const a of path){if(!await click(page,a))return false;}
  currentPath=pathKey(path);
  return true;
}

async function explore(page:Page,path:Action[],id:number):Promise<void>{

  async function enqueue(path:Action[],id:number){
    if(expanded.has(id)||path.length>=report.limits.depth||path.at(-1)?.kind==="editor")return;
    const last=path.at(-1);
    // Inspect creation menus, but stop at actual editable forms and the global calendar.
    if(last?.kind==="calendar")return;
    const openMenu=await page.locator("[role=menu]:visible").count()>0;
    if(!openMenu&&stateDialogs.get(id)&&await page.locator("[role=dialog] input:not([type=hidden]):not([type=radio]):not([type=checkbox]):visible,[role=dialog] textarea:visible,[role=dialog] [contenteditable=true]:visible").count()>0)return;
    if(!openMenu&&last?.kind==="visual"&&last.opener&&await page.locator("textarea:visible,[contenteditable=true]:visible").count()>0)return;
    const prior=new Set(path.map(actionName));
    const candidates=(await actions(page)).filter(a=>!prior.has(actionName(a)));
    if(openMenu&&!candidates.length){
      report.exploration.unresolvedMenus++;
      report.diagnostics.push({action:last?actionName(last):"menu",reason:"menu-items-unrecognized"});
      console.log("Menu opened, but no recognized navigation items. Review the menu manually if needed.");
      return;
    }
    expanded.add(id);
    if(path.length===1&&last?.kind==="class"&&!allClasses){
      const snapshot=report.snapshots[id];
      const signatures=(snapshot.controls as {control:{role:string;name:string|null;type:string|null;editable:boolean}}[]).map(c=>JSON.stringify([c.control.role,c.control.name,c.control.type,c.control.editable])).sort();
      const layout=JSON.stringify([snapshot.route,[...new Set(signatures)],candidates.map(actionName).sort()]);
      if(sampledClassLayouts.has(layout)){report.exploration.equivalentClassLayouts++;return;}
      sampledClassLayouts.add(layout);
    }
    // Expand open menus first, before replaying the rest of the queue.
    if(candidates.length){const pending={path,id,actions:candidates};if(openMenu)queue.unshift(pending);else queue.push(pending);}
    report.exploration.queued=queue.length;
  }
  if(!resumed)await enqueue(path,id);
  else {
    // Always check the current home once for newly available controls.
    const root=await capture(page);
    if(root){
      if(root.fresh||!expanded.has(root.id))await enqueue([],root.id);
      else{
        const pending=new Set(queue.filter(j=>j.id===root.id).flatMap(j=>j.actions.map(a=>actionKey(root.id,a))));
        const unseen=(await actions(page)).filter(a=>{const key=actionKey(root.id,a);return !completed.has(key)&&!pending.has(key)&&!retryLedger.has(key);});
        if(unseen.length)queue.push({id:root.id,path:[],actions:unseen});
      }
    }
  }
  await saveCheckpoint();
  while(queue.length&&!halted&&!page.isClosed()){
    if(attempts>=report.limits.attempts||report.snapshots.length>=report.limits.states)return;
    const job=queue[0];
    const a=job.actions[0];
    if(!a){queue.shift();await saveCheckpoint();continue;}
    const key=actionKey(job.id,a);
    if(completed.has(key)){report.exploration.knownActionsSkipped++;job.actions.shift();if(!job.actions.length)queue.shift();await saveCheckpoint();continue;}
    attempts++;report.exploration.attempts=attempts;
    let outcome="unknown";
    failureReason="unknown";
    console.log("Exploring depth "+(job.path.length+1)+": "+actionName(a)+" ("+attempts+"/"+report.limits.attempts+")");
    try{
      let ready=false;
      const target=stateUrls.get(job.id);
      const parentUrl=job.path.length?stateUrls.get(report.edges.find(e=>e.to===job.id&&e.from!==job.id)?.from??-1):undefined;
      if(currentPath===pathKey(job.path)&&page.url()===target)ready=true;
      else if(target&&target!==parentUrl&&!stateDialogs.get(job.id)&&!job.path.some(a=>a.kind==="visual"&&a.interaction==="hover")&&inPlatform(target,origin,platformId)){
        try{
          currentPath=null;
          await page.goto(target,{waitUntil:"domcontentloaded",timeout:25000});
          if(job.path.length===0)await waitForHome(page);
          else await page.waitForTimeout(2200);
          if(page.url()===target&&await waitForControl(page,a)){currentPath=pathKey(job.path);ready=true;}
        }catch{currentPath=null;}
      }
      // A URL alone does not prove that the intended React state is active.
      if(ready&&(await inspect(page))?.key!==stateKeys.get(job.id)){ready=false;currentPath=null;}
      if(!ready){
        ready=await restore(page,job.path);
        if(ready&&(await inspect(page))?.key!==stateKeys.get(job.id)){
          ready=false;failureReason="restored-state-changed";currentPath=null;
        }
      }
      if(ready)stateUrls.set(job.id,page.url());
      if(!ready||!await click(page,a)){
        currentPath=null;
        report.diagnostics.push({action:actionName(a),reason:failureReason});
        outcome=failureReason;
        console.log("Skipped: "+failureReason);
      }else{
        const nextPath=[...job.path,a];
        currentPath=pathKey(nextPath);
        const item=await capture(page);
        if(!item){outcome="capture-unavailable";report.diagnostics.push({action:actionName(a),reason:outcome});}
        else{
          if(item.fresh||!expanded.has(item.id))await enqueue(nextPath,item.id);
          report.edges.push({from:job.id,to:item.id,action:actionName(a)});
          if(item.id===job.id&&/^(?:(?:Hover )?(?:Planning|Classroom)|Weekly planners)$/.test(actionName(a))){
            report.exploration.noChangeActions++;
            outcome="no-visible-change";
            console.log("No visible navigation change: "+actionName(a));
          }else{completed.add(key);outcome="success";}
        }
      }
    }catch(err){
      currentPath=null;outcome="navigation-or-capture-"+errorKind(err instanceof Error?err.message:"");report.diagnostics.push({action:actionName(a),reason:outcome});
    }
    // The last durable checkpoint retains the in-flight action if the browser closes.
    if(halted||page.isClosed())return;
    if(outcome==="success")retryLedger.delete(key);
    else retryLedger.set(key,{id:job.id,path:job.path,action:a,failures:Math.min(3,(retryLedger.get(key)?.failures??0)+1),reason:outcome});
    job.actions.shift();
    if(!job.actions.length){const index=queue.indexOf(job);if(index>=0)queue.splice(index,1);}
    // Disk failure stops exploration rather than risking inconsistent progress.
    await saveCheckpoint();
  }
}

if(!process.argv.includes("--authorized-test-demo")){
  console.error("Only for authorized test/demo environments with fictitious data. Use --authorized-test-demo.");
  process.exitCode=1;
}else{
  const context=await chromium.launchPersistentContext(resolve(".local","browser-profile"),{headless:false,acceptDownloads:false});
  try{
    // Supervised navigation: observe only aggregate request metadata; do not intercept traffic.
    console.log("Supervised demo exploration: no network interception. Close the explorer tab to stop.");
    context.on("request",req=>{
      const method=["GET","HEAD","POST","OPTIONS","PUT","PATCH","DELETE"].includes(req.method())?req.method():"OTHER";
      report.network.observed++;
      bump(report.network.requestKinds,method+" "+req.resourceType()+" "+hostGroup(req.url()));
    });
    const page=await context.newPage();
    page.on("close",()=>{halted=true;});
    page.on("pageerror",err=>bump(report.startup.pageErrors,errorKind(err.message)));
    page.on("response",res=>{
      if(res.status()>=400)bump(report.network.httpErrors,String(res.status())+" "+res.request().resourceType()+" "+hostGroup(res.url()));
    });
    page.on("requestfailed",req=>bump(report.network.failedKinds,req.resourceType()+" "+hostGroup(req.url())+" "+errorKind(req.failure()?.errorText??"")));

    // Reuse an existing approved overview URL only in memory, otherwise open Toddle.
    const startFile=resolve(".local","explore-start.txt");
    const flag=process.argv.indexOf("--start");
    const explicit=flag>=0?process.argv[flag+1]:undefined;
    const saved=await readFile(startFile,"utf8").then(v=>v.trim()).catch(()=>undefined);
    const overview=(raw:string|undefined)=>{
      if(!raw)return undefined;
      try{const u=new URL(raw);return u.origin===origin&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/platform\/[0-9]+\/courses\/?$/.test(u.pathname)?u.href:undefined;}catch{return undefined;}
    };
    if(flag>=0&&!overview(explicit))throw new Error("Invalid start overview");
    const initial=overview(explicit)??overview(saved)??context.pages().filter(p=>p!==page).map(p=>overview(p.url())).find(Boolean)??origin+"/";
    if(overview(explicit))await writeFile(startFile,initial+"\n",{encoding:"utf8",mode:0o600});
    if(overview(initial)){
      platformId=new URL(initial).pathname.split("/")[2];
      home=origin+"/platform/"+platformId+"/courses";
    }
    report.startup.stage="open-overview";
    await page.goto(initial,{waitUntil:"domcontentloaded",timeout:30000});
    report.startup.stage="wait-platform-url";
    await page.waitForURL(u=>u.origin===origin&&/^\/platform\/[0-9]+(?:\/|$)/.test(u.pathname),{timeout:30000});
    const m=new URL(page.url()).pathname.match(/^\/platform\/([0-9]+)/);
    if(!m)throw new Error("No authenticated platform");
    platformId=m[1];home=origin+"/platform/"+platformId+"/courses";
    report.startup.stage="restore-home";
    if(page.url()!==home)await restore(page,[]);
    report.startup.stage="wait-cards";
    await waitForHome(page);
    currentPath=pathKey([]);
    report.startup.stage="capture-home";
    if(!fresh){
      report.startup.stage="load-checkpoint";
      try{await loadCheckpoint();}
      catch(err){if(requireResume||(err as NodeJS.ErrnoException).code!=="ENOENT")throw err;}
    }
    if(!resumed)await archivePrevious();
    reportStarted=true;
    const initialState=resumed?{id:0,fresh:false}:await capture(page);
    report.startup.stage=initialState?"explore":"capture-empty";
    if(initialState){
      console.log("Session budget: "+maxNewStates+" new states, "+maxAttempts+" attempts, depth "+maxDepth+".");
      await explore(page,[],initialState.id);
      report.startup.stage=halted||page.isClosed()?"stopped":report.exploration.queued>0?"limit-reached":"finished";
      if(report.startup.stage==="finished")console.log("Exploration queue exhausted: "+retryLedger.size+" recorded unresolved actions. This does not imply full platform coverage.");
      else if(report.startup.stage==="limit-reached")console.log("Session limit reached; pending paths are preserved in the checkpoint.");
    }
  }catch(err){
    report.diagnostics.push({action:"startup:"+report.startup.stage,reason:errorKind(err instanceof Error?err.message:"")});
    const active=context.pages().at(-1);
    if(active){try{
      report.startup.ui=await active.evaluate(()=>{const text=document.body?.innerText??"";if(/couldn.t load Toddle|please reload/i.test(text))return "app-load-error";if(/sign in|log in/i.test(text)&&document.querySelector("input"))return "login-visible";return "other";});
    }catch{report.startup.ui="unavailable";}}
    console.log("Startup stopped at "+report.startup.stage+"; UI: "+report.startup.ui+".");
    if(report.startup.stage==="load-checkpoint")console.log("Checkpoint not resumed. Verify the same authorized test platform, class mode, and checkpoint file, or use --fresh to archive and start a new map.");
    process.exitCode=1;
  }finally{
    await persist();await context.close().catch(()=>{});
    console.log("Captured "+report.snapshots.length+" states; "+report.network.observed+" requests observed (no interception).");
    console.log("Review and share only "+output);
    console.log("Local checkpoint: "+checkpointFile+"; memory is reused automatically; use --fresh for a new map.");
  }
}
