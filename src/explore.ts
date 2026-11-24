import { chromium, type Page, type Locator } from "playwright";
import { resolve } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { requestAllowed, inPlatform } from "./explore-policy.ts";

const origin = "https://web.toddleapp.com";
const homeCards = ["Assignments manager","School announcements","School policies and resources","School library"];
const tabs = ["Planning","Planner","Unit planner","Lesson plans","Learning experiences","Learning engagements","Activities","Assignments","Class stream","Stream","Announcements","Calendar","Resources","Overview","Units","Lessons","Curriculum"];
const labels = [...homeCards,...tabs,"Home","Courses","My courses","Create","Add","Edit","Save","Publish","Send","Students","Messaging","Create announcement","Create assignment","Add attachment","Title","Description","Instructions","Due date","Start date","End date","Date","Time","More options","Cancel","Close","Search","Filter","Draft","New","Schedule"];
const routeWords = ["platform","course","courses","class","classes","classroom","planning","planner","unit","units","lesson","lessons","activities","assignments","announcements","calendar","resources","overview","stream","curriculum","assignment-manager","assignments-manager","school-announcements","school-library","learning-experiences"];
const cardSelector = '[role="button"][class*="ClassCardV2__container___"]';
const featureSelector = '[role="button"][class*="ButtonCard__container___"]';
type Action = { kind:"class"; index:number } | {kind:"feature"|"tab"|"calendar"; label:string};
type Snapshot = {route:string; scanned:number; truncated:boolean; controls:unknown[];};
type Capture = {scanned:number;truncated:boolean;controls:unknown[];candidates:unknown[]}|null;
const report = {version:3,mode:"guarded-demo-explorer",snapshots:[] as Snapshot[],edges:[] as {from:number;to:number;action:string}[],diagnostics:[] as {action:string;reason:string}[],network:{allowed:0,blocked:0,websocketsBlocked:0,blockedKinds:{} as Record<string,number>,allowedKinds:{} as Record<string,number>,httpErrors:{} as Record<string,number>,failedKinds:{} as Record<string,number>},startup:{stage:"not-started",ui:"unknown",pageErrors:{} as Record<string,number>},limits:{states:40,depth:4,attempts:70}};
const dir=resolve(".local","reports"); await mkdir(dir,{recursive:true});
const output=resolve(dir,"toddle-map-explore.json");
const source=await readFile(new URL("./capture-dom.js",import.meta.url),"utf8");
const persist=()=>writeFile(output,JSON.stringify(report,null,2)+"\n",{encoding:"utf8",mode:0o600});
const shape=(url:string)=>"/"+new URL(url).pathname.split("/").filter(Boolean).slice(0,30).map(x=>routeWords.includes(x.toLowerCase())?x.toLowerCase():":segment").join("/");
const actionName=(a:Action)=>a.kind==="class"?"Class card "+(a.index+1):a.label;
const seen=new Map<string,number>();
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
function externalFontAsset(method:string,raw:string,kind:string,nav:boolean){
  try{
    const u=new URL(raw);
    return !nav&&["GET","HEAD"].includes(method)&&u.protocol==="https:"&&!u.username&&!u.password&&["stylesheet","font"].includes(kind)&&hostGroup(raw)==="font-provider";
  }catch{return false;}
}



async function find(page:Page,a:Action):Promise<Locator|null>{
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
  const loc=page.getByRole("tab",{name:a.label,exact:true});
  return await loc.count()===1?loc:null;
}

async function click(page:Page,a:Action){
  const loc=await waitForControl(page,a);
  if(!loc){failureReason="control-not-ready";return false;}
  // Never click an editor, form, menu of actions or a disabled control.
  const ok=await loc.evaluate('(el) => !el.closest("form,[contenteditable=true],[role=dialog],[role=menu],[role=toolbar]") && !el.matches("button[type=submit],button[type=reset],[aria-disabled=true],[disabled]")');
  if(!ok){failureReason="control-excluded-by-safety-policy";return false;}
  await loc.scrollIntoViewIfNeeded({timeout:3000});
  // Ensure click point belongs to the chosen navigation control rather than a nested action.
  const point=await loc.evaluate('(el) => { const r=el.getBoundingClientRect(); for(const f of [0.5,0.25,0.75]) {const x=r.width*f,y=r.height*0.5;const h=document.elementFromPoint(r.left+x,r.top+y);if(h && el.contains(h) && (h===el || h.closest("button,a,input,[role=button],[role=tab],[role=menuitem]")===el))return {x,y};}return null;}');
  if(!point){failureReason="safe-click-point-unavailable";return false;}
  await loc.click({position:point,timeout:4000});
  await page.waitForTimeout(2500);
  if(!inPlatform(page.url(),origin,platformId)){halted=true;failureReason="destination-outside-approved-scope";return false;}
  // Give the client-rendered view a bounded period to finish replacing its shell.
  await page.waitForTimeout(1500);
  if(!inPlatform(page.url(),origin,platformId)){halted=true;failureReason="destination-outside-approved-scope";return false;}
  return true;
}

async function actions(page:Page):Promise<Action[]>{
  const result:Action[]=[];
  if(new URL(page.url()).pathname===new URL(home).pathname){
    const n=Math.min(await page.locator(cardSelector).count(),12);
    for(let index=0;index<n;index++)result.push({kind:"class",index});
    for(const label of homeCards)result.push({kind:"feature",label});
    result.push({kind:"calendar",label:"Calendar"});
  }else{
    for(const label of tabs)result.push({kind:"tab",label});
  }
  const available:Action[]=[];
  for(const a of result){const loc=await find(page,a);if(loc && await loc.isVisible() && await loc.isEnabled())available.push(a);}
  return available;
}

async function capture(page:Page){
  if(!inPlatform(page.url(),origin,platformId))return null;
  const expr=source+"("+JSON.stringify({approvedOrigin:origin,labels,routeWords})+")";
  const data=await page.evaluate(expr) as Capture;
  if(!data||!inPlatform(page.url(),origin,platformId))return null;
  const snapshot:Snapshot={route:shape(page.url()),scanned:data.scanned,truncated:data.truncated,controls:data.controls};
  const key=page.url()+"|"+JSON.stringify(snapshot);
  if(seen.has(key))return {id:seen.get(key)!,fresh:false};
  const id=report.snapshots.length;
  report.snapshots.push(snapshot);seen.set(key,id);
  await persist();
  console.log("Captured state "+(id+1)+"/"+report.limits.states+"; requests blocked: "+report.network.blocked);
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
  if(halted||path.length>=report.limits.depth)return;
  const candidates=await actions(page);
  for(const a of candidates){
    if(halted||attempts>=report.limits.attempts||report.snapshots.length>=report.limits.states)return;
    attempts++;
    failureReason="unknown";
    console.log("Exploring "+actionName(a)+" ("+attempts+"/"+report.limits.attempts+")");
    try {
      if(!await restore(page,path)||!await click(page,a)){
        currentPath=null;
        report.diagnostics.push({action:actionName(a),reason:failureReason});console.log("Skipped: "+failureReason);await persist();continue;
      }
      currentPath=pathKey([...path,a]);
      const item=await capture(page);
      if(!item){report.diagnostics.push({action:actionName(a),reason:"capture-unavailable"});await persist();continue;}
      report.edges.push({from:id,to:item.id,action:actionName(a)});await persist();
      if(item.fresh)await explore(page,[...path,a],item.id);
    }catch(err){currentPath=null;report.diagnostics.push({action:actionName(a),reason:"navigation-or-capture-"+errorKind(err instanceof Error?err.message:"")});await persist();}
  }
}

if(!process.argv.includes("--authorized-test-demo")){
  console.error("Only for authorized test/demo environments with fictitious data. Use --authorized-test-demo.");
  process.exitCode=1;
}else{
  const context=await chromium.launchPersistentContext(resolve(".local","browser-profile"),{headless:false,serviceWorkers:"block",acceptDownloads:false});
  try{
    // Register before opening the exploration page. All unknown write methods fail closed.
    await context.route("**/*",async route=>{
      const req=route.request();
      let body:unknown=null;
      if(req.method()==="POST"){try{body=req.postDataJSON();}catch{}}
      const nav=req.isNavigationRequest();
      const scopeOK=!nav||!platformId||inPlatform(req.url(),origin,platformId);
      const kind=req.resourceType();
      const method=["GET","HEAD","POST","OPTIONS","PUT","PATCH","DELETE"].includes(req.method())?req.method():"OTHER";
      const key=method+" "+kind+" "+hostGroup(req.url());
      if(scopeOK&&(requestAllowed(req.method(),req.url(),body,origin,nav)||externalFontAsset(req.method(),req.url(),kind,nav))){
        report.network.allowed++;bump(report.network.allowedKinds,key);await route.continue();
      }else{
        report.network.blocked++;bump(report.network.blockedKinds,key);await route.abort("blockedbyclient");
      }
    });
    await context.routeWebSocket("**/*",ws=>{report.network.websocketsBlocked++;void ws.close();});
    const page=await context.newPage();
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
    if(initialState){await explore(page,[],initialState.id);report.startup.stage="finished";}
  }catch(err){
    report.diagnostics.push({action:"startup:"+report.startup.stage,reason:errorKind(err instanceof Error?err.message:"")});
    const active=context.pages().at(-1);
    if(active){try{
      report.startup.ui=await active.evaluate(()=>{const text=document.body?.innerText??"";if(/couldn.t load Toddle|please reload/i.test(text))return "app-load-error";if(/sign in|log in/i.test(text)&&document.querySelector("input"))return "login-visible";return "other";});
    }catch{report.startup.ui="unavailable";}}
    console.log("Startup stopped at "+report.startup.stage+"; UI: "+report.startup.ui+".");
  }finally{
    await persist();await context.close();
    console.log("Captured "+report.snapshots.length+" states; "+report.network.blocked+" requests blocked.");
    console.log("Blocked request categories: "+JSON.stringify(report.network.blockedKinds));
    console.log("Review and share only "+output);
  }
}
