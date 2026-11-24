import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

const categories = ["home","classes","planning","lesson-plan","activities","assignment","announcements","messages","calendar","resources","other"];
const labels = [
  "Home","Dashboard","Classes","Class","Classroom","Planning","Planner","Unit planner",
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
const routeWords = ["home","dashboard","class","classes","classroom","planning","planner","plans","lesson","lessons","lesson-plan","lesson-plans","unit","units","activity","activities","assignment","assignments","announcement","announcements","message","messages","calendar","resources","teacher","teachers","stream","create","new","edit","view","settings","school","schools","app","learning","assessment","assessments","curriculum"];
const reportDir = resolve(".local","reports");
await mkdir(reportDir, { recursive: true });
const terminal = createInterface({ input: process.stdin, output: process.stdout });
const report = { version: 1, mode: "guided-read-only", snapshots: [] as unknown[] };
const reportPath = resolve(reportDir,"toddle-map.json");
let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;

function shape(path: string) {
  return "/" + path.split("/").filter(Boolean).slice(0,30)
    .map(s => routeWords.includes(s.toLowerCase()) ? s.toLowerCase() : ":segment").join("/");
}
async function persist() {
  await writeFile(reportPath, JSON.stringify(report,null,2) + "\n", { encoding:"utf8", mode:0o600 });
}

try {
  console.log("Read-only guided mapper. Use only in an authorized environment.");
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
    console.log("Navigate manually. Do not enter student or recipient details. Use empty forms or test data.");
    console.log("Categories: " + categories.join(", "));
    console.log("Type a category to capture the current screen; type fim to finish.");
    while (true) {
      const category = (await terminal.question("Capture category: ")).trim().toLowerCase();
      if (category === "fim") break;
      if (!categories.includes(category)) { console.log("Invalid category."); continue; }
      const pages = context.pages().filter(p => {
        try { return new URL(p.url()).origin === allowed.origin; } catch { return false; }
      });
      if (!pages.length) { console.log("No open page on approved origin."); continue; }
      let page = pages[pages.length-1];
      if (pages.length > 1) {
        const selected = Number(await terminal.question("Approved tabs: " + pages.length + ". Choose number (1-" + pages.length + "): "));
        if (!Number.isInteger(selected) || selected < 1 || selected > pages.length) continue;
        page = pages[selected-1];
      }
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
          return { scanned: Math.min(nodes.length,4000), truncated: nodes.length > 4000 || counts.size >= 250, controls: [...counts.values()] };
        }, {approvedOrigin:allowed.origin,labels,routeWords});
        if (!data || new URL(page.url()).origin !== allowed.origin) { console.log("Origin changed; discarded."); continue; }
        const snapshot = { category, route: shape(url.pathname), fragmentRoute: url.hash.startsWith("#/") ? shape(url.hash.slice(1).split("?")[0]) : null, ...data };
        report.snapshots.push(snapshot);
        await persist();
        console.log("Captured " + data.controls.length + " control signatures. Total: " + report.snapshots.length);
      } catch { console.log("Capture failed or page changed; retry after navigation."); }
    }
    await persist();
    console.log("Report saved to: " + reportPath);
    console.log("Review the JSON locally before sharing. Do not share the browser profile.");
  }
} finally {
  terminal.close();
  await context?.close();
}
