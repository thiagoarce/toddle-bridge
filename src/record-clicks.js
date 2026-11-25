// Passive browser-side observer. Never records typed text, field values, screenshots,
// arbitrary labels, network contents, cookies or credentials. Never clicks.
(({labels,routeWords,capture})=>{
  if(window.top!==window || location.origin!=="https://web.toddleapp.com")return;
  if(window.__toddleRecorderInstalled)return;
  window.__toddleRecorderInstalled=true;
  const known=new Map(labels.map(s=>[s.toLowerCase(),s]));
  const normalize=s=>(s??"").trim().replace(/\s+/g," ");
  const named=s=>known.get(normalize(s).toLowerCase())??null;
  const semantic="button,a[href],[role=button],[role=link],[role=tab],[role=menuitem],summary,label,input[type=radio],input[type=checkbox]";
  const excluded="textarea,select,[contenteditable=true],input:not([type=radio]):not([type=checkbox]):not([type=button]):not([type=submit])";
  const components=["ClassCardV2__container","ButtonCard__container","GlobalMenuTray__iconContainer"];
  const scope=()=>/^\/platform\/[0-9]+(?:\/|$)/.test(location.pathname)&&!/(?:^|\/)(?:students?|grades|gradebook|reports|progress-reports|behaviour|behavior)(?:\/|$)/i.test(location.pathname);
  const component=el=>components.find(c=>Array.from(el.classList??[]).some(x=>x===c||x.startsWith(c+"___")))??null;
  function getLabel(el){
    const refs=(el.getAttribute("aria-labelledby")??"").split(/\s+/).slice(0,5).map(id=>document.getElementById(id)?.textContent);
    const children=Array.from(el.querySelectorAll("span,strong,[role=heading]")).slice(0,12).map(n=>n.textContent);
    return [el.getAttribute("aria-label"),el.getAttribute("title"),...refs,el.innerText,...children].map(named).find(Boolean)??null;
  }
  document.addEventListener("click",event=>{
    if(!event.isTrusted||!scope()||event.button!==0)return;
    const target=event.target instanceof Element?event.target:null;
    if(!target||target.closest(excluded))return;
    let el=target.closest(semantic);
    // Custom React navigation may lack ARIA roles. Only record a recognized label.
    if(!el){
      for(let n=target;n&&n!==document.body;n=n.parentElement){
        if(getComputedStyle(n).cursor==="pointer"&&getLabel(n)){el=n;break;}
      }
    }
    if(!el||el.closest(excluded))return;
    const tag=["div","span","button","a","input","label","summary","li"].includes(el.localName)?el.localName:"other";
    const declared=el.getAttribute("role");
    const role=["button","link","tab","menuitem","radio","checkbox","option"].includes(declared)?declared:tag==="button"?"button":tag==="a"?"link":tag==="input"?"input":"unknown";
    const rect=el.getBoundingClientRect();
    const region=el.closest("[role=menu]")?"menu":el.closest("[role=dialog],dialog")?"dialog":el.closest("nav,[role=navigation],[role=tablist]")?"navigation":"body";
    const comp=component(el);
    const peers=comp?Array.from(document.querySelectorAll("[class]")).filter(n=>component(n)===comp):[];
    const action={label:getLabel(el),tag,role,component:comp,ordinal:comp?peers.indexOf(el):null,region,box:[rect.x,rect.y,rect.width,rect.height].map(Math.round)};
    try{
      const state=capture({approvedOrigin:location.origin,labels,routeWords});
      if(!state)return;
      const {controls,scanned,truncated}=state;
      // Path is sent to the local Node process only. It is masked before persistence.
      void window.__toddleRecordClick({path:location.pathname,action,structure:{controls,scanned,truncated}}).catch(()=>{});
    }catch{}
  },true);
})
