"use strict";

/* =====================================================================
   DATA
   ===================================================================== */
const rg = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// Module names per subject
const NM = {
  R: ["Mechanics of breathing","Compliance, surfactant & airway resistance","Lung volumes & ventilation","Pulmonary circulation & V/Q","Gas exchange","O₂ & CO₂ transport","Control of breathing","Respiratory insufficiency","High altitude & diving"],
  G: ["Gut wall & GI smooth muscle","Nervous & hormonal control","Splanchnic circulation","Motility I: mouth to stomach","Motility II: intestine to anus","Secretion I: saliva & gastric","Secretion II: pancreas, bile, intestine","Digestion & absorption","GI disorders"],
  N: ["Organisation of the NS & neurons","Membrane & resting potential","Action potential & conduction","Synapses & transmitters","Neuromuscular junction","Skeletal, smooth & cardiac muscle","Sensory receptors & coding","Somatic sensation","Pain & thermal sensation","Spinal cord & reflexes","Motor cortex & posture","Brainstem, cranial nerves, thalamus","Cerebellum & basal ganglia","Cortex, language & intellect","Memory, limbic system & hypothalamus","Sleep, EEG & epilepsy","CSF, BBB & cerebral blood flow","Autonomic nervous system","Vision I: optics","Vision II: retina & pathways","Hearing & balance","Taste & smell"],
  E: ["Introduction","Experimental embryology","Cell division & gametogenesis","Chromosomes & karyotyping","Chromosomal & genetic disorders","Molecular biology in medicine","Molecular regulation & induction","Female cycles & gamete transport","Fertilization & contraception","Week 1: cleavage to implantation","Week 2: bilaminar disc & ectopics","Week 3 I: gastrulation & axes","Week 3 II: neurulation & somites","Weeks 4–8: folding & external form","Body cavities & diaphragm","Fetal period & growth","Placenta & decidua","Membranes, liquor & cord","Twins & parturition","Teratology I: principles","Teratology II: teratogens","Prenatal diagnosis & fetal therapy"],
  H: ["Microscopy & tissue prep","Cell I: theory & history","Cell II: differentiation & stem cells","Cell III: plasma membrane","Cell IV: organelles & nucleus","Cell V: cycle, mitosis & apoptosis","Epithelium I: features","Epithelium II: classification & glands","Connective tissue I: cells","Connective tissue II: fibres & matrix","Muscle I: skeletal","Muscle II: cardiac & smooth","Nerve tissue I: neurons","Nerve tissue II: glia & nerves","Cartilage","Bone I: structure","Bone II: ossification & repair","Blood I: plasma & red cells","Blood II: WBC & platelets","Haemopoiesis","Immune system I","Immune system II: lymphoid organs"]
};
const SUB = { R: "Respiratory", G: "GIT", N: "Neuro", E: "Embryology", H: "Histology" };
const COL = { R: "#0ea5e9", G: "#f59e0b", N: "#8b5cf6", E: "#ec4899", H: "#10b981" };

// f/b/e = histology reading order (h); q follows a separate question-based plan (QD)
const PPL = {
  f: { n: "Oluwafunmilola", h: [...rg(11, 22), ...rg(1, 10)] },
  b: { n: "Barnabas",       h: [...rg(7, 22),  ...rg(1, 6)] },
  e: { n: "Eniola",         h: [...rg(7, 22),  ...rg(1, 6)] },
  q: { n: "Abdulquddus" }
};
const PEOPLE = ["f", "b", "e", "q"];

// [date, tag, physiology, embryology, histology count, CA1 revision?]
const D = [
  ["2026-10-20", "No classes",                          ["G1","G2","R1"],      ["E10","E11"], 1, 1],
  ["2026-10-21", "",                                    ["G3","G4","R2"],      ["E12","E13"], 2, 1],
  ["2026-10-22", "Last day before CA1",                 ["G5","G6","R3"],      ["E14","E15"], 1, 1],
  ["2026-10-23", "Anatomy CA1 today",                   ["G7","R4"],           ["E16"],       0, 0],
  ["2026-10-24", "",                                    ["G8","G9","R5","N1"], ["E17","E18"], 1, 0],
  ["2026-10-25", "Sunday: light day",                   ["R6","N2"],           ["E19"],       1, 0],
  ["2026-10-26", "No classes: catch-up day",            ["N3","N4","N5","R7"], ["E20","E21"], 3, 0],
  ["2026-10-27", "No classes: catch-up day",            ["N6","N7","N8","R8"], ["E22","E1"],  3, 0],
  ["2026-10-28", "",                                    ["N9","N10","N11"],    ["E2","E3"],   2, 0],
  ["2026-10-29", "",                                    ["N12","N13","N14","R9"], ["E4"],     2, 0],
  ["2026-10-30", "",                                    ["N15","N16","N17"],   ["E5","E6"],   2, 0],
  ["2026-10-31", "",                                    ["N18","N19","N20"],   ["E7","E8"],   3, 0],
  ["2026-11-01", "Sunday: light day · last reading day",["N21","N22"],         ["E9"],        1, 0]
];

// Abdulquddus' plan: [date, physiology question sets, anatomy question sets]
const QD = [
  ["2026-10-20", ["R4","R5","G5"],                 ["E15","HA1"]],
  ["2026-10-21", ["G6","G7","R6","N1"],            ["E17","E18","HA2"]],
  ["2026-10-22", ["G8","G9","R7","N2"],            ["E19","E20","HA3"]],
  ["2026-10-23", ["G10","N3"],                     ["E21"]],
  ["2026-10-24", ["R8"],                           ["E22"]],
  ["2026-10-25", ["G11","G12","N4","N5"],          ["E1","HB1"]],
  ["2026-10-26", ["G13","R9","N6","N7"],           ["E2","E3","HB2","HB3"]],
  ["2026-10-27", ["G14","G15","R10","N8","N9"],    ["E4","HC1","HC2"]],
  ["2026-10-28", ["R11","N10","N11","N12","N13"],  ["E5","HC3"]],
  ["2026-10-29", ["R12","N14","N15","N16","N17"],  ["E6","HD1"]],
  ["2026-10-30", ["R13","N18","N19","N20","N21"],  ["E7","HD2"]],
  ["2026-10-31", ["R14"],                          ["HD3"]],
  ["2026-11-01", ["N22","N23","N24","N25"],        []]
];

// Names of Abdulquddus' question sets
const QN = {};
[
  ["R", 4, ["Lung volumes, capacities & spirometry","Pulmonary ventilation & dead space","Gas exchange & diffusion","V/Q ratio & alveolar air","Transport of oxygen","Transport of CO₂ & acid–base","Neural control of respiration","Chemical control of respiration","Applied I: hypoxia, cyanosis, altitude","Applied II: diving & exercise","Applied III: PFTs & CPR"]],
  ["G", 5, ["Gastric motility, emptying & vomiting","Exocrine pancreas","Liver & biliary system","Small intestine","Carbohydrate digestion & absorption","Protein digestion & absorption","Fat digestion & absorption","Water, electrolyte, mineral & vitamin absorption","Large intestine","GI hormones & gut–brain regulation","Integrated clinical GIT & consolidation"]],
  ["N", 1, ["Organization of the NS & neurons","Membrane physiology & potentials","Action potentials & conduction","Synaptic transmission","Neuromuscular junction","Muscle physiology","Receptors & sensory transduction","Somatosensory system","Pain","Vision","Hearing & equilibrium","Taste & smell","Reflexes","Postural reflexes & control","Somatic motor system & pathways","Cerebellum & basal ganglia","Brainstem","Thalamus & hypothalamus","Autonomic nervous system","Limbic system, emotion & motivation","Learning & memory","Cerebral cortex & higher functions","Reticular formation, EEG & sleep","Meninges, CSF, BBB & cerebral blood flow","Spinal cord: tracts & lesions"]]
].forEach(([c, s, a]) => a.forEach((t, i) => { QN[c + (s + i)] = t; }));
["HA1","HA2","HA3","HB1","HB2","HB3","HC1","HC2","HC3","HD1","HD2","HD3"].forEach((k, i) => {
  QN[k] = ["Blood, RBCs & blood groups","Leukocytes & platelets","Haemopoiesis","Innate immunity","Adaptive immunity","Lymphoid organs","Neuron structure & synapses","Neuroglia, myelin, BBB & CSF","Peripheral nerves & regeneration","Bone cells, matrix & remodelling","Ossification & fracture repair","Calcium homeostasis & joints"][i];
});

const EXAMS = [
  { date: "2026-10-23", label: "Anatomy CA1" },
  { date: "2026-11-04", label: "Physiology CA2" },
  { date: "2026-11-06", label: "Anatomy CA2" }
];
const LAST_EXAM_DAY = "2026-11-06";

const WD = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const WDL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* =====================================================================
   SUPABASE
   ===================================================================== */
const SUPABASE_URL = "https://byiwzaifrwgsogkqlpdv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Es286AHEpe_mPsVQNzNBIg_ohdmKKKv";
const libLoaded = Boolean(window.supabase);
const sbReady = libLoaded && SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("YOUR-PROJECT-REF") && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes("YOUR_");
const sb = sbReady ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/* =====================================================================
   HELPERS
   ===================================================================== */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pd = s => { const [a, b, c] = s.split("-"); return new Date(+a, +b - 1, +c); };
const dayLabel = d => { const dt = pd(d); return `${MO[dt.getMonth()]} ${dt.getDate()}`; };
const todayKey = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };
const fmtTime = iso => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };

// Human-readable name for any item id (module, question set, Anki "A<date>", revision "V<date>")
const nameFor = (id, p) => {
  id = String(id);
  if (/^A\d{4}-\d{2}-\d{2}$/.test(id)) return `Anki flashcards · ${dayLabel(id.slice(1))}`;
  if (/^V\d{4}-\d{2}-\d{2}$/.test(id)) return "Anatomy CA1 revision";
  if (p === "q" && QN[id]) return QN[id];
  const list = NM[id[0]];
  return (list && list[+id.slice(1) - 1]) || id;
};

/* =====================================================================
   STATE
   ===================================================================== */
let S = { f: new Set(), b: new Set(), e: new Set(), q: new Set() };
let cur = "f", OPEN = new Set(), first = true, toastTimer;
let ACTIVITY = [], PENDING = [], INFLIGHT = [], activeTab = "tracker", unread = 0, lastActivitySeenAt = "", celebrated = [];
const OWN_EVENTS = new Set();   // activity ids created on this device (never counted as unread)
let renderedDate = todayKey();

try {
  const x = JSON.parse(localStorage.getItem("tt1") || "{}");
  for (const k of PEOPLE) S[k] = new Set(Array.isArray(x[k]) ? x[k] : []);
  cur = PEOPLE.includes(x.cur) ? x.cur : "f";
  PENDING = Array.isArray(x.pending) ? x.pending : [];
  lastActivitySeenAt = x.lastActivitySeenAt || "";
  celebrated = Array.isArray(x.celebrated) ? x.celebrated : [];
  if (!x.q) S.q = new Set(["R4", "R5", "G5"]);   // Abdulquddus' starting progress on first visit
} catch (e) { /* ignore corrupt storage */ }

const save = () => {
  try {
    localStorage.setItem("tt1", JSON.stringify({
      f: [...S.f], b: [...S.b], e: [...S.e], q: [...S.q],
      cur, pending: PENDING, lastActivitySeenAt, celebrated
    }));
  } catch (e) { /* storage full or blocked */ }
};

/* ---------- UI feedback ---------- */
const showToast = message => {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
};
const setStatus = message => {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("show", Boolean(message));
};
const syncUnavailableMessage = () =>
  !libLoaded ? "Couldn’t load the sync library. Working on this device only."
  : navigator.onLine ? "Supabase setup needed to sync with the group."
  : "Offline — changes will wait on this device.";

// Re-render while keeping scroll position and keyboard focus
const rerender = () => {
  const y = scrollY, a = document.activeElement;
  const key = a && a.dataset ? (a.dataset.id ? ["id", a.dataset.id] : a.dataset.d ? ["d", a.dataset.d] : null) : null;
  render();
  scrollTo(0, y);
  if (key) {
    const n = document.querySelector(`[data-${key[0]}="${CSS.escape(key[1])}"]`);
    if (n) n.focus({ preventScroll: true });
  }
};

/* =====================================================================
   PLAN & PROGRESS
   ===================================================================== */
const plan = p => {
  if (p === "q") {
    return QD.map(d => {
      const r = D.find(x => x[0] === d[0]);
      return { d: d[0], tag: r ? r[1] : "", phys: d[1], anat: d[2], rev: r ? r[5] : 0 };
    });
  }
  let ptr = 0;
  return D.map(d => {
    const hs = PPL[p].h.slice(ptr, ptr + d[4]).map(n => "H" + n);
    ptr += d[4];
    return { d: d[0], tag: d[1], phys: p === "e" ? d[2].filter(i => i[0] !== "R") : d[2], anat: [...d[3], ...hs], rev: d[5] };
  });
};
const dayItems = (p, x) => [...x.phys, ...x.anat, ...(x.rev ? ["V" + x.d] : []), "A" + x.d];
const assignedItems = p => plan(p).flatMap(x => dayItems(p, x));
const countDone = (p, ids = assignedItems(p)) => ids.filter(id => S[p].has(id)).length;

const currentAnkiStreak = p => {
  const today = todayKey();
  let dates = D.map(x => x[0]).filter(d => d <= today).reverse();
  // Today still in progress shouldn't break an existing streak
  if (dates[0] === today && !S[p].has("A" + today)) dates = dates.slice(1);
  let n = 0;
  for (const d of dates) { if (S[p].has("A" + d)) n++; else break; }
  return n;
};
const longestAnkiStreak = p => {
  let best = 0, run = 0;
  for (const x of D) { if (S[p].has("A" + x[0])) { run++; best = Math.max(best, run); } else run = 0; }
  return best;
};
const ankiDays = p => D.filter(x => S[p].has("A" + x[0])).length;

const todayStats = p => {
  const x = plan(p).find(y => y.d === todayKey());
  const ids = x ? dayItems(p, x) : [];
  return { done: ids.filter(id => S[p].has(id)).length, total: ids.length };
};

/* =====================================================================
   OFFLINE QUEUE & SERVER SYNC
   ===================================================================== */
const queueOp = (p, id, adding) => {
  PENDING = PENDING.filter(x => !(x.person === p && x.item_id === id));
  PENDING.push({ person: p, item_id: id, adding });
  save();
  setStatus("Offline — saved on this device and waiting to sync.");
};
const applyPending = () => {
  for (const op of [...PENDING, ...INFLIGHT]) {
    if (!S[op.person]) continue;
    if (op.adding) S[op.person].add(op.item_id); else S[op.person].delete(op.item_id);
  }
};

const updateUnread = () => {
  unread = ACTIVITY.filter(x => !OWN_EVENTS.has(x.id) && (!lastActivitySeenAt || new Date(x.created_at) > new Date(lastActivitySeenAt))).length;
};
const addLocalActivity = (a, { own = false } = {}) => {
  if (!a) return;
  if (own && a.id) OWN_EVENTS.add(a.id);
  if (!ACTIVITY.some(x => x.id && a.id && x.id === a.id)) {
    ACTIVITY = [a, ...ACTIVITY].sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
  }
  updateUnread();
};

const showCompletionBanner = (p, d) => {
  const key = `${p}:${d}`;
  if (d !== todayKey() || celebrated.includes(key)) return;
  celebrated.push(key);
  save();
  const el = document.getElementById("celebration");
  if (!el) return;
  el.innerHTML = `<strong>${esc(PPL[p].n)} completed today’s plan.</strong><button type="button" aria-label="Dismiss">×</button>`;
  el.classList.add("show");
  el.querySelector("button").onclick = () => el.classList.remove("show");
};
const maybeCelebrate = p => {
  if (!PPL[p]) return;
  const d = todayKey(), x = plan(p).find(y => y.d === d);
  if (x && dayItems(p, x).every(id => S[p].has(id))) showCompletionBanner(p, d);
};

const recordCompletion = async (p, id) => {
  if (!sb) return;
  const { data, error } = await sb.from("activity_events").insert({ person: p, item_id: id, action: "completed" }).select("id,person,item_id,action,created_at").single();
  if (error) showToast("Tick saved, but the activity feed could not update");
  else if (data) { addLocalActivity(data, { own: true }); if (activeTab === "activity") rerender(); }
};

// queued=true means we are replaying an offline op: never revert the UI on failure, just keep it queued
const saveServerToggle = async (p, id, adding, { queued = false } = {}) => {
  if (!sb) { setStatus(syncUnavailableMessage()); return false; }
  if (!navigator.onLine) { if (!queued) queueOp(p, id, adding); return false; }
  try {
    const result = adding
      ? await sb.from("ticks").upsert({ person: p, item_id: id }, { onConflict: "person,item_id" })
      : await sb.from("ticks").delete().eq("person", p).eq("item_id", id);
    if (result.error) throw result.error;
    if (adding) await recordCompletion(p, id);
    return true;
  } catch (e) {
    if (!queued) {
      if (adding) S[p].delete(id); else S[p].add(id);
      save();
      rerender();
      showToast("Couldn’t save — check your connection");
    }
    return false;
  }
};

let flushing = false;
const flushPending = async () => {
  if (flushing || !sb || !navigator.onLine || !PENDING.length) return;
  flushing = true;
  try {
    for (const op of [...PENDING]) {
      const ok = await saveServerToggle(op.person, op.item_id, op.adding, { queued: true });
      if (!ok) break;
      PENDING = PENDING.filter(x => !(x.person === op.person && x.item_id === op.item_id && x.adding === op.adding));
    }
  } finally { flushing = false; }
  save();
  setStatus(PENDING.length ? "Some offline changes are still waiting to sync." : "");
  rerender();
};

const loadServer = async ({ preserveScroll = false } = {}) => {
  if (!sb) { setStatus(syncUnavailableMessage()); return; }
  const y = preserveScroll ? scrollY : 0;
  try {
    const [{ data: ticks, error: tickError }, { data: events, error: eventError }] = await Promise.all([
      sb.from("ticks").select("person,item_id"),
      sb.from("activity_events").select("id,person,item_id,action,created_at").eq("action", "completed").order("created_at", { ascending: false }).limit(500)
    ]);
    if (tickError) throw tickError;
    for (const p of PEOPLE) S[p] = new Set();
    for (const row of ticks || []) { if (S[row.person]) S[row.person].add(row.item_id); }
    if (!eventError) ACTIVITY = events || [];
    applyPending();
    updateUnread();
    save();
    render();
    if (preserveScroll) scrollTo(0, y);
    await flushPending();
  } catch (e) {
    showToast("Couldn’t load shared progress — check your connection");
  }
};

// Toggles are sent one at a time, in order, so rapid taps can't arrive out of order
let syncChain = Promise.resolve();
const syncToggle = (p, id, adding) => {
  const op = { person: p, item_id: id, adding };
  INFLIGHT.push(op);
  syncChain = syncChain.then(async () => {
    const ok = await saveServerToggle(p, id, adding);
    INFLIGHT = INFLIGHT.filter(x => x !== op);
    if (ok) { save(); maybeCelebrate(p); }
    rerender();
  }).catch(() => { INFLIGHT = INFLIGHT.filter(x => x !== op); });
  return syncChain;
};

/* =====================================================================
   RENDERING
   ===================================================================== */
const renderTabs = () => {
  const el = document.getElementById("tabs");
  if (!el) return;
  const tab = (id, label, extra = "") =>
    `<button class="tab ${activeTab === id ? "on" : ""}" role="tab" aria-selected="${activeTab === id}" data-tab="${id}">${label}${extra}</button>`;
  el.innerHTML =
    tab("tracker", "Tracker") +
    tab("activity", "Notifications", unread ? `<b class="badge" aria-label="${unread} unread">${unread > 99 ? "99+" : unread}</b>` : "") +
    tab("leaderboard", "Leaderboards");
};

const renderActivity = () => {
  const shown = ACTIVITY.slice(0, 200);
  const rows = shown.length
    ? shown.map(a => `<div class="activity-row"><span class="activity-dot"></span><div><strong>${esc(PPL[a.person]?.n || a.person)} completed ${esc(a.item_id)} · ${esc(nameFor(a.item_id, a.person))}</strong><small>${esc(fmtTime(a.created_at))}</small></div></div>`).join("")
    : '<div class="empty">No completed tasks yet.</div>';
  return `<div class="card activity-card"><div class="panel-head"><div><h3>Notifications</h3><p>Every completed task is kept here for the lock-in.</p></div><span class="panel-count">${ACTIVITY.length}</span></div><div class="activity-list">${rows}</div></div>`;
};

const rankRows = metric => PEOPLE
  .map(p => { const total = assignedItems(p).length, done = countDone(p); return { p, done, total, pct: total ? done / total * 100 : 0, anki: ankiDays(p), streak: currentAnkiStreak(p) }; })
  .sort((a, b) => metric === "done" ? b.done - a.done : b.pct - a.pct);

const leaderboardRows = metric => {
  let last = null, rank = 0;
  return rankRows(metric).map((r, i) => {
    const value = metric === "done" ? r.done : r.pct;
    if (value !== last) rank = i + 1;
    last = value;
    return `<div class="leader-row"><b class="rank">${rank}</b><div class="leader-name"><strong>${esc(PPL[r.p].n)}</strong><small>${r.done}/${r.total} tasks · ${r.anki} Anki days · ${r.streak}-day streak</small></div><strong class="leader-score">${metric === "done" ? r.done : Math.round(r.pct) + "%"}</strong></div>`;
  }).join("");
};

const renderLeaderboard = () => {
  const groupTotal = PEOPLE.reduce((n, p) => n + assignedItems(p).length, 0);
  const groupDone = PEOPLE.reduce((n, p) => n + countDone(p), 0);
  return `<div class="card leaderboard-card"><div class="panel-head"><div><h3>Leaderboards</h3><p>Permanent rankings for this lock-in. Ties share the same rank.</p></div><span class="panel-count">${groupDone}/${groupTotal}</span></div><div class="leader-section"><h4>Most tasks completed</h4>${leaderboardRows("done")}</div><div class="leader-section"><h4>Highest completion percentage</h4>${leaderboardRows("pct")}</div></div>`;
};

const renderClosing = () => {
  if (todayKey() <= LAST_EXAM_DAY) return "";
  const best = rankRows("done")[0], pct = rankRows("pct")[0];
  return `<div class="card closing-card"><div class="panel-head"><div><h3>Lock-in complete</h3><p>Final results from the Tetralogy revision period.</p></div></div><p><strong>Most tasks:</strong> ${esc(PPL[best.p].n)} · ${best.done} completed</p><p><strong>Highest percentage:</strong> ${esc(PPL[pct.p].n)} · ${Math.round(pct.pct)}%</p></div>`;
};

function item(id, p) {
  const c = id[0], done = S[p].has(id), name = esc(nameFor(id, p));
  return `<div class="it ${done ? "done" : ""}" data-id="${esc(id)}" role="checkbox" aria-checked="${done}" tabindex="0" style="--c:${COL[c]}"><div class="cb" aria-hidden="true">✓</div><span class="cd" style="background:${COL[c]}">${esc(id)}</span><span class="nm">${name}</span></div>`;
}

function dayCard(p, x, t0) {
  const dt = pd(x.d), ids = dayItems(p, x), nmod = x.phys.length + x.anat.length;
  const ds = ids.filter(j => S[p].has(j)).length, full = ds === ids.length;
  const isT = +dt === +t0, open = OPEN.has(x.d);
  const sub = x.tag ? `${esc(x.tag)} · ${nmod} modules + Anki` : `${nmod} modules + Anki`;
  const revHtml = x.rev
    ? `<div class="grp">REVISION</div><div class="it rev ${S[p].has("V" + x.d) ? "done" : ""}" data-id="V${x.d}" role="checkbox" aria-checked="${S[p].has("V" + x.d)}" tabindex="0" style="--c:#d4a017"><div class="cb" aria-hidden="true">✓</div><span class="cd" style="background:#d4a017">CA1</span><span class="nm">Anatomy CA1 revision: intro, upper &amp; lower limb</span></div>`
    : "";
  const ankiDone = S[p].has("A" + x.d);
  return `<div class="card day ${isT ? "today" : ""} ${open ? "open" : ""}" id="d${x.d}">
    <div class="dh" data-d="${x.d}" role="button" tabindex="0" aria-expanded="${open}"><div class="dt"><b>${dt.getDate()}</b><span>${MO[dt.getMonth()].toUpperCase()}</span></div><div class="dm"><strong>${WDL[dt.getDay()]}${isT ? " · Today" : ""}</strong><span>${sub}</span></div><span class="pill ${full ? "ok" : ""}">${full ? "✓ Done" : ds + "/" + ids.length}</span></div>
    <div class="db">${revHtml}<div class="grp">PHYSIOLOGY</div>${x.phys.map(j => item(j, p)).join("")}<div class="grp">ANATOMY</div>${x.anat.map(j => item(j, p)).join("")}<div class="grp">DAILY</div><div class="it ${ankiDone ? "done" : ""}" data-id="A${x.d}" role="checkbox" aria-checked="${ankiDone}" tabindex="0" style="--c:#f97316"><div class="cb" aria-hidden="true">✓</div><span class="cd" style="background:#f97316">Anki</span><span class="nm">Anki flashcards: 150–200 cards</span></div></div>
  </div>`;
}

function render() {
  document.getElementById("who").innerHTML = PEOPLE.map(k => `<button class="${k === cur ? "on" : ""}" aria-pressed="${k === cur}" data-p="${k}">${esc(PPL[k].n)}</button>`).join("");
  renderTabs();
  const host = document.getElementById("app");
  if (activeTab === "activity") { host.innerHTML = renderActivity(); return; }
  if (activeTab === "leaderboard") { host.innerHTML = renderLeaderboard() + renderClosing(); return; }

  const p = cur, pl = plan(p);
  const all = pl.flatMap(x => [...x.phys, ...x.anat]);       // ring tracks reading modules only
  const dn = all.filter(i => S[p].has(i)).length;
  const ringTotal = all.length || 1, pc = Math.round(dn / ringTotal * 100);
  const now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cnt = s => Math.round((pd(s) - t0) / 864e5);

  // Open today's card on first render (or the next upcoming day if today isn't in the plan)
  if (first) {
    const tk = todayKey(), target = pl.find(x => x.d === tk) || pl.find(x => x.d > tk);
    if (target) OPEN.add(target.d);
  }

  const bars = Object.keys(SUB).filter(c => all.some(i => i[0] === c)).map(c => {
    const ids = all.filter(i => i[0] === c), d = ids.filter(i => S[p].has(i)).length;
    return `<div class="bar"><span>${SUB[c]}</span><div><i style="width:${d / ids.length * 100}%;background:${COL[c]}"></i></div><em>${d}/${ids.length}</em></div>`;
  }).join("");

  const me = todayStats(p), mePct = me.total ? Math.round(me.done / me.total * 100) : 0;
  const group = PEOPLE.reduce((a, k) => { const s = todayStats(k); return { done: a.done + s.done, total: a.total + s.total }; }, { done: 0, total: 0 });
  const C = 2 * Math.PI * 48;

  const exams = EXAMS.map(e => { const d = cnt(e.date); return `<div class="ex"><b>${d < 0 ? "✓" : d}</b><span>${d < 0 ? "done:" : d === 0 ? "today:" : "days to"}<br>${e.label}</span></div>`; }).join("");

  let h = `<div class="card summary-card"><div class="summary-label">TRACKING ${esc(PPL[p].n.toUpperCase())}</div><div class="top"><div class="ring"><svg width="112" height="112" viewBox="0 0 112 112" role="img" aria-label="${pc}% of reading modules complete"><circle cx="56" cy="56" r="48" fill="none" stroke="var(--line)" stroke-width="10"/><circle cx="56" cy="56" r="48" fill="none" stroke="url(#g)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - dn / ringTotal)}" style="transition:.6s"/><defs><linearGradient id="g"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#10b981"/></linearGradient></defs></svg><b>${pc}%</b></div><div class="bars">${bars}</div></div><div class="exams">${exams}</div></div>`;
  h += `<div class="quick-grid"><div class="quick-card"><span>Today</span><strong>${me.done}/${me.total}</strong><small>${mePct}% complete</small></div><div class="quick-card"><span>Group today</span><strong>${group.done}/${group.total}</strong><small>all four participants</small></div><div class="quick-card"><span>Anki streak</span><strong>${currentAnkiStreak(p)} days</strong><small>longest: ${longestAnkiStreak(p)}</small></div></div>`;
  h += `<div class="sec">DAILY PLAN · TAP A DAY TO OPEN IT</div>`;
  h += pl.map(x => dayCard(p, x, t0)).join("");
  h += `<div class="sec">NO NEW READING FROM HERE: REVISE &amp; SOLVE QUESTIONS</div><div class="tl"><div><b>Nov 2</b>Spare day: only for anything that slipped</div><div><b>Nov 3</b>Physiology revision and past questions</div><div class="x"><b>Nov 4</b><strong>Physiology CA2</strong></div><div><b>Nov 5</b>Embryology and histology revision</div><div class="x"><b>Nov 6</b><strong>Anatomy CA2</strong></div></div>`;
  h += renderClosing();
  first = false;
  host.innerHTML = h;
}

/* =====================================================================
   EVENTS
   ===================================================================== */
document.addEventListener("click", e => {
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    activeTab = tab.dataset.tab;
    if (activeTab === "activity") { lastActivitySeenAt = new Date().toISOString(); unread = 0; save(); }
    render();
    return;
  }
  const b = e.target.closest("[data-p]");
  if (b) { cur = b.dataset.p; save(); rerender(); return; }

  const it = e.target.closest("[data-id]");
  if (it) {
    const id = it.dataset.id, p = cur, adding = !S[p].has(id);
    if (adding) S[p].add(id); else S[p].delete(id);
    save();
    rerender();
    void syncToggle(p, id, adding);
    return;
  }
  const dh = e.target.closest("[data-d]");
  if (dh) {
    const k = dh.dataset.d;
    if (OPEN.has(k)) OPEN.delete(k); else OPEN.add(k);
    dh.parentElement.classList.toggle("open");
    dh.setAttribute("aria-expanded", OPEN.has(k));
  }
});

// Keyboard support for checklist rows and day headers
document.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const t = e.target.closest && e.target.closest("[data-id],[data-d]");
  if (t && t === e.target) { e.preventDefault(); t.click(); }
});

/* ---------- Realtime ---------- */
const startRealtime = () => {
  if (!sb) return;
  let subscribedBefore = false;

  sb.channel("ticks").on("postgres_changes", { event: "*", schema: "public", table: "ticks" }, payload => {
    const next = payload.new || {}, old = payload.old || {};
    if (payload.eventType === "UPDATE" && old.person && S[old.person]) S[old.person].delete(old.item_id);
    if ((payload.eventType === "INSERT" || payload.eventType === "UPDATE") && S[next.person]) S[next.person].add(next.item_id);
    if (payload.eventType === "DELETE" && S[old.person]) S[old.person].delete(old.item_id);
    save();
    rerender();
    if (payload.eventType !== "DELETE" && next.person) maybeCelebrate(next.person);
  }).subscribe(status => {
    if (status === "SUBSCRIBED") {
      // Initial load happens at startup; only resync after a reconnect
      if (subscribedBefore) void loadServer({ preserveScroll: true });
      subscribedBefore = true;
    }
  });

  sb.channel("activity").on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_events" }, payload => {
    addLocalActivity(payload.new);
    if (activeTab === "activity") { lastActivitySeenAt = new Date().toISOString(); unread = 0; save(); }
    rerender();
  }).subscribe();
};

/* =====================================================================
   BOOT
   ===================================================================== */
render();
if (sb) { void loadServer(); startRealtime(); } else setStatus(syncUnavailableMessage());

const refreshForDateChange = () => {
  const next = todayKey();
  if (next === renderedDate) return;
  renderedDate = next;
  first = true;
  rerender();
};
setInterval(refreshForDateChange, 30000);

window.addEventListener("online", () => { setStatus(""); void loadServer({ preserveScroll: true }); });
window.addEventListener("offline", () => setStatus("Offline — saved changes will wait on this device."));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { refreshForDateChange(); void loadServer({ preserveScroll: true }); }
});
