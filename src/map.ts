import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

const categories = ["home","classes","planning","lesson-plan","activities","assignment","announcements","messages","calendar","resources","other"];
const labels = [
  "School announcements","Assignments manager","School policies and resources","School library","Courses","My courses","Course","Home","Dashboard","Classes","Class","Classroom","Planning","Planner","Unit planner",
  "Lesson plan","Lesson plans","Learning experiences","Learning experience","Learning engagements",
  "Activities","Activity","Assignments","Assignment","Assessment","Assessments","Class stream",
  "Stream","Announcements","Announcement","Messages","Message","Messaging","Calendar","Resources",
  "Files","Attachments","Add attachment","Attach file","Upload","Create","New","Add","Edit","Save",
  "Save draft","Draft","Publish","Post","Send","Schedule","Cancel","Close","Back","Next","Previous",
  "Title","Description","Instructions","Due date","Start date","End date","Date","Time","Subject",
  "Grade","Class","Select class","Select classes","Recipients","Students","Teachers","Search","Filter",
  "Settings","More","More options","Options","Add activity","Create activity","Create assignment",
  "Create announcement","New message","Compose","Create lesson plan","Add lesson","Add unit",
  "Planejamento","Turmas","Atividades","Avisos","Mensagens","Calendário","Criar","Salvar",
  "Publicar","Enviar","Título","Descrição","Anexar","Cancelar","Editar","Próximo","Voltar"
];
const routeWords = ["platform","course","courses","home","dashboard","class","classes","classroom","planning","planner","plans","lesson","lessons","lesson-plan","lesson-plans","unit","units","activity","activities","assignment","assignments","announcement","announcements","message","messages","calendar","resources","teacher","teachers","stream","create","new","edit","view","settings","school","schools","app","learning","assessment","assessments","curriculum"];
const reportDir = resolve(".local","reports");
await mkdir(reportDir, { recursive: true });
const terminal = createInterface({ input: process.stdin, output: process.stdout });
const auto = process.argv.includes("--auto");
const watch = process.argv.includes("--watch");
const approved = process.argv.includes(auto ? "--authorized-test-demo" : "--authorized");
const toddleOrigin = "https://web.toddleapp.com";
const captureSource = await readFile(new URL("./capture-dom.js",import.meta.url),"utf8");
type CaptureResult = { scanned: number; truncated: boolean; controls: unknown[]; candidates: {name:string;href:string}[] } | null;
function diagnostic(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/__name is not defined/.test(message)) return "browser-transpiler-helper";
  if (/Execution context was destroyed|Cannot find context|navigation/i.test(message)) return "navigation-during-capture";
  if (/Target.*closed|page.*closed/i.test(message)) return "browser-closed";
  if (/timeout/i.test(message)) return "timeout";
  if (/SyntaxError/i.test(message)) return "browser-script-syntax";
  if (/ReferenceError/i.test(message)) return "browser-reference-error";
  if (/TypeError/i.test(message)) return "browser-type-error";
  if (/EACCES|EPERM|ENOSPC/i.test(message)) return "report-write-error";
  return "unknown-capture-error";
}
const report = { version: 2, mode: auto ? "automatic-bounded" : watch ? "passive-watch" : "guided-read-only", snapshots: [] as unknown[], diagnostics: [] as string[], edges: [] as { from: number; to: number; label: string }[], skipped: { invalid: 0, failed: 0, duplicate: 0, limit: 0 } };
const reportPath = resolve(reportDir,auto ? "toddle-map-auto.json" : watch ? "toddle-map-watch.json" : "toddle-map.json");
let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;

function shape(path: string) {
  return "/" + path.split("/").filter(Boolean).slice(0,30)
    .map(s => routeWords.includes(s.toLowerCase()) ? s.toLowerCase() : ":segment").join("/");
}
async function persist() {
  await writeFile(reportPath, JSON.stringify(report,null,2) + "\n", { encoding:"utf8", mode:0o600 });
}

try {
  console.log(auto ? "Bounded automatic mapper. Use only in approved test/demo environments." : "Read-only guided mapper. Use only in an authorized environment.");
  console.log("It does not click, submit, read network traffic, export screenshots or collect field values.");
  if (!approved) {
    console.log(auto ? "For authorized test/demo environments only, run with --authorized-test-demo." : "For authorized inspection, run with --authorized.");
    process.exitCode = 1;
  } else {
    context = await chromium.launchPersistentContext(resolve(".local","browser-profile"), {headless:false});
    const allowed = new URL(toddleOrigin);
    const existing = context.pages().find(p => {
      try { return new URL(p.url()).origin === allowed.origin; } catch { return false; }
    });
    const startPage = existing ?? context.pages().find(p => p.url() === "about:blank") ?? await context.newPage();
    if (!existing) {
      console.log("Opening Toddle automatically...");
      await startPage.goto(allowed.href,{waitUntil:"domcontentloaded",timeout:30000});
    }
    if (!/^\/platform\/[0-9]{1,18}(?:\/|$)/i.test(new URL(startPage.url()).pathname) || new URL(startPage.url()).origin !== allowed.origin) {
      console.log("Waiting for the approved Toddle overview. Sign in manually if required.");
      await startPage.waitForURL(u => u.origin === allowed.origin && /^\/platform\/[0-9]{1,18}(?:\/|$)/i.test(u.pathname),{timeout:180000});
    }
    console.log("Toddle opened. Origin fixed to "+allowed.origin);
    const pages = () => context!.pages().filter(p => {
      try { return new URL(p.url()).origin === allowed.origin; } catch { return false; }
    });
    // Automatic navigation is limited to known overview routes. No queries,
    // action routes, individual records, messages, or unknown path words.
    const allowedSegments = new Set(["platform","course","courses","home","dashboard","class","classes","classroom","planning","planner","plans","lesson","lessons","lesson-plan","lesson-plans","unit","units","activity","activities","assignment","assignments","announcement","announcements","calendar","resources","teacher","teachers","stream","school","schools","app","learning","assessment","assessments","curriculum","overview","portal","learning-experiences","learning-engagements","class-stream","teacher-portal","classroom-stream","unit-planner","lesson-planner"]);
    let platformScope: string | null = null;
    function safeUrl(raw: string): string | null {
      try {
        const u = new URL(raw);
        if (u.origin !== allowed.origin || u.username || u.password || u.search) return null;
        if (u.hash && !u.hash.startsWith("#/")) return null;
        const platformMatch = u.pathname.match(/^\/platform\/([0-9]{1,18})(?:\/|$)/i);
        if (platformScope && platformMatch && platformMatch[1] !== platformScope) return null;
        if (u.pathname.toLowerCase().startsWith("/platform/") && !platformMatch) return null;
        const segments = (u.pathname + (u.hash ? u.hash.slice(1) : "")).split("/").filter(Boolean);
        if (segments.length > 16 || segments.some(x => !allowedSegments.has(x.toLowerCase()) && !/^(?:[0-9]{1,18}|[a-f0-9]{24}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(x))) return null;
        // Don't traverse individual records: opaque IDs may appear only
        // after explicitly class/school container segments.
        for(let i=0;i<segments.length;i++) {
          if (!allowedSegments.has(segments[i].toLowerCase()) && !["platform","course","courses","class","classes","classroom","school","schools"].includes((segments[i-1]??"").toLowerCase())) return null;
        }
        return u.href;
      } catch { return null; }
    }
    const seen = new Set<string>();
    async function capture(page: import("playwright").Page, category: string) {
      try {
        const url = new URL(page.url());
        const expression = captureSource + "(" + JSON.stringify({approvedOrigin:allowed.origin,labels,routeWords}) + ")";
        const data = await page.evaluate(expression) as CaptureResult;
        if (!data || new URL(page.url()).origin !== allowed.origin || (auto && !safeUrl(page.url()))) { console.log("Origin or route changed; discarded."); return null; }
        const {candidates, ...structure} = data;
        const snapshot = { category, route: shape(url.pathname), fragmentRoute: url.hash.startsWith("#/") ? shape(url.hash.slice(1).split("?")[0]) : null, ...structure };
        const signature = JSON.stringify(snapshot);
        if (watch && seen.has(signature)) return candidates;
        seen.add(signature);
        report.snapshots.push(snapshot);
        await persist();
        console.log("Captured " + data.controls.length + " control signatures. Total: " + report.snapshots.length);
        return candidates;
      } catch (error) { const reason=diagnostic(error); report.diagnostics.push(reason); console.log("Capture failed: "+reason); return null; }
    }
    if (auto) {
      console.log("Automatic mode is for approved test/demo environments with fictitious data only.");
      const page = startPage;
      const startPlatform = new URL(page.url()).pathname.match(/^\/platform\/([0-9]{1,18})(?:\/|$)/i);
      platformScope = startPlatform?.[1] ?? null;
      const initial = safeUrl(page.url());
      if (!initial) throw new Error("Starting route is outside the automatic allowlist. Use guided mode.");
      const max = 30;
      const queue: { url: string; label: string; from: number | null }[] = [{url:initial,label:"Start",from:null}];
      const visited = new Map<string, number>();
      const attempted = new Set<string>();
      while (queue.length && attempted.size < max) {
        const next = queue.shift()!;
        if (attempted.has(next.url)) {
          const id=visited.get(next.url);
          if(id!==undefined && next.from!==null) report.edges.push({from:next.from,to:id,label:next.label});
          report.skipped.duplicate++; continue;
        }
        attempted.add(next.url);
        try {
          if(page.url()!==next.url) await page.goto(next.url,{waitUntil:"domcontentloaded",timeout:20000});
          await page.waitForTimeout(1500);
          if (!safeUrl(page.url())) { report.skipped.invalid++; break; }
          if (!platformScope) platformScope = new URL(page.url()).pathname.match(/^\/platform\/([0-9]{1,18})(?:\/|$)/i)?.[1] ?? null;
          const category = next.label==="Start" ? "home" : "auto";
          let candidates = await capture(page,category);
          if(!candidates && report.diagnostics.at(-1)==="navigation-during-capture" && safeUrl(page.url())) {
            await page.waitForTimeout(1500);
            candidates = await capture(page,category);
          }
          if(!candidates) { report.skipped.failed++; continue; }
          const id=report.snapshots.length-1;
          visited.set(next.url,id);
          if(next.from!==null) report.edges.push({from:next.from,to:id,label:next.label});
          for(const candidate of candidates) {
            const url=safeUrl(candidate.href);
            if(!url) { report.skipped.invalid++; continue; }
            if(queue.length>=300) { report.skipped.limit++; continue; }
            queue.push({url,label:candidate.name,from:id});
          }
          await persist();
          console.log("Automatic progress: "+attempted.size+"/"+max+"; pending "+queue.length);
        } catch { report.skipped.failed++; console.log("Page unavailable; skipped."); }
      }
      report.skipped.limit+=queue.length;
    } else if (watch) {
      console.log("Open an approved overview or empty editor. Avoid individual student records and private conversations.");
      const page=startPage;
      console.log("Navigate manually in the browser. Captures happen automatically. Press Enter in the terminal to finish.");
      let stop=false;
      void terminal.question("").then(()=>{stop=true;},()=>{stop=true;});
      terminal.once("close",()=>{stop=true;});
      while(!stop && !page.isClosed() && report.snapshots.length<100) {
        if(pages().includes(page)) await capture(page,"observed");
        await new Promise(resolve=>setTimeout(resolve,1500));
      }
      if(!stop) terminal.close();
    } else {
      console.log("Navigate manually. Do not enter student or recipient details. Use empty forms or test data.");
      console.log("Categories: " + categories.join(", "));
      console.log("Type a category to capture the current screen; type fim to finish.");
      while(true) {
        const category = (await terminal.question("Capture category: ")).trim().toLowerCase();
        if(category==="fim") break;
        if(!categories.includes(category)) { console.log("Invalid category."); continue; }
        const tabs=pages();
        if(!tabs.length) { console.log("No open page on approved origin."); continue; }
        let page=tabs[tabs.length-1];
        if(tabs.length>1) {
          const selected=Number(await terminal.question("Approved tabs: "+tabs.length+". Choose number: "));
          if(!Number.isInteger(selected)||selected<1||selected>tabs.length) continue;
          page=tabs[selected-1];
        }
        await capture(page,category);
      }
    }
    await persist();
    console.log("Captured screens: " + report.snapshots.length + "; failed: " + report.skipped.failed);
    if (!report.snapshots.length) console.log("WARNING: No screen was captured; this report is diagnostic only.");
    console.log("Report saved to: " + reportPath);
    console.log("Review the JSON locally before sharing. Do not share the browser profile.");
  }
} finally {
  terminal.close();
  await context?.close();
}
