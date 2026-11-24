import { chromium, type Page, type Locator } from "playwright";
import { resolve } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { inPlatform } from "./explore-policy.ts";

const origin = "https://web.toddleapp.com";
const homeCards = ["Assignments manager","School announcements","School policies and resources","School library"];
const tabs = ["Planning","Planner","Unit planner","Unit planning","Lesson planner","Lesson planning","Lesson plans","Learning experiences","Learning engagements","Activities","Assignments","Assignments manager","Class stream","Stream","Announcements","School announcements","Calendar","Resources","Overview","Units","Lessons","Curriculum","Classroom","Class timetable","Timetable","Weekly planner","Daily planner","Yearly planner","Learning plan","Learning goals","Class resources","Course resources","My planning","All assignments","Upcoming","Past","Drafts","Published","Scheduled","List view","Calendar view","Week view","Day view","Unit plans","Unit planning","Lesson plans","Learning experiences","Learning engagement","Learning experience","Assessment","Assessments","Class calendar","Class announcements","Class activities","Tasks","Learning tasks","Class journal","Journal","Curriculum overview","Scope and sequence","Weekly planning","Daily planning","Teaching and learning","Learning resources","Published assignments","Scheduled assignments","Draft assignments"];
const labels = [...homeCards,...tabs,"Create activity","Create lesson plan","Home","Courses","My courses","Create","Add","Edit","Save","Publish","Send","Students","Messaging","Create announcement","Create assignment","Add attachment","Title","Description","Instructions","Due date","Start date","End date","Date","Time","More options","Cancel","Close","Search","Filter","Draft","New","Schedule"];
const routeWords = ["platform","course","courses","class","classes","classroom","planning","planner","unit","units","lesson","lessons","activities","assignments","announcements","calendar","resources","overview","stream","curriculum","assignment-manager","assignments-manager","school-announcements","school-library","learning-experiences"];
const cardSelector = '[role="button"][class*="ClassCardV2__container___"]';
const featureSelector = '[role="button"][class*="ButtonCard__container___"]';
type Action = { kind:"class"; index:number } | {kind:"feature"|"tab"|"calendar"|"navigation"|"editor"; label:string} | {kind:"visual";label:string;region:string;opener:boolean};
type VisualCandidate={index:number;label:string;region:string;opener:boolean;x:number;y:number;width:number;height:number};
const visualSelector="button,a[href],[role=button],[role=link],[role=tab],[role=menuitem],summary,input[type=radio],nav li,nav div,nav span,[role=menu] div,[role=menu] span,[role=dialog] div,[role=dialog] span";
const editorOpeners=["Create assignment","Create announcement","Create lesson plan","Create activity"];
type Snapshot = {route:string; scanned:number; truncated:boolean; controls:unknown[];visualControls?:Omit<VisualCandidate,"index">[];};
type Capture = {scanned:number;truncated:boolean;controls:unknown[];candidates:unknown[]}|null;
const report = {version:6,mode:"supervised-demo-explorer",snapshots:[] as Snapshot[],edges:[] as {from:number;to:number;action:string}[],diagnostics:[] as {action:string;reason:string}[],network:{interception:false,observed:0,requestKinds:{} as Record<string,number>,httpErrors:{} as Record<string,number>,failedKinds:{} as Record<string,number>},startup:{stage:"not-started",ui:"unknown",pageErrors:{} as Record<string,number>},limits:{states:80,depth:5,attempts:120},exploration:{strategy:"breadth-first-rendered-text",visualCandidates:0,duplicates:0,queued:0,attempts:0}};
const dir=resolve(".local","reports"); await mkdir(dir,{recursive:true});
const output=resolve(dir,"toddle-map-explore.json");
const source=await readFile(new URL("./capture-dom.js",import.meta.url),"utf8");
const visualSource=await readFile(new URL("./visual-discovery.js",import.meta.url),"utf8");
async function visualCandidates(page:Page):Promise<VisualCandidate[]>{
  if(!inPlatform(page.url(),origin,platformId))return [];
  const expr=visualSource+"("+JSON.stringify({selector:visualSelector,knownLabels:[...tabs,...homeCards,...editorOpeners,"Create","New","Add","Create unit","Create lesson","Add unit","Add lesson","New unit","New lesson"]})+")";
  return await page.evaluate(expr) as VisualCandidate[];
}
const persist=()=>writeFile(output,JSON.stringify(report,null,2)+"\n",{encoding:"utf8",mode:0o600});
const shape=(url:string)=>"/"+new URL(url).pathname.split("/").filter(Boolean).slice(0,30).map(x=>routeWords.includes(x.toLowerCase())?x.toLowerCase():":segment").join("/");
const actionName=(a:Action)=>a.kind==="class"?"Class card "+(a.index+1):a.label;
const seen=new Map<string,number>();
const stateUrls=new Map<number,string>();
const stateDialogs=new Map<number,boolean>();
let attempts=0;
let platformId="";
let home="";
let halted=false;
let currentPath: string|null=null;
let failureReason="unknown";
const pathKey=(path:Action[])=>JSON.stringify(path);
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

async function click(page:Page,a:Action){
  const loc=await waitForControl(page,a);
  if(!loc){failureReason="control-not-ready";return false;}
  // find() already restricts candidates to known navigation cards, Calendar,
  // and exact allowlisted tab names. A layout wrapper may itself be a form,
  // dialog or toolbar; that alone does not make these controls write actions.
  const guard=await loc.evaluate(`(el) => {
    if(el.closest('[contenteditable="true"],[aria-disabled="true"],[inert]') || el.matches(':disabled')) return "disabled-or-editor";
    if(el instanceof HTMLButtonElement && el.form && el.type!=="button") return "form-submit-or-reset";
    if(el.matches('input[type=submit],input[type=reset],input[type=file]')) return "form-action";
    if(el.matches('a[download]')) return "download";
    return null;
  }`);
  if(guard){failureReason=guard;return false;}
  // The selected locator is an explicitly allowed navigation control.
  // Use Playwright's native actionability checks, not a custom hit-test.
  try {
    await loc.click({timeout:10000});
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
  await page.waitForTimeout(2500);
  if(!inPlatform(page.url(),origin,platformId)){failureReason="destination-outside-approved-scope";currentPath=null;return false;}
  // Give the client-rendered view a bounded period to finish replacing its shell.
  await page.waitForTimeout(1500);
  if(!inPlatform(page.url(),origin,platformId)){halted=true;failureReason="destination-outside-approved-scope";return false;}
  return true;
}

async function actions(page:Page):Promise<Action[]>{
  const result:Action[]=[];
  const visual=await visualCandidates(page);
  const inDialog=await page.locator("[role=dialog]:visible,dialog[open]:visible").count()>0;
  if(inDialog){
    return visual.filter(v=>v.region==="dialog").map(v=>({kind:"visual",label:v.label,region:v.region,opener:v.opener}));
  }
  if(new URL(page.url()).pathname===new URL(home).pathname){
    const n=Math.min(await page.locator(cardSelector).count(),12);
    for(let index=0;index<n;index++)result.push({kind:"class",index});
    for(const label of homeCards)result.push({kind:"feature",label});
    result.push({kind:"calendar",label:"Calendar"});
  }else{
    // Discover rendered controls first. This includes text inside custom React elements.
    for(const v of visual)result.push({kind:"visual",label:v.label,region:v.region,opener:v.opener});
    for(const label of [...new Set(tabs)]){if(label==="Calendar")continue;result.push({kind:"tab",label});result.push({kind:"navigation",label});}
    for(const label of editorOpeners)result.push({kind:"editor",label});
  }
  const available:Action[]=[];
  const names=new Set<string>();
  for(const a of result){
    const name=actionName(a);
    if(names.has(name))continue;
    if(a.kind==="visual"){
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

async function capture(page:Page){
  if(!inPlatform(page.url(),origin,platformId))return null;
  const expr=source+"("+JSON.stringify({approvedOrigin:origin,labels,routeWords})+")";
  const data=await page.evaluate(expr) as Capture;
  if(!data||!inPlatform(page.url(),origin,platformId))return null;
  const visual=await visualCandidates(page);
  const snapshot:Snapshot={route:shape(page.url()),scanned:data.scanned,truncated:data.truncated,controls:data.controls,visualControls:visual.map(({index,...v})=>v)};
  report.exploration.visualCandidates+=visual.length;
  // Ignore changes in row counts and loading skeletons when deciding whether to expand a view.
  // Keep URLs only in process memory; the report contains masked routes.
  const dialog=(snapshot.controls as {control:{role:string}}[]).some(c=>c.control.role==="dialog");
  const features=(snapshot.controls as {control:{name:string|null;role:string;editable:boolean;type:string|null}}[]).filter(c=>c.control.name||c.control.editable||c.control.role==="dialog"||c.control.role==="textbox").map(c=>JSON.stringify([c.control.role,c.control.name,c.control.editable,c.control.type])).sort();
  const visualSignature=visual.map(v=>v.region+"|"+v.label.toLowerCase()).sort();
  const key=page.url()+"|"+JSON.stringify([...new Set(features)])+"|"+JSON.stringify(visualSignature);
  if(seen.has(key)){report.exploration.duplicates++;return {id:seen.get(key)!,fresh:false};}
  const id=report.snapshots.length;
  report.snapshots.push(snapshot);seen.set(key,id);stateUrls.set(id,page.url());stateDialogs.set(id,dialog);
  await persist();
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
  type Pending={path:Action[];id:number;actions:Action[]};
  const queue:Pending[]=[];
  const expanded=new Set<number>();
  async function enqueue(path:Action[],id:number){
    if(expanded.has(id)||path.length>=report.limits.depth||path.at(-1)?.kind==="editor")return;
    const last=path.at(-1);
    // Inspect creation menus, but stop at actual editable forms and the global calendar.
    if(last?.kind==="calendar")return;
    if(stateDialogs.get(id)&&await page.locator("[role=dialog] input:not([type=hidden]):not([type=radio]):not([type=checkbox]):visible,[role=dialog] textarea:visible,[role=dialog] [contenteditable=true]:visible").count()>0)return;
    if(last?.kind==="visual"&&last.opener&&await page.locator("textarea:visible,[contenteditable=true]:visible").count()>0)return;
    expanded.add(id);
    const prior=new Set(path.map(actionName));
    const candidates=(await actions(page)).filter(a=>!prior.has(actionName(a)));
    if(candidates.length)queue.push({path,id,actions:candidates});
    report.exploration.queued=queue.length;
  }
  await enqueue(path,id);
  while(queue.length&&!halted&&!page.isClosed()){
    const job=queue.shift()!;
    report.exploration.queued=queue.length;
    for(const a of job.actions){
      if(halted||page.isClosed()||attempts>=report.limits.attempts||report.snapshots.length>=report.limits.states)return;
      attempts++;report.exploration.attempts=attempts;
      failureReason="unknown";
      console.log("Exploring depth "+(job.path.length+1)+": "+actionName(a)+" ("+attempts+"/"+report.limits.attempts+")");
      try{
        let ready=false;
        const target=stateUrls.get(job.id);
        // Reuse observed overview URLs rather than replaying the whole path.
        // Only use direct restore when this URL differed from the parent and is in scope.
        const parentUrl=job.path.length?stateUrls.get(report.edges.find(e=>e.to===job.id&&e.from!==job.id)?.from??-1):undefined;
        if(currentPath===pathKey(job.path)&&page.url()===target)ready=true;
        else if(target&&target!==parentUrl&&!stateDialogs.get(job.id)&&inPlatform(target,origin,platformId)){
          try{
            currentPath=null;
            await page.goto(target,{waitUntil:"domcontentloaded",timeout:25000});
            if(job.path.length===0)await waitForHome(page);
            else await page.waitForTimeout(2200);
            if(page.url()===target&&await waitForControl(page,a)){currentPath=pathKey(job.path);ready=true;}
          }catch{currentPath=null;}
        }
        if(!ready)ready=await restore(page,job.path);
        if(!ready||!await click(page,a)){
          currentPath=null;report.diagnostics.push({action:actionName(a),reason:failureReason});
          console.log("Skipped: "+failureReason);await persist();continue;
        }
        const nextPath=[...job.path,a];
        currentPath=pathKey(nextPath);
        const item=await capture(page);
        if(!item){report.diagnostics.push({action:actionName(a),reason:"capture-unavailable"});await persist();continue;}
        report.edges.push({from:job.id,to:item.id,action:actionName(a)});
        if(item.fresh)await enqueue(nextPath,item.id);
        await persist();
      }catch(err){
        currentPath=null;report.diagnostics.push({action:actionName(a),reason:"navigation-or-capture-"+errorKind(err instanceof Error?err.message:"")});await persist();
      }
    }
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
    const initialState=await capture(page);
    report.startup.stage=initialState?"explore":"capture-empty";
    if(initialState){await explore(page,[],initialState.id);report.startup.stage=halted||page.isClosed()?"stopped":report.exploration.queued>0||attempts>=report.limits.attempts||report.snapshots.length>=report.limits.states?"limit-reached":"finished";}
  }catch(err){
    report.diagnostics.push({action:"startup:"+report.startup.stage,reason:errorKind(err instanceof Error?err.message:"")});
    const active=context.pages().at(-1);
    if(active){try{
      report.startup.ui=await active.evaluate(()=>{const text=document.body?.innerText??"";if(/couldn.t load Toddle|please reload/i.test(text))return "app-load-error";if(/sign in|log in/i.test(text)&&document.querySelector("input"))return "login-visible";return "other";});
    }catch{report.startup.ui="unavailable";}}
    console.log("Startup stopped at "+report.startup.stage+"; UI: "+report.startup.ui+".");
  }finally{
    await persist();await context.close().catch(()=>{});
    console.log("Captured "+report.snapshots.length+" states; "+report.network.observed+" requests observed (no interception).");
    console.log("Review and share only "+output);
  }
}
