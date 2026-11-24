// Browser-side rendered-text discovery. No screenshots, field values or raw page text are exported.
(({selector, knownLabels}) => {
  const known=new Map(knownLabels.map(s=>[s.toLowerCase(),s]));
  const words=new Set(("unit units lesson lessons learning teaching curriculum scope sequence planning planner plan plans weekly daily yearly term overview class classroom course courses school library resources resource materials material assignments assignment activities activity announcements announcement calendar timetable journal stream assessment assessments task tasks engagements engagement experiences experience goals objectives standards outcomes content module modules topic topics schedule scheduled drafts draft published upcoming past previous current all my view list grid week day month timeline details summary instructions attachments files filter search create new add select type category categories options menu more next back tabs tabsheet general settings and of for the by to from in on manage manager management policies policy documents document templates template").split(" "));
  const unsafe=/\b(?:delete|remove|publish|unpublish|send|submit|save|archive|restore|approve|reject|grade|grades|gradebook|student|students|parent|parents|messaging|messages|message|behaviour|behavior|invite|logout|sign out|upload|download|edit|duplicate|copy|settings)\b/i;
  const normalize=s=>(s??"").replace(/\s+/g," ").trim();
  function classify(raw){
    const text=normalize(raw).replace(/^(create|add|new)\s+(?:a|an)\s+/i,"$1 ").replace(/^(create|add)\s+new\s+/i,"$1 ");
    if(!text||text.length>64||unsafe.test(text))return null;
    const lower=text.toLowerCase();
    if(known.has(lower))return known.get(lower);
    if(!/^[a-zA-Z ]+$/.test(text))return null;
    const ts=lower.split(" ");
    if(ts.length>6||!ts.every(t=>words.has(t)))return null;
    if(!ts.some(t=>/^(?:unit|units|lesson|lessons|learning|teaching|curriculum|planning|planner|plan|plans|classroom|course|courses|library|resources|assignments|assignment|activities|activity|announcements|announcement|calendar|timetable|journal|stream|assessment|assessments|tasks|task|drafts|scheduled|published|view|templates|template)$/.test(t)))return null;
    return text;
  }
  const nodes=Array.from(document.querySelectorAll(selector));
  const visible=el=>{
    const r=el.getBoundingClientRect(),style=getComputedStyle(el);
    return r.width>0&&r.height>0&&style.visibility==="visible"&&style.display!=="none"&&!el.closest("[hidden],[aria-hidden=true],[inert]");
  };
  const dialogs=Array.from(document.querySelectorAll('[role=dialog],dialog[open]')).filter(visible);
  const menus=Array.from(document.querySelectorAll('[role=menu]')).filter(visible);
  const result=[];
  for(let index=0;index<Math.min(nodes.length,4000);index++){
    const el=nodes[index];
    if(!visible(el)||el.matches(":disabled,[aria-disabled=true],input[type=submit],input[type=reset],input[type=file],a[download]")||el.closest('[contenteditable=true]'))continue;
    if(el instanceof HTMLButtonElement&&el.form&&el.type!=="button")continue;
    const menu=el.closest("[role=menu]");
    if(menus.length&&!menus.some(m=>m.contains(el)))continue;
    if(!menus.length&&dialogs.length&&!dialogs.some(d=>d.contains(el)))continue;
    if(el.matches('[aria-selected=true],[aria-current=page],input[type=radio]:checked'))continue;
    const nav=el.closest('nav,[role=navigation],[role=tablist],[role=menu],[role=menubar]');
    const dialog=el.closest('[role=dialog],dialog[open]');
    const semantic=el.matches('button,a[href],[role=button],[role=link],[role=tab],[role=menuitem],summary,input[type=radio]');
    if(!semantic&&(!nav&&!dialog||getComputedStyle(el).cursor!=="pointer"))continue;
    // The nearest actionable ancestor owns a nested text label.
    if(!semantic&&el.parentElement?.closest('button,a[href],[role=button],[role=link],[role=tab],[role=menuitem],summary'))continue;
    const aria=el.getAttribute("aria-label"),title=el.getAttribute("title");
    const text=el instanceof HTMLElement?el.innerText:el.textContent;
    const referenced=(el.getAttribute("aria-labelledby")??"").split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent??"").join(" ");
    const description=el.getAttribute("data-tooltip-content")??el.getAttribute("data-tooltip");
    const childLabels=Array.from(el.querySelectorAll("[aria-label],[title]")).slice(0,8).flatMap(c=>[c.getAttribute("aria-label"),c.getAttribute("title")]);
    const own=Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join(" ");
    const label=[aria,referenced,title,description,own,text,el.textContent,...childLabels].map(classify).find(Boolean);
    if(!label||/^(?:home|calendar|back|next|more|menu|options|search|filter)$/i.test(label))continue;
    const opener=/^(?:create|new|add)(?:\s|$)/i.test(label);
    if(opener&&!/^(?:create|new|add)(?: (?:unit|unit plan|lesson|activity|assignment|announcement|lesson plan|learning experience|learning engagement|assessment|task|resource))?$/i.test(label))continue;
    if(!semantic&&!nav&&!dialog)continue;
    const r=el.getBoundingClientRect();
    const region=menu?"menu":dialog?"dialog":nav?"navigation":"body";
    result.push({index,label,region,opener,x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)});
  }
  // Prefer explicit navigation regions. Ambiguous repeated names are not clicked by index alone.
  const grouped=new Map();
  for(const item of result){
    const key=item.region+"|"+item.label.toLowerCase();
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(item);
  }
  return [...grouped.values()].filter(g=>g.length===1).map(g=>g[0]).sort((a,b)=>Number(b.region==="dialog")-Number(a.region==="dialog")||Number(b.region==="navigation")-Number(a.region==="navigation")||a.y-b.y||a.x-b.x).slice(0,60);
})
