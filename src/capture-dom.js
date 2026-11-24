// Raw browser-side expression, read as text to avoid TypeScript transpiler helpers.
(({approvedOrigin, labels, routeWords}) => {
          if (location.origin !== approvedOrigin) return null;
          const known = new Map(labels.map(s => [s.toLowerCase(),s]));
          const label = (s) => {
            if (!s || s.length > 120) return null;
            return known.get(s.trim().replace(/\s+/g," ").toLowerCase()) ?? null;
          };
          const safeRoles = ["button","link","tab","menuitem","textbox","combobox","checkbox","radio","switch","listbox","option","heading","dialog","navigation","main","form","searchbox","spinbutton","grid","table","toolbar","menu","tabpanel"];
          const safeTypes = ["text","search","email","password","date","datetime-local","time","number","checkbox","radio","file","submit","button","reset","hidden","url","tel","range","color","month","week"];
          const safeTags = ["button","a","input","textarea","select","summary","h1","h2","h3","h4","form","nav","main","dialog","table","div","span","section","label"];
          const route = (href) => {
            try {
              const u = new URL(href,location.href);
              if (u.origin !== approvedOrigin || u.protocol !== "https:") return null;
              const parts = u.pathname.split("/").filter(Boolean).slice(0,30).map(s => routeWords.includes(s.toLowerCase()) ? s.toLowerCase() : ":segment");
              return "/" + parts.join("/");
            } catch { return null; }
          };
          const implicitRole = (el) => {
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
          const counts = new Map();
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
            const component = ["ClassCardV2__container","ButtonCard__container","TeacherCoursesV2__container","GlobalMenuTray__iconContainer","GlobalMenuTray__messagingIconContainer"].find(prefix => Array.from(el.classList).some(c=>c===prefix || c.startsWith(prefix+"___"))) ?? null;
            const control = { tag, role, type, name, component, required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true", disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true", editable: el.getAttribute("contenteditable") === "true", destination: tag === "a" ? route(el.getAttribute("href") ?? "") : null };
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
        })
