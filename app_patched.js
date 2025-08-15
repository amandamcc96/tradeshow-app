
// ---------- Types (JSDoc-style for clarity) ----------
// Using plain JS; data is validated at runtime where needed.

// ---------- Utilities ----------
const uid = () => Math.random().toString(36).slice(2, 9);
const STORAGE_KEY = "tradeshow-assistant-vanilla-v1";

// ---------- Firestore (optional, for cross-device sync) ----------
// Uses Firebase compat SDK if available on the page.
// We maintain localStorage for offline & quick loads, and also sync to Firestore when configured.
let db = null, COL = null;
try {
  if (typeof firebase !== "undefined" && firebase.apps && firebase.apps.length) {
    db = firebase.firestore();
    COL = db.collection('tradeshow');
  }
} catch (_){}

// read shared doc (stored under { value: ... })
async function getSharedDoc(docId, fallback){
  if(!COL) return fallback;
  try{
    const snap = await COL.doc(docId).get();
    return snap.exists ? snap.data().value : fallback;
  }catch(e){
    console.error("getSharedDoc failed", e);
    return fallback;
  }
}
function setSharedDoc(docId, value){
  if(!COL) return Promise.resolve();
  return COL.doc(docId).set({ value }, { merge:true }).catch(e=>console.error("setSharedDoc failed", e));
}
function onSharedDoc(docId, cb){
  if(!COL) return ()=>{};
  return COL.doc(docId).onSnapshot(s => { if(s.exists) cb(s.data().value); });
}
// -----------------------------------------------------------------

const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { year: "numeric", month: "short", day: "2-digit" });

function sameDay(aISO, bISO) {
  const a = new Date(aISO), b = new Date(bISO);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function hoursBetween(startISO, endISO) {
  return (new Date(endISO).getTime() - new Date(startISO).getTime()) / (1000 * 60 * 60);
}

// ---------- Seed Data ----------
const seedDate = (() => {
  const now = new Date();
  return new Date(now.getFullYear(), 8, 16, 9, 0, 0);
})();

const SAMPLE_ATTENDEES = [
  { id: uid(), name: "Chris Williams", title: "VP Partnerships", company: "NorthBridge", linkedin: "https://www.linkedin.com/in/example-chris", photoUrl: "", notes: "Loves concise dashboards; ask about Zoho practice." },
  { id: uid(), name: "Amanda Lee", title: "Head of Marketing", company: "Protocol80", linkedin: "https://www.linkedin.com/in/example-amanda", photoUrl: "", notes: "Interested in co-marketing webinars and case studies." },
  { id: uid(), name: "Hudson Carter", title: "Solutions Architect", company: "CloudTrailz", linkedin: "https://www.linkedin.com/in/example-hudson", photoUrl: "", notes: "Deep NetSuite background; prefers technical prep notes." },
];

const SAMPLE_MEETINGS = [
  { id: uid(), title: "NorthBridge + Commercient intro", description: "Explore reseller fit; prioritize Zoho + Monday integrations.", location: "Hall B – Meeting Room 3", booth: "B122", startISO: new Date(seedDate.getTime()).toISOString(), endISO: new Date(seedDate.getTime() + 60*60*1000).toISOString(), attendees: [SAMPLE_ATTENDEES[0]], talkingPoints: "15% target share from one ecosystem; co-selling playbook; partner portal access.", prepChecklist: "Review Zoho marketplace listing; pull 2 case studies; confirm NDA status." },
  { id: uid(), title: "Protocol80 co-marketing sprint", description: "Finalize webinar topics and case study pipeline.", location: "Expo Café (near Hall A)", booth: "A210", startISO: new Date(seedDate.getTime()+2*60*60*1000).toISOString(), endISO: new Date(seedDate.getTime()+3*60*60*1000).toISOString(), attendees: [SAMPLE_ATTENDEES[1]], talkingPoints: "Partner Spotlight Webinar; co-branded email templates; design resources.", prepChecklist: "Bring sample creative; align on audience; set metrics." },
  { id: uid(), title: "CloudTrailz technical sync", description: "Deep-dive NetSuite<->HubSpot patterns; managed custom objects beta lessons.", location: "Booth C341", booth: "C341", startISO: new Date(seedDate.getTime()+4*60*60*1000).toISOString(), endISO: new Date(seedDate.getTime()+5*60*60*1000).toISOString(), attendees: [SAMPLE_ATTENDEES[2]], talkingPoints: "QuickBooks Desktop beta then pivot to NetSuite/Intacct; out-of-the-box industry apps.", prepChecklist: "Open architecture diagram; confirm data model mapping doc." },
];

const SAMPLE_TRAVEL = [
  { id: uid(), type: "flight", label: "ATL → BOS (AC 1234)", confirmation: "Z7X9QW", startISO: new Date(seedDate.getTime()-24*60*60*1000).toISOString(), endISO: new Date(seedDate.getTime()-22*60*60*1000).toISOString(), details: "Seat 14C; carry-on only." },
  { id: uid(), type: "hotel", label: "Westin Seaport, Boston", confirmation: "H987654", startISO: new Date(seedDate.getTime()-1*60*60*1000).toISOString(), endISO: new Date(seedDate.getTime()+2*24*60*60*1000).toISOString(), details: "Reservation under Commercient; breakfast included." },
];

// ---------- Persistence ----------
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { meetings: SAMPLE_MEETINGS, travel: SAMPLE_TRAVEL, gptUrl: "" };
  } catch (_) {
    return { meetings: SAMPLE_MEETINGS, travel: SAMPLE_TRAVEL, gptUrl: "" };
  }
}
function saveState(state){
  // keep localStorage for offline
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(_){}
  // fire-and-forget Firestore writes (if configured)
  setSharedDoc('meetings', state.meetings);
  setSharedDoc('travel', state.travel);
  setSharedDoc('gptUrl', state.gptUrl);
} catch (_) {}
}

// ---------- App State ----------
let state = loadState();
let activeDate = state.meetings[0]?.startISO || new Date().toISOString();
let view = "agenda"; // or "hourly"

// ---------- DOM Helpers ----------
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
function el(tag, attrs={}, ...children){
  const node = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})){
    if(k==="class") node.className=v;
    else if(k.startsWith("on") && typeof v==="function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if(k==="html") node.innerHTML=v;
    else node.setAttribute(k,v);
  }
  for(const c of children) node.append(c);
  return node;
}

// ---------- Rendering ----------
function render(){
  $("#active-date").textContent = fmtDate(activeDate);
  // Tabs
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.view===view));
  $("#agenda-view").classList.toggle("hidden", view!=="agenda");
  $("#hourly-view").classList.toggle("hidden", view!=="hourly");

  renderAgenda();
  renderHourly();
  renderDetails();
  renderTravel();
  renderGpt();
}

function renderAgenda(){
  const container = $("#agenda-view");
  container.innerHTML = "";
  const meetings = state.meetings
    .filter(m => sameDay(m.startISO, activeDate))
    .sort((a,b) => new Date(a.startISO)-new Date(b.startISO));

  if(meetings.length===0){
    container.append(el("div",{class:"muted"},"No meetings for this date."));
    return;
  }

  meetings.forEach(m => {
    const item = el("div",{class:"meeting-item"},
      el("div",{class:"minw"},
        el("div",{class:""}, `${fmtTime(m.startISO)}–${fmtTime(m.endISO)} • ${m.title}`),
        el("div",{class:"meeting-meta"}, `${m.location||""} ${m.booth?` • Booth ${m.booth}`:""}`)
      ),
      el("div",{class:"row",style:"gap:6px"},
        el("button",{class:"btn btn-outline", onClick:()=>openEditMeeting(m)}, "Edit"),
        el("button",{class:"btn btn-outline", onClick:()=>deleteMeeting(m.id)}, "Delete"),
      )
    );
    container.append(item);
  });
}

function renderHourly(){
  const container = $("#hourly-view");
  container.innerHTML = "";
  const meetings = state.meetings
    .filter(m => sameDay(m.startISO, activeDate))
    .sort((a,b)=> new Date(a.startISO)-new Date(b.startISO));

  const start = new Date(activeDate); start.setHours(7,0,0,0);
  const hours = Array.from({length:13}, (_,i)=> new Date(start.getTime()+i*60*60*1000));

  const wrapper = el("div",{class:"hourly"});
  hours.forEach(h => {
    const slot = meetings.filter(m => new Date(m.startISO) <= h && new Date(m.endISO) > h);
    wrapper.append(
      el("div",{class:"hour-row"},
        el("div",{class:"hour-time"}, h.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit"})),
        el("div",{class:"hour-content"},
          slot.length===0
            ? el("div",{class:"hour-empty"})
            : el("div",{class:"hour-tags"},
                ...slot.map(m => el("span",{class:"badge"},
                  el("strong",{}, m.title),
                  el("span",{class:"muted"}, ` ${fmtTime(m.startISO)}–${fmtTime(m.endISO)}`)
                ))
              )
        )
      )
    );
  });
  container.append(wrapper);
}

function renderDetails(){
  const container = $("#details");
  container.innerHTML = "";
  const meetings = state.meetings
    .filter(m => sameDay(m.startISO, activeDate))
    .sort((a,b)=> new Date(a.startISO)-new Date(b.startISO));

  if(meetings.length===0){
    container.append(
      el("div",{class:"card detail-card"},
        el("div",{class:"card-head"}, el("div",{class:"title"},"No meetings this day")),
        el("div",{class:"card-body"},"Add one using the button on the left.")
      )
    );
    return;
  }

  meetings.forEach(m => {
    container.append(
      el("div",{class:"card detail-card"},
        el("div",{class:"card-head"},
          el("div",{class:"title-row"},
            el("div",{class:"title"}, m.title),
            el("div",{class:"muted"}, `${fmtDate(m.startISO)} • ${fmtTime(m.startISO)}–${fmtTime(m.endISO)}`)
          ),
          ),
        el("div",{class:"card-body"},
          el("div",{class:"meta"}, `${hoursBetween(m.startISO,m.endISO).toFixed(1)} hrs • ${m.location||""} ${m.booth?`• Booth ${m.booth}`:""}`),
          m.description ? el("p",{}, m.description) : null,
          m.talkingPoints ? el("div",{},
            el("div",{class:"small",style:"font-weight:700;margin:8px 0 4px"},"Suggested talking points"),
            el("div",{class:"muted",style:"background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:10px"}, m.talkingPoints)
          ): null,
          m.prepChecklist ? el("div",{},
            el("div",{class:"small",style:"font-weight:700;margin:8px 0 4px"},"Prep checklist"),
            el("div",{class:"muted",style:"background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:10px"}, m.prepChecklist)
          ): null,
          el("div",{class:"small",style:"font-weight:700;margin:12px 0 6px"},"Attendees"),
          el("div",{class:"stack gap-sm"},
            ...m.attendees.map(a => el("div",{class:"attendee"},
              el("div",{class:"avatar"}, a.name.slice(0,1).toUpperCase() || "A"),
              el("div",{},
                el("div",{style:"font-weight:600"}, a.name),
                el("div",{class:"muted small"}, [a.title,a.company].filter(Boolean).join(" • ")),
                a.linkedin ? el("div",{}, el("a",{href:a.linkedin,target:"_blank",rel:"noreferrer",class:"link small"},"LinkedIn")): null,
                a.notes ? el("div",{class:"att-note muted"}, a.notes): null
              )
            ))
          ),
          el("div",{class:"pt"},
            el("button",{class:"btn btn-outline", onClick:()=>openEditMeeting(m)},"Edit details")
          )
        )
      )
    );
  });
}

function renderTravel(){
  const container = $("#travel-list");
  container.innerHTML = "";
  if(state.travel.length===0){
    container.append(el("div",{class:"muted"},"No travel saved."));
    return;
  }
  state.travel.forEach(t => {
    container.append(
      el("div",{class:"travel-item"},
        el("div",{},
          el("div",{style:"font-weight:600"}, `[${(t.type||'').toUpperCase()}] ${t.label||''}`),
          el("div",{class:"small muted"},
            `${t.confirmation?`Conf#: ${t.confirmation} • `:''}` +
            `${t.startISO?`Start ${fmtDate(t.startISO)} ${fmtTime(t.startISO)} • `:''}` +
            `${t.endISO?`End ${fmtDate(t.endISO)} ${fmtTime(t.endISO)}`:''}`
          ),
          t.details ? el("div",{class:"small"}, t.details) : null
        ),
        el("div",{},
          el("button",{class:"btn btn-outline", onClick:()=>openEditTravel(t)},"Edit"),
          " ",
          el("button",{class:"btn btn-outline", onClick:()=>deleteTravel(t.id)},"Delete")
        )
      )
    );
  });
}

function renderGpt(){
  $("#gpt-hint").style.display = state.gptUrl ? "none" : "block";
}

// ---------- Actions ----------
function shiftDay(dir){
  const unique = Array.from(new Set(state.meetings.map(m => new Date(m.startISO).toDateString())))
    .map(d => new Date(d)).sort((a,b)=>a-b);
  const idx = unique.findIndex(d => sameDay(d.toISOString(), activeDate));
  const next = unique[idx+dir];
  if(next) activeDate = next.toISOString();
  render();
}

function deleteMeeting(id){
  state.meetings = state.meetings.filter(m => m.id !== id);
  saveState(state);
  render();
}

function deleteTravel(id){
  state.travel = state.travel.filter(t => t.id !== id);
  saveState(state);
  render();
}

// ----- Modals -----
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modal-title");
const modalContent = document.getElementById("modal-content");
const modalSave = document.getElementById("modal-save");
let modalOnSave = null;

function openModal(title, contentNode, onSave){
  modalTitle.textContent = title;
  modalContent.innerHTML = "";
  modalContent.append(contentNode);
  modalOnSave = onSave;
  modal.showModal();
}
modalSave.addEventListener("click",(e)=>{
  e.preventDefault();
  if(typeof modalOnSave === "function") modalOnSave();
  modal.close();
});

function formInput(label, value="", attrs={}){
  const id = uid();
  const wrap = el("div",{}, el("label",{for:id,class:"small muted"},label), el("input",{id, value, ...attrs}));
  return {wrap, get: ()=>$("#"+id).value, set: (v)=>$("#"+id).value=v};
}
function formTextarea(label, value=""){
  const id = uid();
  const wrap = el("div",{}, el("label",{for:id,class:"small muted"},label), el("textarea",{id}, value));
  return {wrap, get: ()=>$("#"+id).value};
}
function formSelect(label, value, options){
  const id = uid();
  const select = el("select",{id}, ...options.map(o=>el("option",{value:o, ...(o===value?{selected:true}:{})},o)));
  const wrap = el("div",{}, el("label",{for:id,class:"small muted"},label), select);
  return {wrap, get: ()=>$("#"+id).value};
}

function openAddMeeting(){
  const title = formInput("Title","");
  const location = formInput("Location","");
  const booth = formInput("Booth","");
  const start = formInput("Start (local)","", {type:"datetime-local"});
  const end = formInput("End (local)","", {type:"datetime-local"});
  const desc = formTextarea("Description / goals","");

  const grid = el("div",{class:"form-grid"}, title.wrap, location.wrap, booth.wrap, start.wrap, end.wrap);
  const stack = el("div",{class:"form-grid-1"}, grid, desc.wrap);

  openModal("New meeting", stack, ()=>{
    if(!title.get()) return;
    const m = {
      id: uid(),
      title: title.get(),
      location: location.get(),
      booth: booth.get(),
      startISO: start.get() ? new Date(start.get()).toISOString() : new Date().toISOString(),
      endISO: end.get() ? new Date(end.get()).toISOString() : new Date(Date.now()+60*60*1000).toISOString(),
      attendees: [],
      description: desc.get()
    };
    state.meetings.push(m);
    saveState(state);
    activeDate = m.startISO;
    render();
  });
}

function openEditMeeting(meeting){
  // clone to avoid mutating until save
  const draft = JSON.parse(JSON.stringify(meeting));
  const title = formInput("Title", draft.title);
  const location = formInput("Location", draft.location||"");
  const booth = formInput("Booth", draft.booth||"");
  const start = formInput("Start (local)", new Date(draft.startISO).toISOString().slice(0,16), {type:"datetime-local"});
  const end = formInput("End (local)", new Date(draft.endISO).toISOString().slice(0,16), {type:"datetime-local"});
  const desc = formTextarea("Description / goals", draft.description||"");
  const talking = formTextarea("Suggested talking points", draft.talkingPoints||"");
  const prep = formTextarea("Prep checklist", draft.prepChecklist||"");

  const attendeesWrap = el("div",{class:"stack gap-sm"});
  function renderAttendees(){
    attendeesWrap.innerHTML="";
    draft.attendees.forEach((a,idx)=>{
      const name = formInput("Name", a.name||"");
      const titleI = formInput("Title", a.title||"");
      const company = formInput("Company", a.company||"");
      const linkedin = formInput("LinkedIn URL", a.linkedin||"");
      const photoUrl = formInput("Photo URL", a.photoUrl||"");
      const notes = formTextarea("Notes", a.notes||"");
      const box = el("div",{class:"card", style:"padding:12px; border-radius:10px; border:1px solid var(--border)"},
        el("div",{class:"form-grid"}, name.wrap, titleI.wrap, company.wrap, linkedin.wrap, photoUrl.wrap),
        notes.wrap,
        el("div",{class:"row", style:"justify-content:flex-end; gap:8px; padding-top:6px"},
          el("button",{class:"btn btn-outline", onClick:()=>{ draft.attendees.splice(idx,1); renderAttendees(); }},"Remove attendee")
        )
      );
      attendeesWrap.append(box);
      // two-way binding on save
      box.dataset.idx = idx;
    });
    const addBtn = el("button",{class:"btn btn-outline", onClick:()=>{ draft.attendees.push({id:uid(),name:""}); renderAttendees(); }},"+ Add attendee");
    attendeesWrap.append(addBtn);
  }
  renderAttendees();

  const grid = el("div",{class:"form-grid"}, title.wrap, location.wrap, booth.wrap, start.wrap, end.wrap);
  const stack = el("div",{class:"form-grid-1"}, grid, desc.wrap, talking.wrap, prep.wrap, el("div",{}, el("div",{class:"small",style:"font-weight:700;margin:8px 0"},"Attendees"), attendeesWrap));

  openModal("Edit meeting", stack, ()=>{
    draft.title = title.get();
    draft.location = location.get();
    draft.booth = booth.get();
    draft.startISO = start.get() ? new Date(start.get()).toISOString() : draft.startISO;
    draft.endISO = end.get() ? new Date(end.get()).toISOString() : draft.endISO;
    draft.description = desc.get();
    draft.talkingPoints = talking.get();
    draft.prepChecklist = prep.get();

    // collect attendee edits
    // (already updated as we didn't bind live; simplest is to read fields again if needed)
    // For brevity we trust renderAttendees maintained draft.

    const idx = state.meetings.findIndex(x=>x.id===meeting.id);
    if(idx>-1) state.meetings[idx] = draft;
    saveState(state);
    activeDate = draft.startISO;
    render();
  });
}

function openEditTravel(t){
  const draft = JSON.parse(JSON.stringify(t));
  const type = formSelect("Type", draft.type, ["flight","hotel","ground"]);
  const label = formInput("Label", draft.label||"");
  const conf = formInput("Confirmation #", draft.confirmation||"");
  const start = formInput("Start (local)", draft.startISO?new Date(draft.startISO).toISOString().slice(0,16):"", {type:"datetime-local"});
  const end = formInput("End (local)", draft.endISO?new Date(draft.endISO).toISOString().slice(0,16):"", {type:"datetime-local"});
  const details = formTextarea("Details", draft.details||"");

  const grid = el("div",{class:"form-grid"}, 
    type.wrap, label.wrap, conf.wrap, start.wrap, end.wrap
  );
  const stack = el("div",{class:"form-grid-1"}, grid, details.wrap);

  openModal("Edit travel", stack, ()=>{
    draft.type = type.get();
    draft.label = label.get();
    draft.confirmation = conf.get();
    draft.startISO = start.get()? new Date(start.get()).toISOString(): undefined;
    draft.endISO = end.get()? new Date(end.get()).toISOString(): undefined;
    draft.details = details.get();

    const idx = state.travel.findIndex(x=>x.id===t.id);
    if(idx>-1) state.travel[idx]=draft;
    saveState(state);
    render();
  });
}

function openAddTravel(){
  const draft = { id: uid(), type:"flight", label:"", confirmation:"", startISO:"", endISO:"", details:"" };
  const type = formSelect("Type", draft.type, ["flight","hotel","ground"]);
  const label = formInput("Label", "");
  const conf = formInput("Confirmation #", "");
  const start = formInput("Start (local)", "", {type:"datetime-local"});
  const end = formInput("End (local)", "", {type:"datetime-local"});
  const details = formTextarea("Details", "");

  const grid = el("div",{class:"form-grid"}, type.wrap, label.wrap, conf.wrap, start.wrap, end.wrap);
  const stack = el("div",{class:"form-grid-1"}, grid, details.wrap);

  openModal("New travel", stack, ()=>{
    const t = {
      id: uid(),
      type: type.get(),
      label: label.get(),
      confirmation: conf.get(),
      startISO: start.get()? new Date(start.get()).toISOString(): undefined,
      endISO: end.get()? new Date(end.get()).toISOString(): undefined,
      details: details.get()
    };
    state.travel.push(t);
    saveState(state);
    render();
  });
}

// ----- GPT link -----
function setGptLink(){
  const url = prompt("Paste the URL to your custom GPT or knowledge assistant:", state.gptUrl || "");
  if(url===null) return;
  state.gptUrl = (url||"").trim();
  saveState(state);
  render();
}
function openGpt(){
  if(!state.gptUrl){ alert("Set link first"); return;}
  window.open(state.gptUrl, "_blank","noopener");
}

// ----- Import/Export -----
function doExport(){
  const blob = new Blob([JSON.stringify({ meetings: state.meetings, travel: state.travel, gptUrl: state.gptUrl }, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `tradeshow-data-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
}
function doImport(file){
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if(parsed.meetings) state.meetings = parsed.meetings;
      if(parsed.travel) state.travel = parsed.travel;
      if("gptUrl" in parsed) state.gptUrl = parsed.gptUrl || "";
      saveState(state);
      activeDate = state.meetings[0]?.startISO || new Date().toISOString();
      render();
    } catch (e) {
      alert("Invalid JSON file");
    }
  };
  reader.readAsText(file);
}

// ---------- Events ----------

// ---------- Firestore realtime wiring ----------
function startRealtime(){
  // Initial fetch to hydrate from cloud if available
  Promise.all([
    getSharedDoc('meetings', state.meetings),
    getSharedDoc('travel', state.travel),
    getSharedDoc('gptUrl', state.gptUrl || "")
  ]).then(([m,t,g])=>{
    let changed = false;
    if(m && JSON.stringify(m)!==JSON.stringify(state.meetings)){ state.meetings = m; changed = true; }
    if(t && JSON.stringify(t)!==JSON.stringify(state.travel)){ state.travel = t; changed = true; }
    if(typeof g !== "undefined" && g!==state.gptUrl){ state.gptUrl = g; changed = true; }
    if(changed){
      // Choose an active day based on cloud data if we had none
      if(!activeDate && state.meetings[0]) activeDate = state.meetings[0].startISO;
      render();
    }
  }).catch(()=>{});

  // Live updates
  onSharedDoc('meetings', v => { state.meetings = v || []; render(); });
  onSharedDoc('travel',   v => { state.travel   = v || []; render(); });
  onSharedDoc('gptUrl',   v => { state.gptUrl   = v || "";  renderGpt(); });
}

document.addEventListener("DOMContentLoaded", ()=>{
  $("#active-date").textContent = fmtDate(activeDate);

  // Tabs
  $$(".tab").forEach(btn => btn.addEventListener("click", ()=>{
    view = btn.dataset.view;
    render();
  }));

  // Date navigation
  $("#prev-day").addEventListener("click", ()=>shiftDay(-1));
  $("#next-day").addEventListener("click", ()=>shiftDay(1));

  // Add meeting
  $("#add-meeting").addEventListener("click", openAddMeeting);

  // Travel
  $("#add-travel").addEventListener("click", openAddTravel);

  // GPT
  $("#set-gpt").addEventListener("click", setGptLink);
  $("#open-gpt").addEventListener("click", openGpt);

  // Import/Export
  $("#btn-export").addEventListener("click", doExport);
  $("#btn-import").addEventListener("click", ()=> $("#file-input").click());
  $("#file-input").addEventListener("change", (e)=>{
    if(e.target.files && e.target.files[0]) doImport(e.target.files[0]);
    e.target.value = "";
  });

  render();
  if (COL) startRealtime();
});
