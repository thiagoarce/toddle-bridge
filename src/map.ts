import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

const categories = ["home","classes","planning","lesson-plan","activities","assignment","announcements","messages","calendar","resources","other"];
const labels = [
  "Courses","My courses","Course","Home","Dashboard","Classes","Class","Classroom","Planning","Planner","Unit planner",
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
const report = { version: 2, mode: auto ? "automatic-bounded" : "guided-read-only", snapshots: [] as unknown[], edges: [] as { from: number; to: number; label: string }[], skipped: { invalid: 0, failed: 0, duplicate: 0, limit: 0 } };
const reportPath = resolve(reportDir,auto ? "toddle-map-auto.json" : "toddle-map.json");
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
  if ((await terminal.question("Confirmed permission to inspect this environment? Type SIM: ")).trim() !== "SIM") {
    console.log("Cancelled.");
  } else {
    context = await chromium.launchPersistentContext(resolve(".local","browser-profile"), {headless:false});
    console.log("Open the approved Toddle page manually in the dedicated browser.");
    const raw = (await terminal.question("Enter approved HTTPS origin (example: https://web.toddleapp.com): ")).trim();
    let allowed: URL;
    try { allowed = new URL(raw); } catch { throw new Error("Invalid origin"); }
    if (allowed.protocol !== "https:" || allowed.username || allowed.password || allowed.pathname !== "/" || allowed.search || allowed.hash) {
      throw new Error("Enter only the HTTPS origin, without path or credentials.");
    }
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
    async function capture(page: import("playwright").Page, category: string) {
      try {
        const url = new URL(page.url());
        const data = await page.evaluate(({approvedOrigin, labels, routeWords}) => {
          if (location.origin !== approvedOrigin) return null;
          const known = new Map(labels.map(s => [s.toLowerCase(),s]));
          const label = (s: string | null | undefined) => {
            if (!s || s.length > 120) return null;
            return known.get(s.trim().replace(/\s+/g," ").toLowerCase()) ?? null;
          };
          const safeRoles = ["button","link","tab","menuitem","textbox","combobox","checkbox","radio","switch","listbox","option","heading","dialog","navigation","main","form","searchbox","spinbutton","grid","table","toolbar","menu","tabpanel"];
          const safeTypes = ["text","search","email","password","date","datetime-local","time","number","checkbox","radio","file","submit","button","reset","hidden","url","tel","range","color","month","week"];
          const safeTags = ["button","a","input","textarea","select","summary","h1","h2","h3","h4","form","nav","main","dialog","table","div","span","section","label"];
          const route = (href: string) => {
            try {
              const u = new URL(href,location.href);
              if (u.origin !== approvedOrigin || u.protocol !== "https:") return null;
              const parts = u.pathname.split("/").filter(Boolean).slice(0,30).map(s => routeWords.includes(s.toLowerCase()) ? s.toLowerCase() : ":segment");
              return "/" + parts.join("/");
            } catch { return null; }
          };
          const implicitRole = (el: Element) => {
            if (el.matches("button,summary,input[type=button],input[type=submit],input[type=reset]")) return "button";
            if (el.matches("a[href]")) return "link";
            if (el.matches("textarea,[contenteditable=true]")) return "textbox";
            if (el.matches("select")) return "combobox";
            if (el.matches("input[type=checkbox]")) return "checkbox";
            if (el.matches("input[type=radio]")) return "radio";
            if (el.matches("input[type=search]")) return "searchbox";
            if (el.matches("input")) return "textbox";
            if (el.matches("h1,h2,h3,h4")) return "heading";
            return "unknown";
          };
          const counts = new Map<string, { control: object; count: number }>();
          const nodes = document.querySelectorAll("button,a[href],input,textarea,select,[role],[contenteditable=true],summary,h1,h2,h3,h4,form,nav,main,dialog,table");
          for (const el of Array.from(nodes).slice(0,4000)) {
            if (!el.getClientRects().length || el.closest("[hidden],[aria-hidden=true]") || getComputedStyle(el).visibility === "hidden") continue;
            const declared = el.getAttribute("role");
            const role = declared && safeRoles.includes(declared) ? declared : implicitRole(el);
            const tag = safeTags.includes(el.localName) ? el.localName : "other";
            const t = el.getAttribute("type");
            const type = t && safeTypes.includes(t) ? t : null;
            if (type === "hidden" || type === "password") continue;
            const assoc = el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement ? Array.from(el.labels ?? []).map(l => label(l.textContent)).find(Boolean) : null;
            const refs = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).slice(0,5).map(id => label(document.getElementById(id)?.textContent)).find(Boolean);
            const name = label(el.getAttribute("aria-label")) ?? refs ?? assoc ?? label(el.getAttribute("placeholder")) ?? label(el.getAttribute("title")) ?? (["button","link","tab","menuitem","heading"].includes(role) ? label(el.textContent) : null) ?? null;
            const control = { tag, role, type, name, required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true", disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true", editable: el.getAttribute("contenteditable") === "true", destination: tag === "a" ? route(el.getAttribute("href") ?? "") : null };
            const key = JSON.stringify(control);
            const entry = counts.get(key);
            if (entry) entry.count++;
            else if (counts.size < 250) counts.set(key,{control,count:1});
          }
          const navigationNames = new Set(["courses","my courses","course","home","dashboard","classes","class","classroom","planning","planner","unit planner","lesson plans","learning experiences","learning engagements","activities","assignments","class stream","stream","announcements","calendar","resources","planejamento","turmas","atividades","avisos","calendário"]);
          const candidates = Array.from(document.querySelectorAll("a[href]")).filter(el => el.getClientRects().length && !el.closest("[hidden],[aria-hidden=true],[download]")).slice(0,500).flatMap(el => {
            const name = label(el.getAttribute("aria-label")) ?? label(el.textContent) ?? label(el.getAttribute("title"));
            const href = el.getAttribute("href");
            if (!name || !href || !navigationNames.has(name.toLowerCase())) return [];
            try { return [{name,href:new URL(href,location.href).href}]; } catch { return []; }
          });
          return { scanned: Math.min(nodes.length,4000), truncated: nodes.length > 4000 || counts.size >= 250, controls: [...counts.values()], candidates };
        }, {approvedOrigin:allowed.origin,labels,routeWords});
        if (!data || new URL(page.url()).origin !== allowed.origin || (auto && !safeUrl(page.url()))) { console.log("Origin or route changed; discarded."); return null; }
        const {candidates, ...structure} = data;
        const snapshot = { category, route: shape(url.pathname), fragmentRoute: url.hash.startsWith("#/") ? shape(url.hash.slice(1).split("?")[0]) : null, ...structure };
        report.snapshots.push(snapshot);
        await persist();
        console.log("Captured " + data.controls.length + " control signatures. Total: " + report.snapshots.length);
        return candidates;
      } catch { console.log("Capture failed or page changed; retry after navigation."); return null; }
    }
    if (auto) {
      console.log("Automatic mode is for approved test/demo environments with fictitious data only.");
      console.log("Open the authorized overview page manually, then return here.");
      if ((await terminal.question("Confirm test/demo scope and permission for automatic navigation? Type SIM: ")).trim() !== "SIM") throw new Error("Cancelled.");
      const tabs = pages();
      if (!tabs.length) throw new Error("Open an approved tab first.");
      const page = tabs[tabs.length-1];
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
          const candidates = await capture(page,category);
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
    console.log("Report saved to: " + reportPath);
    console.log("Review the JSON locally before sharing. Do not share the browser profile.");
  }
} finally {
  terminal.close();
  await context?.close();
}
