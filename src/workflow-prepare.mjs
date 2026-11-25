import { chromium } from "playwright";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

const args=process.argv.slice(2);
function option(name){
  const i=args.indexOf("--"+name);
  if(i<0||!args[i+1]||args[i+1].startsWith("--"))throw Error("Missing --"+name);
  return args[i+1];
}
if(!args.includes("--authorized-test-demo"))throw Error("This pilot is for an authorized test environment with fictitious data.");
const job=JSON.parse((await readFile(resolve(option("file")),"utf8")).replace(/^\uFEFF/,""));
function required(key,max=10000){
  if(typeof job[key]!=="string"||!job[key].trim()||job[key].length>max)throw Error("Invalid "+key);
  return job[key].trim();
}
const workflow=required("workflow",30),body=required("body");
if(!["announcement","planning"].includes(workflow))throw Error("Supported workflows: announcement, planning.");
const title=workflow==="announcement"?required("title",100):required("block",100);
const week=workflow==="planning"?required("week",100):null;
const time=workflow==="planning"?required("time",100):null;
const planner=workflow==="planning"?required("planner",100):null;
const origin="https://web.toddleapp.com";
const rl=createInterface({input:process.stdin,output:process.stdout});
const context=await chromium.launchPersistentContext(resolve(".local","browser-profile"),{headless:false});
const visible=l=>l.filter({visible:true});
async function unique(l,description){
  const v=visible(l);
  await v.first().waitFor({state:"visible",timeout:12000});
  if(await v.count()!==1)throw Error("Ambiguous "+description+"; no guessed click or field selection.");
  return v;
}
async function empty(l){
  return l.evaluate(el=>("value" in el?el.value:el.innerText??el.textContent??"").replace(/[\u200B-\u200D\uFEFF]/g,"").trim()==="");
}
async function checkFilled(l,expected){
  const val=await l.evaluate(el=>"value" in el?el.value:el.innerText??el.textContent??"");
  if(val.replace(/\r\n/g,"\n").trim()!==expected.replace(/\r\n/g,"\n").trim())throw Error("Editor read-back mismatch; inspect the visible form.");
}
function approved(page){
  const u=new URL(page.url());
  return u.origin===origin&&/^\/platform\/\d+(?:\/|$)/.test(u.pathname);
}
try{
  let page=context.pages().find(p=>{try{return approved(p)}catch{return false}})??context.pages()[0]??await context.newPage();
  if(!approved(page))await page.goto(origin+"/",{waitUntil:"domcontentloaded"});
  await page.waitForURL(u=>u.origin===origin&&/^\/platform\/\d+(?:\/|$)/.test(u.pathname),{timeout:180000});
  console.log("Pilot: "+workflow+". Use fictitious data in an authorized test environment.");
  if(workflow==="announcement"){
    console.log("Open the Toddle home screen (or the empty Create announcement editor).");
  }else{
    console.log("Open the correct weekly planner, week and an EMPTY test block. Do not open Edit blocks.");
    console.log("Expected planner: "+planner+" | week: "+week+" | block: "+title+" | time: "+time);
    console.log("Planning text may autosave immediately.");
  }
  await rl.question("When the browser is ready, press Enter: ");
  if(!approved(page))throw Error("Wrong page.");
  const scope=new URL(page.url()).pathname.match(/^\/platform\/\d+/)[0];
  const sameScope=()=>approved(page)&&new URL(page.url()).pathname.startsWith(scope+"/");
  if(workflow==="announcement"){
    const editorHeading=()=>visible(page.getByText("Create announcement",{exact:true}));
    const home=visible(page.getByText("School announcements",{exact:true}));
    if(await home.count()===1&&/\/courses\/?$/.test(new URL(page.url()).pathname)){
      await home.click({timeout:10000});
      if(!sameScope())throw Error("Unexpected navigation.");
    }
    if(await visible(page.locator('textarea')).count()===0){
      const create=await unique(page.getByRole("button",{name:"Create announcement",exact:true}),"Create announcement button");
      await create.click();
    }
    if(!sameScope())throw Error("Unexpected navigation.");
    await editorHeading().first().waitFor({state:"visible",timeout:12000});
    await unique(page.getByRole("button",{name:"Publish",exact:true}).or(page.getByRole("button",{name:/^Publish$/})).first(),"visible Publish control (not clicked)");
    const heading=await unique(page.locator("textarea"),"announcement title");
    const editor=await unique(page.locator('div[contenteditable="true"]'),"announcement body");
    if(!await empty(heading)||!await empty(editor))throw Error("Editor is not empty; refusing to overwrite existing content.");
    console.log("Ready to fill title and body. No recipients will be selected, and Publish will not be clicked.");
    if(await rl.question("Type PREPARAR to fill the test form: ")!=="PREPARAR")returnExit();
    if(!sameScope()||!await empty(heading)||!await empty(editor))throw Error("Page or fields changed.");
    await heading.fill(title);
    await editor.fill(body);
    await checkFilled(heading,title);
    await checkFilled(editor,body);
    console.log("Title and body verified in the form. Not saved or published by this command.");
  }else{
    if(!/\/weekly\/?$/.test(new URL(page.url()).pathname))throw Error("Open a weekly planner first.");
    for(const [label,description] of [[planner,"planner"],[week,"week"]]){
      const matches=visible(page.getByText(label,{exact:true}));
      if(await matches.count()===0)throw Error("Expected "+description+" not visible.");
    }
    const editor=await unique(page.locator('div[contenteditable="true"]'),"planning description");
    // Find a nearby ancestor containing the block header and the observed Upload control.
    // Exact visible block title and time must both occur in that same editor container.
    const matchesBlock=()=>editor.evaluate((el,expected)=>{
      const norm=s=>(s??"").trim().replace(/\s+/g," ");
      for(let p=el.parentElement,i=0;p&&i<9&&p!==document.body;i++,p=p.parentElement){
        const controls=Array.from(p.querySelectorAll("button,[role=button]")).filter(n=>n.getClientRects().length);
        if(!controls.some(n=>[n.innerText,n.getAttribute("aria-label"),n.getAttribute("title")].some(v=>norm(v)==="Upload")))continue;
        const texts=Array.from(p.querySelectorAll("div,span,p,h1,h2,h3,h4")).filter(n=>n.getClientRects().length&&n.childElementCount===0).map(n=>norm(n.textContent));
        return texts.includes(norm(expected.title))&&texts.includes(norm(expected.time));
      }
      return false;
    },{title,time});
    if(!await matchesBlock()||!await empty(editor))throw Error("Block identity not verified, or description is not empty.");
    if(await rl.question("Type PREPARAR to fill this test block (may autosave): ")!=="PREPARAR")returnExit();
    if(!sameScope()||!await matchesBlock()||!await empty(editor))throw Error("Block changed.");
    await editor.fill(body);
    await checkFilled(editor,body);
    console.log("Description verified in the editor. Server persistence not yet verified.");
  }
  await rl.question("Review the visible result. Press Enter to close the browser: ");
}finally{rl.close();await context.close();}
function returnExit(){throw Error("Cancelled before filling.");}
