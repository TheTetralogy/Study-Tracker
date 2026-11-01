"use strict";

/* Tetralogy static client. All authority lives in Supabase RLS/functions. */
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const TIME_ZONE = "Africa/Lagos";
  const TIMELINE_PAST = 3, TIMELINE_AHEAD = 7; // days shown around today on the dashboard
  const NAV = [
    ["dashboard", "Dashboard"], ["calendar", "Calendar"], ["planner", "Study planner"],
    ["statistics", "Statistics"], ["notifications", "Notifications"], ["leaderboard", "Leaderboards"], ["settings", "Settings"]
  ];
  const state = {
    sb: null, user: null, profile: null, privateProfile: null, membership: null, members: [], passwordSetupRequired: false,
    viewerId: null, tab: "dashboard", notificationMode: "general", theme: "dark",
    courses: [], topics: [], sections: [], courseMemberships: [], courseSelections: [], plans: [], tasks: [], recurringRules: [], recurringRuleHistory: [], unmappedTicks: [],
    completions: new Map(), events: [], notifications: [], notificationReceipts: new Map(),
    activityReads: new Set(), exams: [], scheduleHistory: [], audit: [], ankiTargets: [], ankiLogs: [],
    ankiSummary: [], legacyActivity: [], preferences: {}, loading: false, loaded: false, openDays: new Set(),
    selectedDate: lagosDate(), calendarMonth: firstOfMonth(lagosDate()), toastTimer: null,
    importDraft: null, importDestination: "new", importChoices: {}, pendingProposal: null,
    realtime: [],
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }
  function lagosDate(value = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
    const get = type => parts.find(p => p.type === type)?.value || "00";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }
  function dateObj(value) { return new Date(`${value}T12:00:00Z`); }
  function addDays(value, amount) { const d = dateObj(value); d.setUTCDate(d.getUTCDate() + amount); return d.toISOString().slice(0, 10); }
  function firstOfMonth(value) { return `${value.slice(0, 7)}-01`; }
  function shiftMonth(value, amount) { const d = dateObj(value); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + amount); return d.toISOString().slice(0, 10); }
  function dayDiff(a, b) { return Math.round((dateObj(b) - dateObj(a)) / 86400000); }
  function formatDate(value, options = { month: "short", day: "numeric" }) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(dateObj(String(value).slice(0, 10)));
  }
  function formatLongDate(value) { return new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(dateObj(value)); }
  function formatTime(value) { if (!value) return ""; return new Intl.DateTimeFormat("en", { timeZone: TIME_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
  function startOfWeek(value) { const d = dateObj(value); const day = d.getUTCDay(); d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); }
  function dayCode(value) { return dateObj(value).getUTCDay(); }
  function plural(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; }
  function pct(done, total) { return total ? Math.round(done * 100 / total) : 0; }
  function setStatus(message = "", type = "") {
    const el = $("#status"); if (!el) return;
    el.textContent = message; el.hidden = !message;
    el.classList.toggle("is-error", type === "error"); el.classList.toggle("is-success", type === "success");
  }
  function toast(message) {
    const el = $("#toast"); if (!el) return;
    el.textContent = message; el.classList.add("show"); clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove("show"), 3400);
  }
  function setAuthFeedback(message = "", type = "") {
    const el = $("#auth-feedback"); if (!el) return;
    el.textContent = message; el.className = `form-feedback${type ? ` is-${type}` : ""}`;
  }
  function errorText(error) {
    const msg = error?.message || error?.error_description || "Something went wrong. Please try again.";
    return String(msg).replace(/https?:\/\/\S+/g, "the service").slice(0, 260);
  }
  function showAuth(mode = "login") {
    $("#auth-panel").hidden = false; $("#app-shell").hidden = true;
    $$("[data-auth-mode]").forEach(b => { const active = b.dataset.authMode === mode; b.classList.toggle("is-active", active); b.setAttribute("aria-selected", String(active)); });
    $("#login-form").hidden = mode !== "login"; $("#register-form").hidden = mode !== "register";
    $("#new-password-form").hidden = true; setAuthFeedback();
  }
  function apiReady() { return state.sb && navigator.onLine; }
  function requireOwner() { return state.user && state.viewerId === state.user.id && state.membership?.status === "active"; }
  function isReadOnly() { return !requireOwner() || state.viewerId !== state.user?.id; }
  function currentGroupId() { return state.membership?.group_id || null; }
  function currentViewer() { return state.members.find(p => p.id === state.viewerId) || state.profile; }
  function nameOf(id) { return state.members.find(p => p.id === id)?.display_name || (id === state.user?.id ? state.profile?.display_name : "Study participant"); }
  function courseOf(id) { return state.courses.find(c => c.id === id); }
  function sectionOf(id) { return state.sections.find(s => s.id === id); }
  function topicOf(id) { return state.topics.find(t => t.id === id); }
  function sectionCourse(sectionId) {
    const section = sectionOf(sectionId); const topic = section && state.topics.find(t => t.id === section.topic_id);
    return topic ? courseOf(topic.course_id) : null;
  }
  function taskTitle(task) { return task.section_id && sectionOf(task.section_id) ? sectionOf(task.section_id).title : task.task_title; }
  function taskTypeLabel(type) { return ({ study: "Study", anki: "Anki", practice: "Questions", revision: "Revision", practical: "Practical", assignment: "Assignment", custom: "Task" })[type] || "Task"; }
  function activeTasks(ownerId = state.viewerId) { return state.tasks.filter(t => t.owner_id === ownerId && t.status === "scheduled" && !t.archived_at); }
  function sectionOrder(sectionId) {
    const section=sectionOf(sectionId),topic=section&&state.topics.find(t=>t.id===section.topic_id);
    return topic?[Number(topic.sequence_number)||0,Number(section.sequence_number)||0]:null;
  }
  function scheduledOrderConflicts(changes=[]) {
    const byTask=new Map(changes.filter(x=>x.task_id).map(x=>[x.task_id,x]));
    const existing=activeTasks(state.user.id).filter(t=>t.section_id);
    const existingIds=new Set(existing.map(t=>t.id)),existingSections=new Set(existing.map(t=>t.section_id));
    const rows=existing.map(t=>({...t,_orderId:t.id,_oldDate:t.scheduled_date,_newDate:byTask.get(t.id)?.scheduled_date||t.scheduled_date}));
    for(const x of changes.filter(y=>y.section_id&&!y.task_id&&!existingSections.has(y.section_id))) rows.push({...x,_orderId:`pending:${x.section_id}`,_oldDate:null,_newDate:x.scheduled_date});
    const ids=new Set(),pairs=[];
    for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
      const a=rows[i],b=rows[j];if(a.course_id!==b.course_id||!a._newDate||!b._newDate)continue;
      const oa=sectionOrder(a.section_id),ob=sectionOrder(b.section_id);if(!oa||!ob)continue;
      const order=oa[0]-ob[0]||oa[1]-ob[1];if(!order)continue;
      const oldConflict=a._oldDate&&b._oldDate&&(order<0?a._oldDate>b._oldDate:a._oldDate<b._oldDate);
      const nextConflict=order<0?a._newDate>b._newDate:a._newDate<b._newDate;
      if(nextConflict&&!oldConflict){ids.add(a._orderId);ids.add(b._orderId);pairs.push([taskTitle(a),taskTitle(b)]);}
    }
    return {ids,pairs};
  }
  function done(taskId) { return state.completions.has(taskId); }
  function taskPct(tasks) { return pct(tasks.filter(t => done(t.id)).length, tasks.length); }
  function currentTarget(ownerId = state.user?.id, day = lagosDate()) {
    if (ownerId !== state.user?.id) return null;
    return state.ankiTargets.filter(t => t.owner_id === ownerId && t.effective_from <= day).sort((a,b) => b.effective_from.localeCompare(a.effective_from))[0] || null;
  }
  function targetForDay(day) { return currentTarget(state.user?.id, day)?.target_count || null; }
  function ankiRemainingForTask(task) {
    if(task?.task_type!=="anki")return null;
    const target=targetForDay(task.scheduled_date);if(!target)return null;
    const log=state.ankiLogs.find(x=>x.log_date===task.scheduled_date);
    return Math.max(target-(Number(log?.cards_completed)||0),0);
  }
  function tasksForDate(ownerId, date) { return activeTasks(ownerId).filter(t => t.scheduled_date === date); }
  function taskGroup(task) { return task.course_id ? (courseOf(task.course_id)?.title || "Course") : taskTypeLabel(task.task_type); }
  function countCompletions(ownerId, since, until) {
    return activeTasks(ownerId).filter(t => {
      const c = state.completions.get(t.id); return c && c.scheduled_date_credit >= since && c.scheduled_date_credit <= until;
    }).length;
  }
  function currentAnkiSummary(ownerId = state.viewerId) { return state.ankiSummary.find(r => r.profile_id === ownerId) || null; }
  function maxAnkiStreak(logs) {
    const days = [...new Set(logs.filter(x => x.completed).map(x => x.log_date))].sort();
    let best = 0, run = 0, prior = null;
    for (const d of days) { run = prior && dayDiff(prior, d) === 1 ? run + 1 : 1; best = Math.max(best, run); prior = d; }
    return best;
  }
  function currentAnkiStreak(logs) {
    const completed = new Set(logs.filter(x => x.completed).map(x => x.log_date));
    let cursor = lagosDate(); if (!completed.has(cursor)) cursor = addDays(cursor, -1);
    let n = 0; while (completed.has(cursor)) { n++; cursor = addDays(cursor, -1); }
    return n;
  }
  function groupTodayProgress() {
    let doneCount = 0, total = 0;
    for (const p of state.members) { const tasks = tasksForDate(p.id, lagosDate()); total += tasks.length; doneCount += tasks.filter(t => done(t.id)).length; }
    return { done: doneCount, total };
  }
  function htmlButton(action, text, cls = "button button-secondary", extra = "") {
    return `<button type="button" class="${cls}" data-action="${esc(action)}" ${extra}>${text}</button>`;
  }
  function makeSvgRing(value, label) {
    const r = 43, c = 2 * Math.PI * r, offset = c * (1 - value / 100);
    return `<div class="progress-ring"><svg viewBox="0 0 100 100" role="img" aria-label="${value}% ${esc(label)}"><circle class="track" cx="50" cy="50" r="${r}"></circle><circle class="value" cx="50" cy="50" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${offset}"></circle></svg><strong>${value}%</strong></div>`;
  }

  async function fetchData(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }
  async function loadData({ quiet = false } = {}) {
    if (!state.sb || !state.user || state.loading) return;
    state.loading = true;
    if (!quiet) setStatus("Loading your shared study space…");
    try {
      const profileRows = await fetchData(state.sb.from("profiles").select("id,display_name,avatar_url,status,created_at").eq("id", state.user.id).limit(1));
      if (!profileRows.length) throw new Error("Your profile is not available. Confirm your email and ask the project owner to check membership setup.");
      state.profile = profileRows[0];
      const [privateRows, memberships] = await Promise.all([
        fetchData(state.sb.from("profile_private").select("profile_id,email_ref,legacy_person_key").eq("profile_id", state.user.id).limit(1)),
        fetchData(state.sb.from("group_members").select("group_id,profile_id,status,joined_at,left_at").eq("profile_id", state.user.id)),
      ]);
      state.privateProfile = privateRows[0] || null;
      state.membership = memberships.find(m => m.status === "active") || memberships[0] || null;
      if (!state.membership || state.membership.status !== "active") {
        state.members = [state.profile]; state.viewerId = state.user.id; state.loaded = true; renderApp();
        setStatus(state.membership?.status === "left" ? "You have left the group. Rejoin when you are ready; your personal data is preserved." : "Your group membership is awaiting email verification.");
        return;
      }
      const memberRows = await fetchData(state.sb.from("group_members").select("profile_id").eq("group_id", state.membership.group_id).eq("status", "active"));
      const ids = [...new Set(memberRows.map(x => x.profile_id))];
      const profiles = ids.length ? await fetchData(state.sb.from("profiles").select("id,display_name,avatar_url,status,created_at").in("id", ids)) : [state.profile];
      state.members = profiles.filter(p => p.status === "active");
      if (!state.members.some(p => p.id === state.user.id)) state.members.push(state.profile);
      if (!state.viewerId || !state.members.some(p => p.id === state.viewerId)) state.viewerId = state.user.id;

      const memberIds = state.members.map(p => p.id);
      const getMany = async q => fetchData(q);
      const [courses, topics, sections, membershipsAll, selections, plans, tasks, completions, activity, notifications, exams, history, targets, logs, prefs, audit, legacyActivity, recurringRules, recurringRuleHistory, unmappedTicks, aReads, nReads, ankiSummary] = await Promise.all([
        getMany(state.sb.from("courses").select("*").order("title")),
        getMany(state.sb.from("course_topics").select("*").order("sequence_number")),
        getMany(state.sb.from("course_sections").select("*").order("sequence_number")),
        getMany(state.sb.from("course_memberships").select("course_id,profile_id,status,joined_at,left_at").eq("profile_id", state.user.id)),
        getMany(state.sb.from("personal_course_selections").select("*").eq("profile_id", state.user.id)),
        getMany(state.sb.from("personal_plans").select("*").in("owner_id", memberIds).order("created_at", { ascending: false })),
        getMany(state.sb.from("task_instances").select("*").in("owner_id", memberIds).order("scheduled_date").limit(5000)),
        getMany(state.sb.from("task_completions").select("*").in("owner_id", memberIds).limit(5000)),
        getMany(state.sb.from("study_activity_events").select("*").order("created_at", { ascending: false }).limit(300)),
        getMany(state.sb.from("notifications").select("*").eq("group_id", state.membership.group_id).order("created_at", { ascending: false }).limit(400)),
        getMany(state.sb.from("exams_deadlines").select("*").eq("group_id", state.membership.group_id).order("due_date")),
        getMany(state.sb.from("task_schedule_history").select("*").in("owner_id", memberIds).order("created_at", { ascending: true }).limit(10000)),
        getMany(state.sb.from("anki_targets").select("*").eq("owner_id", state.user.id).order("effective_from", { ascending: false })),
        getMany(state.sb.from("anki_logs").select("*").eq("owner_id", state.user.id).order("log_date", { ascending: false }).limit(1000)),
        getMany(state.sb.from("user_preferences").select("*").eq("profile_id", state.user.id).limit(1)),
        getMany(state.sb.from("task_completion_audit").select("*").eq("owner_id", state.user.id).order("event_time", { ascending: false }).limit(500)),
        getMany(state.sb.from("legacy_activity_history").select("*").eq("owner_id", state.user.id).order("created_at", { ascending: false }).limit(1000)),
        getMany(state.sb.from("recurring_rules").select("*").eq("owner_id", state.user.id).order("created_at", { ascending: false })),
        getMany(state.sb.from("recurring_rule_history").select("*").eq("owner_id", state.user.id).order("created_at", { ascending: false }).limit(100)),
        getMany(state.sb.from("legacy_unmapped_ticks").select("*").eq("profile_id", state.user.id).order("imported_at", { ascending: false }).limit(1000)),
        getMany(state.sb.from("activity_reads").select("event_id,read_at").eq("profile_id", state.user.id)),
        getMany(state.sb.from("notification_receipts").select("notification_id,read_at,archived_at").eq("profile_id", state.user.id)),
        getMany(state.sb.rpc("get_group_anki_summary")),
      ]);
      state.courses = courses; state.topics = topics; state.sections = sections; state.courseMemberships = membershipsAll; state.courseSelections = selections;
      state.plans = plans; state.tasks = tasks; state.completions = new Map(completions.map(c => [c.task_id, c]));
      state.events = activity; state.notifications = notifications; state.exams = exams; state.scheduleHistory = history;
      state.ankiTargets = targets; state.ankiLogs = logs; state.preferences = prefs[0] || {};
      state.audit = audit; state.legacyActivity = legacyActivity; state.recurringRules = recurringRules; state.recurringRuleHistory = recurringRuleHistory; state.unmappedTicks = unmappedTicks; state.activityReads = new Set(aReads.map(r => r.event_id));
      state.notificationReceipts = new Map(nReads.map(r => [r.notification_id, r])); state.ankiSummary = ankiSummary || [];
      state.theme = state.preferences.theme || localStorage.getItem(`tetralogy-theme:${state.user.id}`) || "dark";
      applyTheme(state.theme); state.loaded = true;
      if (!state.openDays.size) state.openDays.add(lagosDate());
      if (!quiet) setStatus("");
      renderApp();
      if (!navigator.onLine) setStatus("Offline — shared data is read-only until you reconnect.");
    } catch (error) {
      state.loaded = true;
      setStatus(`Could not load the study data: ${errorText(error)}. No changes were sent.`, "error");
      renderApp();
    } finally { state.loading = false; }
  }

  function applyTheme(theme) {
    state.theme = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = state.theme;
    const meta = $('meta[name="theme-color"]'); if (meta) meta.content = state.theme === "dark" ? "#17133d" : "#f5f2ec";
    if (state.user) localStorage.setItem(`tetralogy-theme:${state.user.id}`, state.theme);
  }
  function headerActions() {
    const host = $("#header-actions");
    if (!state.user) { host.innerHTML = ""; return; }
    host.innerHTML = `<span class="header-name">${esc(state.profile?.display_name || "Study member")}</span>
      <button type="button" class="icon-button" data-action="theme-toggle" aria-label="Switch to ${state.theme === "dark" ? "light" : "dark"} theme" title="Switch theme">${state.theme === "dark" ? "☼" : "◐"}</button>
      <button type="button" class="icon-button" data-action="sign-out" aria-label="Sign out" title="Sign out">↪</button>`;
  }
  function navAndPeople() {
    const unreadCount = state.events.filter(e => !state.activityReads.has(e.id)).length
      + state.notifications.filter(n => n.recipient_id === state.user?.id && !n.read_at && !n.archived_at).length
      + state.notifications.filter(n => n.recipient_id === null && !state.notificationReceipts.get(n.id)?.read_at && !state.notificationReceipts.get(n.id)?.archived_at).length;
    const nav = NAV.map(([id, label]) => `<button type="button" class="nav-item ${state.tab === id ? "is-active" : ""}" role="tab" aria-selected="${state.tab === id}" data-tab="${id}">${esc(label)}${id === "notifications" && unreadCount ? ` <span class="nav-count" aria-label="${unreadCount} unread">${unreadCount > 99 ? "99+" : unreadCount}</span>` : ""}</button>`).join("");
    const people = state.members.map(p => `<button type="button" class="person-pill ${state.viewerId === p.id ? "is-active" : ""}" data-viewer="${esc(p.id)}" aria-pressed="${state.viewerId === p.id}">${esc(p.display_name)}${p.id === state.user?.id ? " · You" : ""}</button>`).join("");
    return `<div class="app-top"><nav class="main-nav" role="tablist" aria-label="Study sections">${nav}</nav><div class="participant-strip"><span class="participant-label">Study team</span>${people || "<span class='field-help'>No active members yet.</span>"}</div></div>`;
  }
  function renderApp() {
    const app = $("#app"), shell = $("#app-shell");
    if (!state.user) { shell.hidden = true; $("#auth-panel").hidden = false; headerActions(); return; }
    $("#auth-panel").hidden = true; shell.hidden = false; headerActions();
    let body = "";
    if (!state.loaded) body = `<div class="card empty-state"><strong>Opening your study space…</strong>Syncing profile and today's plan.</div>`;
    else if (state.membership?.status === "left") body = renderMembershipState();
    else if (state.membership?.status !== "active") body = renderMembershipState();
    else {
      const view = state.members.find(p => p.id === state.viewerId) || state.profile;
      const readOnly = view?.id !== state.user.id;
      const viewBanner = readOnly ? `<p class="viewing-notice">Read-only view · You are viewing <strong>${esc(view?.display_name || "a participant")}</strong>'s study dashboard. Only they can change their plan.</p>` : "";
      body = navAndPeople() + viewBanner + (state.tab === "dashboard" ? renderDashboard(view) :
        state.tab === "calendar" ? renderCalendar(view) : state.tab === "planner" ? renderPlanner(view) :
        state.tab === "statistics" ? renderStatistics(view) : state.tab === "notifications" ? renderNotifications() :
        state.tab === "leaderboard" ? renderLeaderboards() : renderSettings());
    }
    const keepNav = app.querySelector(".main-nav"), keepPeople = app.querySelector(".participant-strip");
    const navLeft = keepNav ? keepNav.scrollLeft : null, peopleLeft = keepPeople ? keepPeople.scrollLeft : null;
    app.innerHTML = body;
    const nav = app.querySelector(".main-nav"), people = app.querySelector(".participant-strip");
    if (nav) {
      if (navLeft !== null) nav.scrollLeft = navLeft;
      const active = nav.querySelector(".is-active");
      if (active) {
        const left = active.offsetLeft - nav.offsetLeft, right = left + active.offsetWidth;
        if (left < nav.scrollLeft) nav.scrollLeft = Math.max(0, left - 12);
        else if (right > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = right - nav.clientWidth + 12;
      }
    }
    if (people && peopleLeft !== null) people.scrollLeft = peopleLeft;
  }
  function renderMembershipState() {
    if (state.membership?.status === "left") return `<div class="card"><p class="eyebrow">YOUR ACCOUNT IS SAFE</p><h1 class="greeting">Rejoin the study team?</h1><p class="greeting-sub">Your personal records and history remain saved. Rejoining restores group access.</p><button type="button" class="button button-primary" data-action="rejoin">Rejoin Tetralogy</button></div>`;
    return `<div class="card"><p class="eyebrow">EMAIL VERIFICATION</p><h1 class="greeting">Check your verification link.</h1><p class="greeting-sub">Group access is activated after the invitation email is confirmed. Return here and sign in once verified.</p><button type="button" class="button button-secondary" data-action="sign-out">Sign out</button></div>`;
  }

  function sectionHeader(title, subtitle = "", actions = "") {
    return `<div class="page-heading"><div><p class="eyebrow">TETRALOGY STUDY SPACE</p><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>${actions ? `<div class="button-row">${actions}</div>` : ""}</div>`;
  }
  function renderDashboard(view) {
    const ownerId = view.id, tasks = activeTasks(ownerId), today = lagosDate(), todayTasks = tasksForDate(ownerId, today);
    const todayDone = todayTasks.filter(t => done(t.id)).length, progress = pct(todayDone, todayTasks.length);
    const reading = tasks.filter(t => t.task_type !== "anki"), overall = taskPct(reading);
    const groupToday = groupTodayProgress();
    const anki = currentAnkiSummary(ownerId);
    const daysForTimeline = Array.from({ length: TIMELINE_PAST + TIMELINE_AHEAD + 1 }, (_, i) => addDays(today, i - TIMELINE_PAST));
    const timeline = daysForTimeline.map(d => renderDayCard(ownerId, d, d === today)).join("");
    const courses = state.courses.filter(c => !c.archived_at && (c.owner_id === ownerId || c.visibility === "shared"));
    const courseBars = courses.map(c => {
      const ctasks = tasks.filter(t => t.course_id === c.id && t.task_type !== "anki");
      const completed = ctasks.filter(t => done(t.id)).length;
      return `<div class="course-bar"><span>${esc(c.title)}</span><div class="course-bar-track"><i class="course-bar-fill" style="width:${pct(completed, ctasks.length)}%"></i></div><em>${completed}/${ctasks.length}</em></div>`;
    }).join("");
    const deadlines = state.exams.filter(e => e.status === "active" && !e.archived_at && (e.due_date >= addDays(today, -1))).slice(0, 4).map(e => {
      const remaining = dayDiff(today, e.due_date);
      return `<div class="deadline-row"><span class="deadline-date">${remaining < 0 ? "Past" : remaining === 0 ? "Today" : `${remaining}d`}</span><div class="deadline-copy"><strong>${esc(e.title)}</strong><small>${esc(formatDate(e.due_date))}${e.visibility === "group" ? " · group" : " · personal"}</small></div>${ownerId === state.user.id ? `<button type="button" class="text-button deadline-edit" data-action="edit-deadline" data-deadline="${esc(e.id)}" aria-label="Edit ${esc(e.title)}">Edit</button>` : ""}</div>`;
    }).join("") || `<div class="empty-state">No upcoming deadlines recorded.</div>`;
    const recent = state.events.slice(0, 5).map(e => `<div class="activity-row"><i class="activity-dot"></i><div class="activity-copy"><strong>${esc(nameOf(e.actor_id))} · ${esc(e.payload?.title || "completed a task")}</strong><small>${esc(formatTime(e.created_at))}</small></div></div>`).join("") || `<div class="empty-state">Shared activity will appear here.</div>`;
    const claimBanner = ownerId === state.user.id && !state.privateProfile?.legacy_person_key ? `<div class="inline-banner"><span class="banner-icon">↗</span><p><strong>Did you study with Tetralogy before?</strong> Claim your old identity with your private one-time code to bring in your legacy plan and progress. New members can skip this.</p><button type="button" class="button button-quiet" data-action="claim-legacy">Claim records</button></div>` : "";
    const overdue = tasks.filter(t => t.scheduled_date < today && !done(t.id));
    const backlog = ownerId === state.user.id && overdue.length ? `<div class="inline-banner"><span class="banner-icon">!</span><p><strong>${plural(overdue.length, "unfinished task")} from earlier dates.</strong> Review a proposed schedule; nothing moves until you approve it.</p><button type="button" class="button button-quiet" data-action="open-backlog">Review tasks</button></div>` : "";
    const viewToday = todayTasks.length ? `${todayDone}/${todayTasks.length}` : "0/0";
    return `${sectionHeader(`Good ${greetingPart()}, ${view.display_name.split(/\s+/)[0]}.`, "Today is a chance to make steady progress.", htmlButton("quick-task", "＋ Add task", "button button-primary"))}
      ${claimBanner}${backlog}
      <div class="dashboard-grid">
        <div class="stack">
          <section class="summary-card card"><p class="eyebrow">${ownerId === state.user.id ? "YOUR CURRENT PLAN" : "CURRENT PLAN · READ ONLY"}</p><div class="summary-top">${makeSvgRing(overall, "of active study tasks complete")}<div class="progress-detail"><strong>${esc(viewToday)} tasks today</strong><span>${progress}% of today's assigned tasks complete · ${plural(tasks.length, "active task")}</span></div></div>
            <div class="metric-grid"><div class="metric-card"><span>Today</span><strong>${esc(viewToday)}</strong><small>${progress}% done</small></div><div class="metric-card"><span>Group today</span><strong>${groupToday.done}/${groupToday.total}</strong><small>tasks completed</small></div><div class="metric-card"><span>Anki streak</span><strong>${anki?.current_streak || 0}d</strong><small>longest ${anki?.longest_streak || 0}d</small></div><div class="metric-card"><span>Recent activity</span><strong>${countCompletions(ownerId, addDays(today,-6), today)}</strong><small>planned-day credits this week</small></div></div>
            <div class="section-heading"><div><h2>Course progress</h2><p>Active scheduled study tasks, not hours.</p></div></div><div class="course-bars">${courseBars || `<div class="empty-state">Course progress appears once a course has scheduled tasks.</div>`}</div>
          </section>
          <section><div class="section-heading"><div><h2>Study timeline</h2><p>Previous ${TIMELINE_PAST} days · today · next ${TIMELINE_AHEAD} days</p></div>${ownerId === state.user.id ? htmlButton("open-calendar", "Full calendar", "button button-quiet") : ""}</div><div class="day-stream">${timeline}</div></section>
        </div>
        <aside class="stack"><section class="surface"><div class="panel-title"><div><h2>Upcoming deadlines</h2><p>Dates are shown in Africa/Lagos.</p></div>${ownerId === state.user.id ? `<div class="button-row"><button type="button" class="text-button" data-action="manage-deadlines">Manage</button><button type="button" class="icon-button" data-action="add-deadline" aria-label="Add deadline">＋</button></div>` : ""}</div><div class="deadline-list">${deadlines}</div></section>
          <section class="surface"><div class="panel-title"><div><h2>Study team</h2><p>Open a profile for detailed read-only stats.</p></div><span class="count-chip">${state.members.length}</span></div><div class="people-list">${state.members.map(p => { const pt = activeTasks(p.id); return `<div class="person-row"><span class="avatar" aria-hidden="true">${esc(initials(p.display_name))}</span><div class="person-copy"><strong>${esc(p.display_name)}${p.id === state.user.id ? " · You" : ""}</strong><small>${pt.filter(t => done(t.id)).length}/${pt.length} active tasks complete</small></div>${p.id !== ownerId ? `<button type="button" class="button button-quiet" data-viewer="${esc(p.id)}">View</button>` : `<span class="pill is-good">Here</span>`}</div>`; }).join("")}</div></section>
          <section class="surface"><div class="panel-title"><div><h2>Recent group activity</h2><p>Live completion events from active members.</p></div></div><div class="activity-list">${recent}</div><button type="button" class="text-button" data-tab="notifications">Open notifications</button></section>
        </aside>
      </div>`;
  }
  function greetingPart() { const hour = Number(new Intl.DateTimeFormat("en", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" }).format(new Date())); return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"; }
  function initials(name) { return String(name || "T").trim().split(/\s+/).slice(0,2).map(x => x[0] || "").join("").toUpperCase(); }
  function renderDayCard(ownerId, date, today = false) {
    const tasks = tasksForDate(ownerId, date); const open = state.openDays.has(date); const complete = tasks.filter(t => done(t.id)).length;
    const futureEmpty = !tasks.length && date > lagosDate();
    return `<article class="day-card ${today ? "is-today" : ""} ${date < lagosDate() ? "is-past" : ""}"><button type="button" class="day-head" data-action="toggle-day" data-date="${date}" aria-expanded="${open}"><span class="date-tile"><strong>${dateObj(date).getUTCDate()}</strong><span>${formatDate(date,{month:"short"}).replace(/\s+\d+/,"").toUpperCase()}</span></span><span class="day-meta"><strong>${today ? "Today · " : ""}${esc(formatDate(date,{weekday:"long"}))}</strong><small>${tasks.length ? `${complete}/${tasks.length} tasks complete` : futureEmpty ? "A little room to reset" : date < lagosDate() ? "No tasks scheduled" : "No unfinished tasks"}</small></span><span class="day-count ${tasks.length && complete === tasks.length ? "is-done" : ""}">${tasks.length ? `${complete}/${tasks.length}` : futureEmpty ? "Free day" : "—"}</span></button>
      ${open ? `<div class="day-body">${tasks.length ? tasks.map(t => taskRow(t, ownerId === state.user.id)).join("") : `<div class="free-day">${futureEmpty ? "Free day · add a task when you need one." : "No tasks scheduled for this date."}</div>`}${ownerId === state.user.id && date >= lagosDate() ? htmlButton("add-task-date", "＋ Add task to this date", "button button-quiet", `data-date="${date}"`) : ""}</div>` : ""}</article>`;
  }
  function taskRow(task, editable) {
    const isDone = done(task.id); const c = state.completions.get(task.id);
    const subtitle = `${esc(taskGroup(task))}${task.priority && task.priority !== "normal" ? ` · ${esc(task.priority)}` : ""}${c?.completed_at ? ` · completed ${esc(formatTime(c.completed_at))}` : ""}`;
    const check = task.task_type === "anki" ? "Anki log" : isDone ? "Completed" : "Mark complete";
    return `<div class="task-row ${isDone ? "is-complete" : ""}" data-task-row="${esc(task.id)}"><button type="button" class="task-check" data-action="toggle-task" data-task="${esc(task.id)}" aria-label="${esc(check)}: ${esc(taskTitle(task))}" aria-pressed="${isDone}" ${editable && navigator.onLine ? "" : "disabled"}>${isDone ? "✓" : "✓"}</button><span class="task-title">${esc(taskTitle(task))}<small class="task-subtitle">${subtitle}</small></span><span class="task-side"><span class="task-type">${esc(taskTypeLabel(task.task_type))}</span>${editable ? `<button type="button" class="task-edit" data-action="edit-task" data-task="${esc(task.id)}" aria-label="Edit ${esc(taskTitle(task))}">Edit</button>` : ""}</span></div>`;
  }

  function renderCalendar(view) {
    const month = state.calendarMonth; const first = dateObj(month); const offset = first.getUTCDay(); const start = addDays(month, -offset);
    const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    const weekdayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(n => `<div class="calendar-weekday">${n}</div>`).join("");
    const cells = days.map(d => {
      const tasks = tasksForDate(view.id, d); const inMonth = d.slice(0,7) === month.slice(0,7);
      return `<button type="button" class="calendar-day ${!inMonth ? "is-outside" : ""} ${d === lagosDate() ? "is-today" : ""} ${d === state.selectedDate ? "is-selected" : ""}" data-calendar-date="${d}" aria-pressed="${d === state.selectedDate}"><span class="calendar-day-num">${dateObj(d).getUTCDate()}</span><span class="calendar-dots">${tasks.slice(0,8).map(t => `<i title="${esc(taskTitle(t))}" style="background:${done(t.id) ? "var(--teal)" : "var(--indigo)"}"></i>`).join("")}</span><small>${tasks.length ? `${tasks.filter(t=>done(t.id)).length}/${tasks.length}` : d > lagosDate() ? "Free" : ""}</small></button>`;
    }).join("");
    const dayTasks = tasksForDate(view.id, state.selectedDate);
    return `${sectionHeader("Calendar", "Browse any date. New tasks can be scheduled for today or later.", view.id === state.user.id ? htmlButton("add-task-date", "＋ Add task", "button button-primary", `data-date="${state.selectedDate}"`) : "")}
      <section class="calendar-panel surface"><div class="calendar-controls"><button type="button" class="icon-button" data-action="calendar-prev" aria-label="Previous month">‹</button><h2>${esc(formatDate(month,{month:"long",year:"numeric"}))}</h2><div class="button-row"><button type="button" class="button button-quiet" data-action="calendar-today">Today</button><button type="button" class="icon-button" data-action="calendar-next" aria-label="Next month">›</button></div></div><div class="calendar-grid">${weekdayNames}${cells}</div><div class="selected-date-tasks"><div class="section-heading"><div><h2>${esc(formatLongDate(state.selectedDate))}</h2><p>${dayTasks.length ? `${dayTasks.filter(t=>done(t.id)).length}/${dayTasks.length} tasks completed` : state.selectedDate > lagosDate() ? "Free day" : "No tasks scheduled"}</p></div></div><div class="task-list">${dayTasks.map(t => taskRow(t, view.id === state.user.id)).join("") || `<div class="empty-state">No tasks on this date.</div>`}</div></div></section>`;
  }

  function renderPlanner(view) {
    const own = view.id === state.user.id;
    const visibleCourses = state.courses.filter(c => !c.archived_at && (c.owner_id === view.id || c.visibility === "shared"));
    const courses = visibleCourses.map(c => {
      const topics = state.topics.filter(t => t.course_id === c.id && !t.archived_at);
      const sectionIds = state.sections.filter(s => !s.archived_at && topics.some(t => t.id === s.topic_id)).map(s => s.id);
      const assigned = activeTasks(view.id).filter(t => t.course_id === c.id);
      const mine = c.owner_id === state.user.id;
      return `<article class="course-card"><div class="course-card-top"><div><h3>${esc(c.title)}</h3><p>${esc(c.description || "No course description")}</p></div><span class="pill ${c.visibility === "shared" ? "is-good" : "is-private"}">${esc(c.visibility)}</span></div><div class="course-card-stats"><span>${plural(topics.length,"topic")}</span><span>${plural(sectionIds.length,"section")}</span><span>${assigned.filter(t=>done(t.id)).length}/${assigned.length} tasks</span></div><div class="button-row">${htmlButton("course-detail", "Open course", "button button-quiet", `data-course="${esc(c.id)}"`)}${own && (mine || c.visibility === "shared") ? htmlButton("schedule-course", "Schedule sections", "button button-secondary", `data-course="${esc(c.id)}"`) : ""}${own && mine ? htmlButton("edit-course", "Edit", "button button-quiet", `data-course="${esc(c.id)}"`) : ""}${own && c.visibility === "shared" && !mine ? htmlButton("join-course", state.courseMemberships.some(m=>m.course_id===c.id&&m.status==="active") ? "Joined" : "Join", "button button-quiet", `data-course="${esc(c.id)}"`) : ""}${own && !mine ? htmlButton("clone-course", "Make private copy", "button button-quiet", `data-course="${esc(c.id)}"`) : ""}${own && assigned.some(t=>!done(t.id)) ? htmlButton("clear-schedule", "Clear schedule", "button button-quiet", `data-course="${esc(c.id)}"`) : ""}</div></article>`;
    }).join("");
    const tasks = activeTasks(view.id).sort((a,b) => a.scheduled_date.localeCompare(b.scheduled_date));
    const backlogCount = tasks.filter(t => t.scheduled_date < lagosDate() && !done(t.id)).length;
    return `${sectionHeader("Study planner", own ? "Build course material, make a schedule, and move only what you approve." : "Read-only course and task view.", own ? `${htmlButton("open-import", "Import study plan", "button button-secondary")} ${htmlButton("quick-task", "＋ Add task", "button button-primary")}` : "")}
      ${own ? `<div class="button-row" style="margin-bottom:14px">${htmlButton("open-backlog", `Review backlog${backlogCount ? ` · ${backlogCount}` : ""}`, "button button-quiet")} ${htmlButton("open-recurring", "＋ Recurring task", "button button-quiet")}</div>` : ""}
      <div class="section-heading"><div><h2>Courses and material</h2><p>Shared courses are sources; every person's schedule and progress stay separate.</p></div>${own ? htmlButton("open-import", "＋ New course", "button button-quiet") : ""}</div>
      <div class="two-col">${courses || `<div class="surface empty-state"><strong>No courses yet.</strong>${own ? "Import a course outline or create a personal task." : "This member has no visible courses."}</div>`}</div>
      <div class="section-heading"><div><h2>${own ? "Your active schedule" : `${esc(view.display_name)}'s active schedule`}</h2><p>${plural(tasks.length,"task")} · cancelled/archived tasks excluded from current progress.</p></div></div>
      <div class="surface"><div class="task-list">${tasks.slice(0,160).map(t => `<div class="activity-row"><div class="activity-copy"><strong>${esc(taskTitle(t))}</strong><small>${esc(formatDate(t.scheduled_date,{weekday:"short",month:"short",day:"numeric"}))} · ${esc(taskTypeLabel(t.task_type))} · ${esc(taskGroup(t))}</small></div>${own ? htmlButton("edit-task", "Edit", "button button-quiet", `data-task="${esc(t.id)}"`) : `<span class="pill">${done(t.id) ? "complete" : "scheduled"}</span>`}</div>`).join("") || `<div class="empty-state">No active tasks yet.</div>`}</div></div>`;
  }

  function renderStatistics(view) {
    const ownerId = view.id, tasks = activeTasks(ownerId), complete = tasks.filter(t => done(t.id));
    const today = lagosDate(), weekStart = addDays(today, -6), monthStart = addDays(today, -29);
    const recent = complete.filter(t => { const c = state.completions.get(t.id); return c && c.scheduled_date_credit >= weekStart && c.scheduled_date_credit <= today; }).length;
    const onTime = complete.filter(t => { const c = state.completions.get(t.id); return c && c.scheduled_date_credit && lagosDate(new Date(c.completed_at)) <= c.scheduled_date_credit; }).length;
    const overdue = tasks.filter(t => t.scheduled_date < today && !done(t.id)).length;
    const currentDays = new Set(complete.map(t => state.completions.get(t.id)?.scheduled_date_credit).filter(Boolean));
    const consistency = currentDays.size;
    const byCourse = state.courses.filter(c => c.visibility === "shared" || c.owner_id === ownerId).map(c => {
      const ownTasks = tasks.filter(t => t.course_id === c.id && t.task_type !== "anki"); return { c, total: ownTasks.length, done: ownTasks.filter(t=>done(t.id)).length };
    }).filter(x => x.total);
    const anki = currentAnkiSummary(ownerId);
    const ownerLogs = ownerId === state.user.id ? state.ankiLogs : [];
    const pastHistory = ownerId === state.user.id ? state.audit.slice(0,12).map(a => `<div class="history-item"><span>${esc(a.action === "completed" ? "Completed" : "Reopened")} · ${esc(taskTitle(state.tasks.find(t=>t.id===a.task_id)||{task_title:"Study task"}))}</span><small>${esc(formatTime(a.event_time))}</small></div>`).join("") : "";
    return `${sectionHeader("Statistics", `Separate measures for ${view.display_name}; schedules and activity are not combined into a single score.`)}
      <div class="stat-grid"><div class="stat-box"><span>Task completion rate</span><strong>${pct(complete.length,tasks.length)}%</strong><small>${complete.length} of ${tasks.length} active tasks</small></div><div class="stat-box"><span>Course sections complete</span><strong>${complete.filter(t=>t.task_type!=="anki").length}</strong><small>Current completion state</small></div><div class="stat-box"><span>Daily plan completion · today</span><strong>${pct(tasksForDate(ownerId,today).filter(t=>done(t.id)).length,tasksForDate(ownerId,today).length)}%</strong><small>Credited to scheduled date</small></div><div class="stat-box"><span>Weekly productivity</span><strong>${recent}</strong><small>Tasks credited in last 7 days</small></div><div class="stat-box"><span>Scheduled-day completions</span><strong>${onTime}</strong><small>Completed by their credited date</small></div><div class="stat-box"><span>Overdue tasks</span><strong>${overdue}</strong><small>Current schedule, incomplete and past due</small></div><div class="stat-box"><span>Consistency</span><strong>${consistency}</strong><small>Distinct scheduled dates credited in last 30 days: ${[...currentDays].filter(d=>d>=monthStart).length}</small></div><div class="stat-box"><span>Anki cards</span><strong>${anki?.cards_total || 0}</strong><small>Target total: ${anki?.target_total || 0}</small></div><div class="stat-box"><span>Anki streak</span><strong>${anki?.current_streak || 0}d</strong><small>Longest ${anki?.longest_streak || 0} days · ${anki?.completed_days || 0} target days</small></div></div>
      <div class="two-col" style="margin-top:14px"><section class="surface"><div class="panel-title"><div><h2>Course/topic progress</h2><p>Completed active sections / assigned active sections.</p></div></div><div class="course-bars">${byCourse.map(({c,total,done:d})=>`<div class="course-bar"><span>${esc(c.title)}</span><div class="course-bar-track"><i class="course-bar-fill" style="width:${pct(d,total)}%"></i></div><em>${d}/${total}</em></div>`).join("")||`<div class="empty-state">No course tasks to measure.</div>`}</div></section><section class="surface"><div class="panel-title"><div><h2>Historical task actions</h2><p>Actual activity timestamps are separate from scheduled-date credit.</p></div></div><div class="history-list">${pastHistory || (ownerId === state.user.id ? `<div class="empty-state">No personal completion history yet.</div>` : `<p class="field-help">Personal Anki logs and audit details are only visible to their owner.</p>`)}</div></section></div>`;
  }

  function renderLeaderboards() {
    const today = lagosDate(), week = addDays(today,-6), month = addDays(today,-29);
    const metrics = state.members.map(p => {
      const tasks = activeTasks(p.id), complete = tasks.filter(t=>done(t.id));
      const weekly = complete.filter(t => { const c=state.completions.get(t.id); return c?.scheduled_date_credit>=week && c?.scheduled_date_credit<=today; }).length;
      const activeDays = new Set(complete.map(t=>state.completions.get(t.id)?.scheduled_date_credit).filter(d=>d>=month&&d<=today)).size;
      const anki = currentAnkiSummary(p.id) || {};
      return { p, done: complete.length, total: tasks.length, rate: pct(complete.length,tasks.length), weekly, activeDays, cards: anki.cards_total||0, streak: anki.current_streak||0 };
    });
    const renderMetric = (label, hint, key, unit = "") => {
      const sorted = [...metrics].sort((a,b)=>b[key]-a[key]); let last = null, rank = 0;
      return `<section class="surface"><div class="panel-title"><div><h2>${esc(label)}</h2><p>${esc(hint)}</p></div></div><div class="leader-list">${sorted.map((r,i)=>{if(r[key]!==last)rank=i+1;last=r[key];return `<div class="leader-row"><span class="rank">${rank}</span><span class="leader-copy"><strong>${esc(r.p.display_name)}</strong><small>${r.done}/${r.total} active tasks · ${r.activeDays} activity days</small></span><strong class="leader-value">${r[key]}${unit}</strong></div>`}).join("")}</div></section>`;
    };
    return `${sectionHeader("Leaderboards", "Each category stands alone. Ties share a rank; rates use active assigned tasks.")}
      <div class="two-col">${renderMetric("Tasks completed","Current completion state; each task counted once.","done")}${renderMetric("Completion rate","Completed active tasks divided by active assigned tasks.","rate","%")}${renderMetric("Weekly productivity","Tasks credited to their scheduled date in the last 7 days.","weekly")}${renderMetric("Consistency","Distinct scheduled dates credited in the last 30 days.","activeDays")}${renderMetric("Anki progress","Self-reported completed cards; target days are shown alongside.","cards")}
      <section class="surface"><div class="panel-title"><div><h2>Current Anki streak</h2><p>Consecutive days with target completion; today is in progress until the day ends.</p></div></div><div class="leader-list">${[...metrics].sort((a,b)=>b.streak-a.streak).map((r,i)=>`<div class="leader-row"><span class="rank">${i+1}</span><span class="leader-copy"><strong>${esc(r.p.display_name)}</strong><small>Longest ${currentAnkiSummary(r.p.id)?.longest_streak||0} days</small></span><strong class="leader-value">${r.streak}d</strong></div>`).join("")}</div></section></div>`;
  }

  function renderNotifications() {
    const general = state.notificationMode === "general";
    const activityRows = state.events.map(e => `<article class="notification-card ${state.activityReads.has(e.id) ? "" : "is-unread"}"><div class="notification-top"><strong>${esc(nameOf(e.actor_id))} · ${esc(e.payload?.title || "completed a task")}</strong><span class="pill">${esc(e.event_type.replaceAll("_"," "))}</span></div><p>${e.payload?.scheduled_date ? `Scheduled-date credit: ${esc(formatDate(e.payload.scheduled_date))}.` : "Group study activity."}</p><small>${esc(formatTime(e.created_at))}</small></article>`).join("");
    const noticeRows = state.notifications.filter(n => n.recipient_id === null && !n.archived_at).map(n => {
      const receipt = state.notificationReceipts.get(n.id); return `<article class="notification-card ${receipt?.read_at ? "" : "is-unread"}"><div class="notification-top"><strong>${esc(n.title)}</strong><span class="pill">Group</span></div><p>${esc(n.body)}</p><small>${esc(formatTime(n.created_at))}</small>${!receipt?.read_at ? `<div class="notification-actions"><button type="button" class="button button-quiet" data-action="read-general-notice" data-notice="${esc(n.id)}">Mark read</button></div>` : ""}</article>`;
    }).join("");
    const personalRows = state.notifications.filter(n => n.recipient_id === state.user.id && !n.archived_at).map(n => `<article class="notification-card ${n.read_at ? "" : "is-unread"}"><div class="notification-top"><strong>${esc(n.title)}</strong><span class="pill is-private">Personal</span></div><p>${esc(n.body)}</p>${n.notification_type === "reschedule_suggestion" ? `<div class="button-row">${htmlButton("review-suggestion", "Review proposed dates", "button button-secondary", `data-notice="${esc(n.id)}"`)}</div>` : ""}<small>${esc(formatTime(n.created_at))}</small><div class="notification-actions">${!n.read_at ? `<button type="button" class="button button-quiet" data-action="read-notice" data-notice="${esc(n.id)}">Mark read</button>` : ""}<button type="button" class="button button-quiet" data-action="archive-notice" data-notice="${esc(n.id)}">Archive</button></div></article>`).join("");
    return `${sectionHeader("Notifications", "Group activity and private reminders never share the same audience.", `<button type="button" class="button button-quiet" data-action="mark-all-read">Mark all read</button>`)}
      <div class="tab-switch" role="tablist" aria-label="Notification type"><button type="button" class="tab-button ${general?"is-active":""}" role="tab" aria-selected="${general}" data-notification-mode="general">General</button><button type="button" class="tab-button ${!general?"is-active":""}" role="tab" aria-selected="${!general}" data-notification-mode="personal">Personal</button></div>
      <div class="stack" style="margin-top:13px">${general ? `${activityRows}${noticeRows}` || `<div class="surface empty-state"><strong>No group activity yet.</strong>Completion events from active members will appear here.</div>` : personalRows || `<div class="surface empty-state"><strong>No personal reminders.</strong>Private rescheduling suggestions and account notices will appear here.</div>`}</div>`;
  }

  function renderSettings() {
    const target=currentTarget(state.user.id),legacy=state.privateProfile?.legacy_person_key,preferences=state.preferences||{};
    const recurrences=state.recurringRules.map(r=>`<div class="history-item"><span><strong>${esc(r.title)}</strong><small>${esc(r.recurrence)} · ${esc(r.status)} · next ${esc(formatDate(r.next_date))}</small></span><div class="button-row">${r.status!=="stopped"?htmlButton("edit-recurring","Edit","button button-quiet",`data-rule="${esc(r.id)}"`):""}${r.status==="active"?htmlButton("pause-recurring","Pause","button button-quiet",`data-rule="${esc(r.id)}"`):r.status==="paused"?htmlButton("resume-recurring","Resume","button button-secondary",`data-rule="${esc(r.id)}"`):""}${r.status!=="stopped"?htmlButton("stop-recurring","Stop","button button-quiet",`data-rule="${esc(r.id)}"`):""}</div></div>`).join("");
    const recurrenceHistory=state.recurringRuleHistory.slice(0,8).map(h=>`<div class="history-item"><span>${esc(h.change_type)} · ${esc(state.recurringRules.find(r=>r.id===h.rule_id)?.title||"Recurring task")}</span><small>${esc(formatTime(h.created_at))}</small></div>`).join("");
    const unresolved=state.unmappedTicks.length?`<div class="callout"><strong>${plural(state.unmappedTicks.length,"legacy tick needs mapping")}</strong><p>These original records are preserved, but no task is being guessed. Ask the project owner to map each item before it is counted.</p><div class="history-list">${state.unmappedTicks.slice(0,12).map(x=>`<div class="history-item"><span>${esc(x.item_id)}</span><small>imported ${esc(formatTime(x.imported_at))}</small></div>`).join("")}</div></div>`:"";
    return `${sectionHeader("Profile & settings","Your email and private Anki logs are not shown to the group.")}
      <div class="two-col">
        <section class="surface"><div class="panel-title"><div><h2>Profile</h2><p>Display name is separate from the permanent legacy identity.</p></div></div>
          <form id="profile-form" class="form-stack"><label>Display name<input name="display_name" value="${esc(state.profile?.display_name||"")}" minlength="1" maxlength="80" required></label><button type="submit" class="button button-primary">Save profile</button></form>
          <div class="section-heading"><div><h3>Legacy study history</h3><p>${legacy?"A one-time identity is linked to this account; its display name can be changed without transferring the records.":"Existing participants can enter their privately supplied single-use claim code."}</p></div></div>${!legacy?htmlButton("claim-legacy","Enter claim code","button button-secondary"):""}${unresolved}
          <div class="button-row" style="margin-top:14px">${htmlButton("reset-password","Send password reset link","button button-quiet")}</div>
        </section>
        <section class="surface"><div class="panel-title"><div><h2>Study preferences</h2><p>Displayed dates use Africa/Lagos.</p></div></div><form id="preferences-form" class="form-stack"><label>Theme<select name="theme"><option value="dark" ${state.theme==="dark"?"selected":""}>Dark (default)</option><option value="light" ${state.theme==="light"?"selected":""}>Light</option></select></label><label>Preferred daily section capacity (optional)<input type="number" name="daily_section_capacity" min="1" max="100" step="1" value="${esc(preferences.daily_section_capacity||"")}" placeholder="Leave blank for no capacity guide"></label><button type="submit" class="button button-primary">Save preferences</button></form></section>
        <section class="surface"><div class="panel-title"><div><h2>Anki target</h2><p>Self-reported cards; no automatic AnkiDroid connection.</p></div></div><form id="anki-target-form" class="form-stack"><label>Daily card target<input type="number" name="target_count" min="1" max="100000" step="1" value="${esc(target?.target_count||"")}" placeholder="Set your own target" required></label><label>Effective from<input type="date" name="effective_from" min="${lagosDate()}" value="${lagosDate()}" required></label><button type="submit" class="button button-primary">Save target</button></form><div class="history-list" style="margin-top:12px">${state.ankiTargets.map(t=>`<div class="history-item"><span>${t.target_count} cards</span><small>from ${esc(formatDate(t.effective_from,{month:"short",day:"numeric",year:"numeric"}))}</small></div>`).join("")||`<p class="field-help">No target history yet.</p>`}</div></section>
        <section class="surface"><div class="panel-title"><div><h2>Recurring tasks</h2><p>Generated occurrences have stable IDs. Completed and past instances remain unchanged.</p></div>${htmlButton("open-recurring","＋ Add rule","button button-quiet")}</div><div class="history-list">${recurrences||`<p class="field-help">No recurring rules yet.</p>`}</div><div class="section-heading"><div><h3>Recent rule history</h3><p>Changes and pauses are retained.</p></div></div><div class="history-list">${recurrenceHistory||`<p class="field-help">No rule changes yet.</p>`}</div></section>
        <section class="surface"><div class="panel-title"><div><h2>Data portability</h2><p>Exports are personal to this account; restore never writes another person's records.</p></div></div><div class="button-row">${htmlButton("export-json","Download JSON backup","button button-secondary")}${htmlButton("export-csv","Download CSV","button button-quiet")}${htmlButton("restore-backup","Preview restore","button button-quiet")}</div><div style="margin-top:16px"><h3>Group membership</h3><p class="field-help">Leaving preserves your account, personal data, and history. You can rejoin later.</p>${htmlButton("leave-group","Leave Tetralogy","button button-danger")}</div></section>
      </div>`;
  }

  function openDialog(title, content, label = "") {
    const dialog = $("#app-dialog"); $("#dialog-title").textContent = title; $("#dialog-content").innerHTML = content;
    dialog.setAttribute("aria-label", label || title); if (!dialog.open) dialog.showModal();
  }
  function closeDialog() { const d = $("#app-dialog"); if (d.open) d.close(); state.pendingProposal = null; }
  function dayDateInput(name, value, min = lagosDate()) { return `<input type="date" name="${esc(name)}" value="${esc(value)}" min="${esc(min)}" required>`; }
  function openClaimDialog() {
    openDialog("Claim existing study records", `<p class="callout">Only a privately supplied, single-use code can link a legacy identity. Do not choose a participant from a list. Your existing display name is restored when the claim succeeds.</p><form id="claim-form" class="form-stack" style="margin-top:13px"><label>One-time claim code<input name="claim_code" type="password" autocomplete="off" minlength="12" maxlength="200" required></label><button class="button button-primary" type="submit">Claim identity</button></form>`);
  }
  function openQuickTask(date = lagosDate()) {
    if (!requireOwner()) return toast("Only your own account can add tasks.");
    openDialog("Add a study task", `<form id="quick-task-form" class="form-stack"><label>Task title<input name="task_title" maxlength="240" required></label><div class="field-grid"><label>Type<select name="task_type"><option value="study">Study / reading</option><option value="anki">Anki cards</option><option value="practice">Practice questions</option><option value="revision">Revision</option><option value="practical">Practical preparation</option><option value="assignment">Assignment</option><option value="custom">Custom</option></select></label><label>Priority<select name="priority"><option value="critical">Critical</option><option value="high">High</option><option value="normal" selected>Normal</option><option value="low">Low</option></select></label><label>Scheduled date${dayDateInput("scheduled_date", date)}</label><label>Deadline<input type="date" name="deadline" min="${lagosDate()}"></label></div><label>Course (optional)<select name="course_id"><option value="">No course</option>${state.courses.filter(c=>!c.archived_at&&(c.owner_id===state.user.id||c.visibility==="shared")).map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join("")}</select></label><button class="button button-primary" type="submit">Add task</button></form>`);
  }
  function openDeadlineDialog() {
    openDialog("Add an exam or deadline", `<form id="deadline-form" class="form-stack"><label>Title<input name="title" maxlength="160" required></label><label>Description<textarea name="description" maxlength="4000"></textarea></label><div class="field-grid"><label>Date${dayDateInput("due_date", lagosDate())}</label><label>Priority<select name="priority"><option value="critical">Critical</option><option value="high">High</option><option value="normal" selected>Normal</option><option value="low">Low</option></select></label><label>Visibility<select name="visibility"><option value="private">Only me</option><option value="group">Group-wide</option></select></label><label>Course (optional)<select name="course_id"><option value="">No course</option>${state.courses.filter(c=>!c.archived_at&&(c.owner_id===state.user.id||c.visibility==="shared")).map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join("")}</select></label></div><button class="button button-primary" type="submit">Save deadline</button></form>`);
  }
  function recurrenceCourseOptions(selected = "") {
    return `<option value="">No course</option>${state.courses.filter(c=>!c.archived_at&&(c.owner_id===state.user.id||c.visibility==="shared")).map(c=>`<option value="${esc(c.id)}" ${c.id===selected?"selected":""}>${esc(c.title)}</option>`).join("")}`;
  }
  function openRecurringDialog() {
    openDialog("Create recurring task", `<form id="recurring-form" class="form-stack"><label>Task title<input name="title" maxlength="200" required></label><div class="field-grid"><label>Type<select name="task_type"><option value="study">Study / reading</option><option value="anki">Anki</option><option value="practice">Practice questions</option><option value="revision">Revision</option><option value="custom">Custom</option></select></label><label>Repeats<select name="recurrence"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="weekdays">Selected weekdays</option></select></label><label>Start date${dayDateInput("start_date",lagosDate())}</label><label>Stop after (optional)<input type="date" name="active_until" min="${lagosDate()}"></label><label>Priority<select name="priority"><option value="critical">Critical</option><option value="high">High</option><option value="normal" selected>Normal</option><option value="low">Low</option></select></label><label>Course (optional)<select name="course_id">${recurrenceCourseOptions()}</select></label></div><fieldset class="form-section"><legend>Weekdays (used when repeats is “Selected weekdays”)</legend><div class="button-row">${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((n,i)=>`<label class="check-line"><input type="checkbox" name="weekdays" value="${i}">${n}</label>`).join("")}</div></fieldset><button class="button button-primary" type="submit">Create recurrence</button></form>`);
  }
  function openRecurringEdit(id) {
    const r=state.recurringRules.find(x=>x.id===id);if(!r||r.status==="stopped")return;
    const days=new Set(r.weekdays||[]);
    openDialog("Edit recurring task", `<form id="edit-recurring-form" data-rule="${esc(r.id)}" class="form-stack"><p class="callout">Only future uncompleted occurrences are adjusted. Completed occurrences and past dates remain unchanged.</p><label>Task title<input name="title" value="${esc(r.title)}" maxlength="200" required></label><div class="field-grid"><label>Type<select name="task_type">${[["study","Study / reading"],["anki","Anki"],["practice","Practice questions"],["revision","Revision"],["practical","Practical"],["assignment","Assignment"],["custom","Custom"]].map(([v,l])=>`<option value="${v}" ${r.task_type===v?"selected":""}>${l}</option>`).join("")}</select></label><label>Repeats<select name="recurrence">${[["daily","Daily"],["weekly","Weekly"],["weekdays","Selected weekdays"]].map(([v,l])=>`<option value="${v}" ${r.recurrence===v?"selected":""}>${l}</option>`).join("")}</select></label><label>Start date${dayDateInput("start_date",r.start_date,r.start_date<lagosDate()?r.start_date:lagosDate())}</label><label>Stop after (optional)<input type="date" name="active_until" min="${r.active_until&&r.active_until<lagosDate()?r.active_until:lagosDate()}" value="${esc(r.active_until||"")}"></label><label>Priority<select name="priority">${["critical","high","normal","low"].map(v=>`<option value="${v}" ${r.priority===v?"selected":""}>${v}</option>`).join("")}</select></label><label>Course (optional)<select name="course_id">${recurrenceCourseOptions(r.course_id||"")}</select></label></div><fieldset class="form-section"><legend>Weekdays (for selected weekdays)</legend><div class="button-row">${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((n,i)=>`<label class="check-line"><input type="checkbox" name="weekdays" value="${i}" ${days.has(i)?"checked":""}>${n}</label>`).join("")}</div></fieldset><button class="button button-primary" type="submit">Save future rule changes</button></form>`);
  }
  async function saveRecurringEdit(form) {
    const weekdays=[...form.querySelectorAll('[name="weekdays"]:checked')].map(x=>Number(x.value));
    if(form.elements.recurrence.value==="weekdays"&&!weekdays.length)return toast("Choose at least one weekday.");
    const patch={title:form.elements.title.value.trim(),task_type:form.elements.task_type.value,recurrence:form.elements.recurrence.value,weekdays,start_date:form.elements.start_date.value,active_until:form.elements.active_until.value||"",priority:form.elements.priority.value,course_id:form.elements.course_id.value||""};
    const r=await state.sb.rpc("manage_recurring_rule",{p_rule_id:form.dataset.rule,p_action:"edit",p_patch:patch});
    if(r.error)return toast(`Rule not updated: ${errorText(r.error)}`);
    closeDialog();toast("Rule saved. Only future uncompleted occurrences were changed.");await loadData({quiet:true});
  }
  async function manageRecurring(id,action) {
    const r=state.recurringRules.find(x=>x.id===id);if(!r)return;
    const message={pause:"Pause this rule and cancel future uncompleted occurrences? Completed work and history will remain.",resume:"Resume this rule and restore its paused future occurrences?",stop:"Stop this rule and cancel its future uncompleted occurrences? This cannot be resumed."}[action];
    if(message&& !confirm(message))return;
    const result=await state.sb.rpc("manage_recurring_rule",{p_rule_id:id,p_action:action,p_patch:{}});
    if(result.error)return toast(`Rule not changed: ${errorText(result.error)}`);
    toast(action==="stop"?"Rule stopped. Existing history was retained.":action==="pause"?"Rule paused.":"Rule resumed.");await loadData({quiet:true});
  }

  function openCourseDetail(courseId) {
    const course = courseOf(courseId); if (!course) return;
    const topics = state.topics.filter(t=>t.course_id===courseId&&!t.archived_at).sort((a,b)=>a.sequence_number-b.sequence_number);
    const joined = state.courseMemberships.some(m=>m.course_id===courseId&&m.status==="active");
    const rows = topics.map(topic=>`<div class="form-section"><h3>${esc(topic.title)}</h3>${state.sections.filter(s=>s.topic_id===topic.id&&!s.archived_at).sort((a,b)=>a.sequence_number-b.sequence_number).map(s=>`<label class="check-line"><input type="checkbox" name="adopt_section" value="${esc(s.id)}" ${state.courseSelections.some(x=>x.course_id===courseId&&x.section_id===s.id)?"checked":""}>${esc(s.title)}</label>`).join("")}</div>`).join("") || `<div class="empty-state">No topics or sections.</div>`;
    openDialog(course.title, `<p class="callout">${esc(course.description||"No description")}${course.visibility==="shared"?" · Shared with active group members.":" · Private to its owner."}</p><div class="button-row" style="margin:12px 0">${course.visibility==="shared"&&state.viewerId===state.user.id?htmlButton("join-course",joined?"Leave shared course":"Join shared course","button button-secondary",`data-course="${esc(courseId)}"`):""}${course.owner_id===state.user.id?htmlButton("edit-course","Edit course","button button-quiet",`data-course="${esc(courseId)}"`):""}${course.owner_id===state.user.id&&course.visibility==="shared"?htmlButton("transfer-course","Transfer ownership","button button-quiet",`data-course="${esc(courseId)}"`):""}${state.viewerId===state.user.id?htmlButton("clone-course","Make a private copy","button button-quiet",`data-course="${esc(courseId)}"`):""}</div><form id="adopt-form" data-course="${esc(courseId)}"><div class="preview-list">${rows}</div><div class="button-row">${htmlButton("adopt-whole-course","Adopt all sections","button button-secondary",`data-course="${esc(courseId)}"`)}<button type="submit" class="button button-primary">Adopt selected sections</button></div></form>`);
  }
  function openCourseEdit(courseId) {
    const c=courseOf(courseId); if(!c||c.owner_id!==state.user.id) return toast("Only the course owner can edit shared structure.");
    const topics=state.topics.filter(t=>t.course_id===c.id&&!t.archived_at);
    const structure=topics.map(t=>({title:t.title,sequence:t.sequence_number,sections:state.sections.filter(s=>s.topic_id===t.id&&!s.archived_at).map(s=>({title:s.title,sequence:s.sequence_number,description:s.description}))}));
    openDialog("Edit course structure", `<form id="edit-course-form" data-course="${esc(c.id)}" class="form-stack"><label>Course title<input name="title" value="${esc(c.title)}" maxlength="120" required></label><label>Description<textarea name="description" maxlength="4000">${esc(c.description)}</textarea></label><label>Visibility<select name="visibility"><option value="private" ${c.visibility==="private"?"selected":""}>Private</option><option value="shared" ${c.visibility==="shared"?"selected":""}>Shared with the active group</option></select></label><label>Topic and section outline<textarea name="structure" rows="12" required>${esc(JSON.stringify(structure,null,2))}</textarea></label><p class="field-help">The outline above changes titles and order. Participant dates and completions stay separate. To remove material, use the buttons below.</p><button type="submit" class="button button-primary">Save course outline</button><div class="form-section"><h3>Remove material</h3>${topics.map(t=>`<div class="history-item"><span><strong>${esc(t.title)}</strong></span><button type="button" class="text-button" data-action="remove-topic" data-id="${esc(t.id)}" data-course="${esc(c.id)}">Remove topic</button></div>${state.sections.filter(x=>x.topic_id===t.id&&!x.archived_at).map(x=>`<div class="history-item"><span>${esc(x.title)}</span><button type="button" class="text-button" data-action="remove-section" data-id="${esc(x.id)}" data-course="${esc(c.id)}">Remove</button></div>`).join("")}`).join("")||"<p class='field-help'>No material yet.</p>"}</div><button type="button" class="button button-secondary" data-action="archive-course" data-course="${esc(c.id)}">Archive this whole course</button></form>`);
  }

  function openImportDialog() {
    state.importDraft=null; state.importChoices={}; state.importDestination="new";
    const opts=state.courses.filter(c=>!c.archived_at&&c.owner_id===state.user.id).map(c=>`<option value="${esc(c.id)}">Add to ${esc(c.title)}</option>`).join("");
    openDialog("Import a study plan", `<p class="callout">Use any external AI tool. Paste the returned JSON below, review duplicate suggestions and choose whether to keep, skip, or rename them. Importing material does not schedule it.</p><div class="form-stack" style="margin-top:13px"><label>Destination<select id="import-destination"><option value="new">Create a new course</option>${opts}</select></label><label>Copyable prompt<textarea id="import-prompt" readonly rows="6">Return JSON only using this shape: {"course_title":"Course title","description":"Optional description","topics":[{"title":"Topic title","sequence":1,"sections":[{"title":"Section title","sequence":1,"description":"Optional","source_reference":"Optional","prerequisites":[],"notes":"Optional"}]}]}. Preserve the source order. Do not include scripts, HTML, or executable content.</textarea></label><button type="button" class="button button-quiet" data-action="copy-import-prompt">Copy prompt</button><label>Study-plan JSON<textarea id="import-json" rows="9" placeholder="Paste the structured JSON returned by your external AI tool"></textarea></label><div class="button-row"><button type="button" class="button button-secondary" data-action="preview-import">Validate and preview</button></div><div id="import-preview"></div></div>`);
  }
  function normalized(value) { return String(value||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }
  function validateImport(raw) {
    if (raw.length > 1_000_000) throw new Error("Import is larger than 1 MB.");
    let obj; try { obj=JSON.parse(raw); } catch { throw new Error("That is not valid JSON."); }
    if (!obj || typeof obj!=="object" || Array.isArray(obj)) throw new Error("The top level must be a JSON object.");
    if(typeof obj.course_title!=="string"||obj.course_title.trim().length<1||obj.course_title.length>120) throw new Error("course_title must contain 1–120 characters.");
    if(obj.description!=null&&(typeof obj.description!=="string"||obj.description.length>4000)) throw new Error("description must be text up to 4,000 characters.");
    if(!Array.isArray(obj.topics)||obj.topics.length<1||obj.topics.length>200) throw new Error("topics must contain 1–200 entries.");
    let total=0;
    obj.topics.forEach((t,ti)=>{
      if(!t||typeof t!=="object"||typeof t.title!=="string"||!t.title.trim()||t.title.length>160||!Number.isInteger(Number(t.sequence))||Number(t.sequence)<1) throw new Error(`Topic ${ti+1} needs a title and positive integer sequence.`);
      if(!Array.isArray(t.sections)||t.sections.length>500) throw new Error(`Topic ${ti+1} must contain a sections array (maximum 500).`);
      t.sections.forEach((s,si)=>{
        if(!s||typeof s!=="object"||typeof s.title!=="string"||!s.title.trim()||s.title.length>200||!Number.isInteger(Number(s.sequence))||Number(s.sequence)<1) throw new Error(`Section ${si+1} in topic ${ti+1} needs a title and positive integer sequence.`);
        for(const key of ["description","source_reference","notes"]) if(s[key]!=null&&(typeof s[key]!=="string"||s[key].length>(key==="description"?8000:key==="source_reference"?1000:4000))) throw new Error(`Section ${si+1} has an invalid ${key}.`);
        if(s.prerequisites!=null&&(!Array.isArray(s.prerequisites)||s.prerequisites.some(x=>typeof x!=="string"||x.length>200))) throw new Error("prerequisites must be an array of short strings.");
        total++;
      });
      if(t.description!=null&&(typeof t.description!=="string"||t.description.length>4000)) throw new Error(`Topic ${ti+1} description is too long.`);
    });
    if(total>2000) throw new Error("An import may contain at most 2,000 sections.");
    return obj;
  }
  function previewImport() {
    const target=$("#import-destination")?.value||"new"; state.importDestination=target;
    try {
      const parsed=validateImport($("#import-json").value); state.importDraft=parsed;
      const targetCourse=target!=="new"?courseOf(target):null;
      const existing=new Set();
      if(targetCourse){const top=state.topics.filter(t=>t.course_id===targetCourse.id);for(const t of top){existing.add(`topic:${normalized(t.title)}`);for(const s of state.sections.filter(x=>x.topic_id===t.id))existing.add(`section:${normalized(t.title)}:${normalized(s.title)}`);}}
      else for(const c of state.courses)if(normalized(c.title)===normalized(parsed.course_title)) existing.add("course:"+normalized(c.title));
      const dups=[];
      parsed.topics.forEach((t,ti)=>{
        if(existing.has(`topic:${normalized(t.title)}`)) dups.push({kind:"topic",key:`topic:${ti}`,label:`Topic “${t.title}” already exists in this course.`});
        t.sections.forEach((s,si)=>{if(existing.has(`section:${normalized(t.title)}:${normalized(s.title)}`)) dups.push({kind:"section",key:`${ti}:${si}`,label:`${t.title} · ${s.title}`});});
      });
      if(!targetCourse&&existing.has("course:"+normalized(parsed.course_title))) dups.unshift({kind:"course",key:"course",label:`A course named “${parsed.course_title}” already exists.`});
      for(const d of dups) if(!state.importChoices[d.key]) state.importChoices[d.key]="keep";
      const appendSequences=new Map();
      if(targetCourse){let next=Math.max(0,...state.topics.filter(t=>t.course_id===targetCourse.id).map(t=>t.sequence_number||0));for(const {index:ti,value:t} of parsed.topics.map((value,index)=>({value,index})).sort((a,b)=>a.value.sequence-b.value.sequence)){if((state.importChoices[`topic:${ti}`]||"keep")!=="skip")appendSequences.set(ti,++next);}}
      const rows=parsed.topics.flatMap((t,ti)=>[{kind:"topic",key:`topic:${ti}`,label:targetCourse?`Source ${t.sequence} → new topic ${appendSequences.get(ti)||"skipped"}: ${t.title}`:`${t.sequence}. ${t.title}`,duplicate:dups.find(x=>x.key===`topic:${ti}`)},...t.sections.map((s,si)=>({kind:"section",key:`${ti}:${si}`,label:`${t.title} · ${s.sequence}. ${s.title}`,duplicate:dups.find(x=>x.key===`${ti}:${si}`)}))]);
      const duplicateHtml=dups.map(d=>`<div class="preview-row"><span>${esc(d.label)}</span><small>Possible duplicate</small><select data-import-choice="${esc(d.key)}"><option value="keep" ${state.importChoices[d.key]==="keep"?"selected":""}>Keep</option><option value="skip" ${state.importChoices[d.key]==="skip"?"selected":""}>Skip</option><option value="rename" ${state.importChoices[d.key]==="rename"?"selected":""}>Rename</option></select>${state.importChoices[d.key]==="rename"?`<input data-import-rename="${esc(d.key)}" value="${esc(state.importChoices[d.key+":name"]||"")}" placeholder="New name" maxlength="200">`:""}</div>`).join("");
      const el=$("#import-preview"); el.innerHTML=`<div class="preview-warning">Validated: ${parsed.topics.length} topics, ${rows.filter(r=>r.kind==="section").length} sections. ${state.importDestination!=="new"?"New topics will be appended after existing topics in the order shown; section order within each topic is retained.":"Topic and section order is retained."} This only imports content; scheduling is a separate step.${dups.length?` Review ${dups.length} possible duplicate(s) below.`:" No likely duplicates were found."}</div>${duplicateHtml?`<div class="preview-list">${duplicateHtml}</div>`:""}<div class="preview-list">${rows.slice(0,80).map(r=>`<div class="preview-row"><span>${esc(r.label)}</span><small>${esc(r.kind)}</small></div>`).join("")}${rows.length>80?`<p class="field-help">Showing the first 80 rows; all ${rows.length} validated.</p>`:""}</div><div class="dialog-actions"><button type="button" class="button button-primary" data-action="commit-import">Confirm material import</button></div>`;
    } catch(e) { state.importDraft=null; $("#import-preview").innerHTML=`<p class="form-feedback is-error">${esc(errorText(e))}</p>`; }
  }
  function importPayload() {
    const obj=structuredClone(state.importDraft); const topics=[];
    for(let ti=0;ti<obj.topics.length;ti++){
      const t=obj.topics[ti], topicChoice=state.importChoices[`topic:${ti}`]||"keep";
      if(topicChoice==="skip") continue;
      if(topicChoice==="rename") t.title=(state.importChoices[`topic:${ti}:name`]||"").trim()||t.title;
      const sections=[];
      for(let si=0;si<t.sections.length;si++){
        const s=t.sections[si], key=`${ti}:${si}`, choice=state.importChoices[key]||"keep";
        if(choice==="skip") continue;
        if(choice==="rename") s.title=(state.importChoices[key+":name"]||"").trim()||s.title;
        sections.push(s);
      }
      topics.push({...t,sections});
    }
    return {title:obj.course_title,description:obj.description||"",topics};
  }
  async function commitImport() {
    if(!state.importDraft) return toast("Validate the JSON before confirming.");
    const body=importPayload(); if(!body.topics.length) return toast("All topics are marked skip; nothing was imported.");
    try {
      const destination=state.importDestination;
      let result;
      if(destination!=="new") result=await state.sb.rpc("append_course_material",{p_course_id:destination,p_topics:body.topics});
      else result=await state.sb.rpc("create_course_from_import",{p_course_title:body.title,p_description:body.description,p_topics:body.topics,p_visibility:"private"});
      if(result.error) throw result.error;
      closeDialog(); toast(destination==="new"?"Course material imported. Schedule it when you're ready.":"New material added to the course."); await loadData({quiet:true});
    } catch(e){toast(`Import was not saved: ${errorText(e)}`);}
  }

  function openSchedule(courseId) {
    const c=courseOf(courseId); if(!c||isReadOnly()) return;
    const topics=state.topics.filter(t=>t.course_id===c.id&&!t.archived_at);
    let sections=topics.flatMap(t=>state.sections.filter(s=>s.topic_id===t.id&&!s.archived_at).sort((a,b)=>a.sequence_number-b.sequence_number).map(s=>({s,t})));
    if(c.visibility==="shared"&&c.owner_id!==state.user.id){
      const adopted=new Set(state.courseSelections.filter(x=>x.course_id===c.id&&x.section_id).map(x=>x.section_id));
      sections=sections.filter(x=>adopted.has(x.s.id));
    }
    if(!sections.length) return toast("This course has no active sections to schedule.");
    const existing=new Set(activeTasks(state.user.id).filter(t=>t.section_id).map(t=>t.section_id));
    const available=sections.filter(x=>!existing.has(x.s.id));
    if(!available.length) return toast("All active sections in this course are already scheduled.");
    state.pendingProposal={kind:"course",course:c,sections:available};
    openDialog("Schedule course sections", `<form id="schedule-form" class="form-stack"><p class="callout">The proposal preserves topic and section order, shows daily task counts, and never commits until you approve it.</p><div class="field-grid"><label>Start date${dayDateInput("start_date",lagosDate())}</label><label>Target deadline${dayDateInput("deadline",addDays(lagosDate(),14))}</label><label>Priority<select name="priority"><option value="critical">Critical</option><option value="high">High</option><option value="normal" selected>Normal</option><option value="low">Low</option></select></label><label>Daily section capacity (optional)<input type="number" name="capacity" min="1" max="100" value="${esc(state.preferences.daily_section_capacity||"")}" placeholder="No capacity guide"></label></div><fieldset class="form-section"><legend>Unavailable weekdays</legend><div class="button-row">${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((n,i)=>`<label class="check-line"><input type="checkbox" name="unavailable" value="${i}">${n}</label>`).join("")}</div></fieldset><button type="submit" class="button button-secondary">Preview schedule</button></form><div id="schedule-preview"></div>`);
  }
  function scheduleProposal(form) {
    const start=form.elements.start_date.value, deadline=form.elements.deadline.value, priority=form.elements.priority.value;
    if(start<lagosDate()) throw new Error("Start date cannot be in the past.");
    if(deadline<start) throw new Error("Deadline must be on or after the start date.");
    const capacity=Number(form.elements.capacity.value)||null, unavailable=new Set([...form.querySelectorAll('[name="unavailable"]:checked')].map(x=>Number(x.value)));
    const sections=state.pendingProposal?.sections||[]; const proposed=[]; const loads=new Map();
    for(const t of activeTasks(state.user.id).filter(t=>t.scheduled_date>=start&&t.scheduled_date<=deadline)) loads.set(t.scheduled_date,(loads.get(t.scheduled_date)||0)+1);
    let date=start, attempts=0;
    for(const {s,t} of sections){
      while(date<=deadline&&(unavailable.has(dayCode(date))||(capacity&&((loads.get(date)||0)>=capacity)))&&attempts<5000){date=addDays(date,1);attempts++;}
      if(date>deadline||attempts>=5000) throw new Error("The selected deadline, capacity, and unavailable days leave no feasible date for every section. Widen the deadline or revise the capacity/preferences.");
      proposed.push({task_title:s.title,task_type:"study",scheduled_date:date,deadline,priority,course_id:state.pendingProposal.course.id,section_id:s.id,sequence_number:s.sequence_number,sequence_override_confirmed:false,idempotency_key:`section:${state.user.id}:${state.pendingProposal.course.id}:${s.id}`});
      loads.set(date,(loads.get(date)||0)+1); date=addDays(date,1); attempts=0;
    }
    return {start,deadline,priority,capacity,unavailable:[...unavailable],tasks:proposed,loads};
  }
  function showSchedulePreview(proposal) {
    state.pendingProposal={...state.pendingProposal,proposal};
    const rows=proposal.tasks.map((t,i)=>`<div class="suggestion-task"><span>${i+1}. ${esc(t.task_title)}</span><label>Schedule on<input type="date" min="${esc(lagosDate())}" value="${esc(t.scheduled_date)}" data-proposal-date="${i}"></label></div>`).join("");
    $("#schedule-preview").innerHTML=`<p id="schedule-load-summary" class="callout" role="status" aria-live="polite"></p><p id="schedule-capacity-warning" class="preview-warning" role="status" aria-live="polite" hidden></p><div id="schedule-order-warning" class="preview-warning" role="status" aria-live="polite" hidden></div><label id="schedule-order-confirm-row" class="check-line" hidden><input type="checkbox" id="schedule-order-confirm"> I explicitly approve the new out-of-order section dates shown above.</label><div class="preview-list">${rows}</div><div class="dialog-actions"><button type="button" class="button button-primary" data-action="commit-schedule">Approve and schedule</button></div>`;
    $$('[data-proposal-date]').forEach(el=>el.addEventListener("input",refreshScheduleOrder));refreshScheduleOrder();
  }
  function refreshScheduleOrder() {
    const proposal=state.pendingProposal?.proposal;if(!proposal)return;
    const changes=proposal.tasks.map((t,i)=>({...t,scheduled_date:document.querySelector(`[data-proposal-date="${i}"]`)?.value||t.scheduled_date}));
    const conflicts=scheduledOrderConflicts(changes),warning=$("#schedule-order-warning"),row=$("#schedule-order-confirm-row"),check=$("#schedule-order-confirm");
    if(!warning||!row||!check)return;
    row.hidden=conflicts.pairs.length===0;warning.hidden=conflicts.pairs.length===0;
    warning.textContent=conflicts.pairs.length?`This proposal places ${conflicts.pairs.length} section pair(s) out of order: ${conflicts.pairs.slice(0,4).map(p=>p.join(" → ")).join("; ")}${conflicts.pairs.length>4?"; more pairs also conflict":""}. The normal section order is preserved unless you explicitly confirm.`:"";
    if(!conflicts.pairs.length)check.checked=false;
    const loads=new Map();
    for(const t of activeTasks(state.user.id))loads.set(t.scheduled_date,(loads.get(t.scheduled_date)||0)+1);
    for(const t of changes)loads.set(t.scheduled_date,(loads.get(t.scheduled_date)||0)+1);
    const relevant=[...loads].filter(([d])=>changes.some(t=>t.scheduled_date===d)).sort(([a],[b])=>a.localeCompare(b));
    const summary=$("#schedule-load-summary"),capacityWarning=$("#schedule-capacity-warning");
    if(summary)summary.textContent=`${changes.length} sections · ${new Set(changes.map(t=>t.scheduled_date)).size} proposed study dates · daily counts: ${relevant.slice(0,8).map(([d,n])=>`${formatDate(d,{month:"short",day:"numeric"})} ${n}`).join(" · ")}${relevant.length>8?" · more dates shown below":""}.`;
    if(capacityWarning){const overloaded=proposal.capacity?relevant.filter(([,n])=>n>proposal.capacity):[];capacityWarning.hidden=overloaded.length===0;capacityWarning.textContent=overloaded.length?`Daily guide of ${proposal.capacity} sections is exceeded on ${overloaded.length} date(s). You may edit dates or adjust the guide; no section will be dropped.`:"";}
  }
  async function commitSchedule() {
    const proposal=state.pendingProposal?.proposal; if(!proposal) return;
    const dates=$$('[data-proposal-date]').map(el=>el.value);
    if(dates.some(d=>!d||d<lagosDate()||d>proposal.deadline)) return toast("Every section must be scheduled today or later and on or before the selected deadline.");
    const proposed=proposal.tasks.map((t,i)=>({...t,scheduled_date:dates[i]})),conflicts=scheduledOrderConflicts(proposed);
    if(conflicts.pairs.length&&!$("#schedule-order-confirm")?.checked){refreshScheduleOrder();return toast("This creates a new out-of-order section plan. Review the warning and explicitly confirm if you want to continue.");}
    proposal.tasks.forEach((t,i)=>{t.scheduled_date=dates[i];t.sequence_override_confirmed=conflicts.ids.has(`pending:${t.section_id}`)&&!!$("#schedule-order-confirm")?.checked;});
    try {
      const res=await state.sb.rpc("create_plan_and_schedule",{p_title:`${state.pendingProposal.course.title} study plan`,p_course_id:state.pendingProposal.course.id,p_start:proposal.start,p_deadline:proposal.deadline,p_priority:proposal.priority,p_preferences:{daily_section_capacity:proposal.capacity,unavailable_weekdays:proposal.unavailable},p_tasks:proposal.tasks});
      if(res.error) throw res.error;
      closeDialog(); toast(`${res.data?.task_count||0} task(s) scheduled.`); await loadData({quiet:true});
    } catch(e){toast(`Schedule not saved: ${errorText(e)}`);}
  }

  function openBacklog() {
    const tasks=activeTasks(state.user.id).filter(t=>t.scheduled_date<lagosDate()&&!done(t.id));
    if(!tasks.length) return toast("No unfinished past tasks need rescheduling.");
    const groups=new Map(); tasks.forEach(t=>{const key=t.course_id||"other";if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t);});
    const groupRows=[...groups].map(([key,rows])=>`<fieldset class="form-section"><legend>${esc(key==="other"?"Other tasks":courseOf(key)?.title||"Course")}</legend>${rows.map(t=>`<div class="suggestion-task"><label class="check-line"><input type="checkbox" name="backlog_task" value="${esc(t.id)}" checked><span>${esc(taskTitle(t))}${t.task_type==="anki"?`<small class="task-subtitle">${ankiRemainingForTask(t)===null?"Anki target not set":`${ankiRemainingForTask(t)} cards remaining`}</small>`:""}</span></label><label>Move to<input type="date" min="${lagosDate()}" value="${lagosDate()}" data-backlog-date="${esc(t.id)}"></label></div>`).join("")}</fieldset>`).join("");
    openDialog("Review unfinished work", `<form id="backlog-form" class="form-stack"><p class="callout">Select only the work you want to move. Every row has its own editable date. Original dates and move history are preserved; unticked tasks and Anki balances remain unchanged.</p>${groupRows}<p id="backlog-order-warning" class="preview-warning" role="status" aria-live="polite" hidden></p><label id="backlog-order-confirm-row" class="check-line" hidden><input type="checkbox" name="sequence_override"> I explicitly approve the new out-of-order dates for the affected sections.</label><label>Reason (optional)<input name="reason" maxlength="1000" value="Backlog review"></label><div class="dialog-actions"><button type="submit" class="button button-primary">Approve selected moves</button></div></form>`);
    $$('[data-backlog-date],[name="backlog_task"]').forEach(el=>el.addEventListener("input",refreshBacklogOrder));refreshBacklogOrder();
  }
  function refreshBacklogOrder() {
    const form=$("#backlog-form");if(!form)return;
    const changes=[...form.querySelectorAll('[name="backlog_task"]:checked')].map(el=>({task_id:el.value,scheduled_date:form.querySelector(`[data-backlog-date="${CSS.escape(el.value)}"]`)?.value}));
    const conflicts=scheduledOrderConflicts(changes),warning=$("#backlog-order-warning"),row=$("#backlog-order-confirm-row"),check=form.elements.sequence_override;
    if(!warning||!row||!check)return;
    warning.hidden=row.hidden=conflicts.pairs.length===0;
    warning.textContent=conflicts.pairs.length?`These selected dates create ${conflicts.pairs.length} new course-order conflict(s): ${conflicts.pairs.slice(0,4).map(p=>p.join(" → ")).join("; ")}. Nothing moves unless you explicitly confirm.`:"";
    if(!conflicts.pairs.length)check.checked=false;
  }
  function openSuggestion(noticeId) {
    const n=state.notifications.find(x=>x.id===noticeId); if(!n||n.recipient_id!==state.user.id) return;
    const tasks=n.payload?.tasks||[];
    const rows=tasks.map(t=>{const task=state.tasks.find(x=>x.id===t.task_id),remaining=task&&ankiRemainingForTask(task);return `<div class="suggestion-task"><span>${esc(t.task_title||"Study task")}<small class="task-subtitle">Originally ${esc(formatDate(t.scheduled_date))}${task?.task_type==="anki"?` · ${remaining===null?"target not set":`${remaining} cards remaining`}`:""}</small></span><label>Proposed date<input type="date" min="${lagosDate()}" value="${esc(n.payload?.proposed_date||lagosDate())}" data-suggestion-task="${esc(t.task_id)}"></label></div>`;}).join("");
    openDialog("Review rescheduling suggestion", `<p class="callout">This is a private suggestion. Nothing changes unless you approve it. Edit dates below or reject the suggestion.</p>${rows}<p id="suggestion-order-warning" class="preview-warning" role="status" aria-live="polite" hidden></p><label id="suggestion-order-confirm-row" class="check-line" hidden><input type="checkbox" id="suggestion-order-confirm"> I explicitly approve the new out-of-order dates for the affected sections.</label><div class="dialog-actions"><button type="button" class="button button-quiet" data-action="reject-suggestion" data-notice="${esc(noticeId)}">Reject · leave schedule unchanged</button><button type="button" class="button button-primary" data-action="approve-suggestion" data-notice="${esc(noticeId)}">Approve selected dates</button></div>`);
    $$('[data-suggestion-task]').forEach(el=>el.addEventListener("input",refreshSuggestionOrder));refreshSuggestionOrder();
  }
  function refreshSuggestionOrder() {
    const changes=$$('[data-suggestion-task]').map(el=>({task_id:el.dataset.suggestionTask,scheduled_date:el.value}));
    const conflicts=scheduledOrderConflicts(changes),warning=$("#suggestion-order-warning"),row=$("#suggestion-order-confirm-row"),check=$("#suggestion-order-confirm");
    if(!warning||!row||!check)return;
    warning.hidden=row.hidden=conflicts.pairs.length===0;
    warning.textContent=conflicts.pairs.length?`These suggested dates create ${conflicts.pairs.length} new course-order conflict(s): ${conflicts.pairs.slice(0,4).map(p=>p.join(" → ")).join("; ")}. Nothing moves unless you explicitly confirm.`:"";
    if(!conflicts.pairs.length)check.checked=false;
  }
  async function acceptSuggestion(noticeId) {
    const moves=$$('[data-suggestion-task]').map(el=>({task_id:el.dataset.suggestionTask,scheduled_date:el.value}));
    if(!moves.length||moves.some(m=>m.scheduled_date<lagosDate())) return toast("Every proposed date must be today or later.");
    const conflicts=scheduledOrderConflicts(moves),approved=!!$("#suggestion-order-confirm")?.checked;
    if(conflicts.pairs.length&&!approved){refreshSuggestionOrder();return toast("Review the new section-order warning and explicitly confirm before rescheduling.");}
    moves.forEach(m=>m.sequence_override_confirmed=approved&&conflicts.ids.has(m.task_id));
    try { const r=await state.sb.rpc("move_tasks",{p_moves:moves,p_reason:"Participant approved 08:00 Lagos reschedule suggestion"});if(r.error)throw r.error;
      await state.sb.from("notifications").update({read_at:new Date().toISOString(),archived_at:new Date().toISOString()}).eq("id",noticeId);
      closeDialog();toast(`${r.data} task(s) moved.`);await loadData({quiet:true});
    } catch(e){toast(`The proposed schedule was not changed: ${errorText(e)}`);}
  }
  async function toggleTask(taskId) {
    const task=state.tasks.find(t=>t.id===taskId); if(!task||!requireOwner()) return;
    if(task.task_type==="anki") return openAnkiDialog(task);
    if(!navigator.onLine) return toast("Offline changes are disabled to protect account ownership. Reconnect before editing.");
    setStatus(done(taskId)?"Reopening task…":"Saving completion…");
    try {
      const result=done(taskId)
        ? await state.sb.from("task_completions").delete().eq("task_id",taskId).eq("owner_id",state.user.id)
        : await state.sb.from("task_completions").insert({task_id:taskId,owner_id:state.user.id,scheduled_date_credit:task.scheduled_date});
      if(result.error) throw result.error;
      setStatus(""); toast(done(taskId)?"Task reopened; visible completion activity retracted.":"Task completed."); await loadData({quiet:true});
    } catch(e){setStatus(`Task was not changed: ${errorText(e)}`,"error");}
  }
  function openAnkiDialog(task) {
    const day=task.scheduled_date, target=targetForDay(day), log=state.ankiLogs.find(x=>x.log_date===day), complete=done(task.id);
    if(!target) return openDialog("Set an Anki target", `<p class="callout">This task is ${esc(formatDate(day))}. Set a target for this date or a future date in Settings before logging cards.</p><div class="dialog-actions"><button type="button" class="button button-secondary" data-tab="settings">Open Settings</button></div>`);
    openDialog("Log Anki cards", `<p class="callout">Target: ${target.target_count} cards · ${esc(formatDate(day))}. Card counts are self-reported. You can save partial progress without marking the task complete.</p><form id="anki-log-form" data-task="${esc(task.id)}" data-date="${esc(day)}" class="form-stack"><label>Cards completed so far (optional)<input type="number" name="cards_completed" min="0" step="1" value="${esc(log?.cards_completed??"")}" placeholder="Leave blank if you do not want to report a count"></label><div class="field-help">Remaining cards: ${Math.max(0,target.target_count-(Number(log?.cards_completed)||0))}. Counts above target are retained.</div><div class="button-row"><button type="submit" name="complete" value="false" class="button button-secondary">Save progress only</button>${!complete?`<button type="submit" name="complete" value="true" class="button button-primary" ${Number(log?.cards_completed||0)<target.target_count?"disabled":""}>Mark target complete</button>`:`<button type="button" class="button button-quiet" data-action="undo-anki" data-task="${esc(task.id)}">Undo completion</button>`}</div></form>`);
  }
  async function submitAnki(form, complete) {
    const taskId=form.dataset.task, date=form.dataset.date, input=form.elements.cards_completed.value;
    const cards=input===""?null:Number(input);
    if(cards!==null&&(!Number.isInteger(cards)||cards<0)) return toast("Enter a non-negative whole number of cards, or leave it blank.");
    const target=targetForDay(date); if(complete&&(!target||cards===null||cards<target.target_count)) return toast("Enter a count at least equal to the target before completing Anki.");
    try {
      const log=await state.sb.rpc("record_anki_for_task",{p_task_id:taskId,p_cards_completed:cards,p_completed:complete}); if(log.error) throw log.error;
      closeDialog();toast(complete?"Anki target completed.":"Anki progress saved.");await loadData({quiet:true});
    } catch(e){toast(`Anki progress was not saved: ${errorText(e)}`);}
  }

  async function saveProfile(form) {
    const name=form.elements.display_name.value.trim(); if(!name||name.length>80) return toast("Display name must be 1–80 characters.");
    const r=await state.sb.from("profiles").update({display_name:name}).eq("id",state.user.id); if(r.error) return toast(`Profile not saved: ${errorText(r.error)}`);
    toast("Display name updated."); await loadData({quiet:true});
  }
  async function savePreferences(form) {
    const theme=form.elements.theme.value, capacity=form.elements.daily_section_capacity.value?Number(form.elements.daily_section_capacity.value):null;
    if(capacity!==null&&(!Number.isInteger(capacity)||capacity<1||capacity>100)) return toast("Capacity must be a whole number from 1 to 100.");
    const r=await state.sb.from("user_preferences").upsert({profile_id:state.user.id,theme,daily_section_capacity:capacity},{onConflict:"profile_id"});
    if(r.error) return toast(`Preferences not saved: ${errorText(r.error)}`);
    applyTheme(theme);toast("Preferences saved.");await loadData({quiet:true});
  }
  async function saveTarget(form) {
    const count=Number(form.elements.target_count.value), date=form.elements.effective_from.value;
    if(!Number.isInteger(count)||count<1||count>100000) return toast("Target must be a positive whole number.");
    const r=await state.sb.rpc("set_anki_target",{p_target_count:count,p_effective_from:date});
    if(r.error) return toast(`Target not saved: ${errorText(r.error)}`);
    toast("Anki target saved; earlier target snapshots stay unchanged.");await loadData({quiet:true});
  }
  async function createQuickTask(form) {
    const task={task_title:form.elements.task_title.value.trim(),task_type:form.elements.task_type.value,priority:form.elements.priority.value,scheduled_date:form.elements.scheduled_date.value,deadline:form.elements.deadline.value||null,course_id:form.elements.course_id.value||null,section_id:null,idempotency_key:`manual:${crypto.randomUUID()}`};
    if(task.scheduled_date<lagosDate()) return toast("New tasks cannot be scheduled in the past.");
    const r=await state.sb.rpc("commit_task_schedule",{p_plan_id:null,p_tasks:[task],p_reason:"Participant-created task"});
    if(r.error) return toast(`Task not saved: ${errorText(r.error)}`);
    closeDialog();toast("Task added to your schedule.");await loadData({quiet:true});
  }
  async function saveDeadline(form) {
    const visibility=form.elements.visibility.value, row={group_id:currentGroupId(),owner_id:visibility==="private"?state.user.id:null,course_id:form.elements.course_id.value||null,title:form.elements.title.value.trim(),description:form.elements.description.value.trim(),due_date:form.elements.due_date.value,priority:form.elements.priority.value,visibility,status:"active",created_by:state.user.id};
    const r=await state.sb.from("exams_deadlines").insert(row);if(r.error)return toast(`Deadline not saved: ${errorText(r.error)}`);
    closeDialog();toast("Deadline saved.");await loadData({quiet:true});
  }

  function deadlineById(id) { return state.exams.find(e => e.id === id); }
  function deadlineStatusLabel(e) { return e.archived_at ? "Removed" : e.status === "active" ? "Active" : e.status === "cancelled" ? "Cancelled" : e.status === "completed" ? "Completed" : String(e.status || "Active"); }
  function openDeadlineManager() {
    const today = lagosDate();
    const rows = [...state.exams].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))).map(e => {
      const live = e.status === "active" && !e.archived_at;
      const remaining = dayDiff(today, e.due_date);
      const when = remaining < 0 ? `${-remaining}d ago` : remaining === 0 ? "Today" : `in ${remaining}d`;
      return `<div class="deadline-row ${live ? "" : "is-inactive"}"><span class="deadline-date">${live ? esc(when) : esc(deadlineStatusLabel(e))}</span><div class="deadline-copy"><strong>${esc(e.title)}</strong><small>${esc(formatDate(e.due_date))}${e.visibility === "group" ? " · group" : " · personal"}</small></div><button type="button" class="text-button deadline-edit" data-action="edit-deadline" data-deadline="${esc(e.id)}">Edit</button></div>`;
    }).join("") || `<div class="empty-state">No deadlines yet. Use the add button to create one.</div>`;
    openDialog("Manage exams and deadlines", `<div class="deadline-list">${rows}</div><div class="dialog-actions"><button type="button" class="button button-primary" data-action="add-deadline">Add a deadline</button></div>`);
  }
  function openDeadlineEdit(id) {
    const e = deadlineById(id); if (!e) return toast("That deadline could not be found. Refresh and try again.");
    const live = e.status === "active" && !e.archived_at;
    const sel = (v, cur) => v === cur ? "selected" : "";
    const courseOpts = `<option value="">No course</option>${state.courses.filter(c => !c.archived_at && (c.owner_id === state.user.id || c.visibility === "shared" || c.id === e.course_id)).map(c => `<option value="${esc(c.id)}" ${c.id === e.course_id ? "selected" : ""}>${esc(c.title)}</option>`).join("")}`;
    openDialog("Edit deadline", `<form id="deadline-edit-form" class="form-stack" data-deadline="${esc(e.id)}"><label>Title<input name="title" maxlength="160" value="${esc(e.title)}" required></label><label>Description<textarea name="description" maxlength="4000">${esc(e.description || "")}</textarea></label><div class="field-grid"><label>Date<input type="date" name="due_date" value="${esc(e.due_date)}" required></label><label>Priority<select name="priority"><option value="critical" ${sel("critical", e.priority)}>Critical</option><option value="high" ${sel("high", e.priority)}>High</option><option value="normal" ${sel("normal", e.priority)}>Normal</option><option value="low" ${sel("low", e.priority)}>Low</option></select></label><label>Course (optional)<select name="course_id">${courseOpts}</select></label></div><button class="button button-primary" type="submit">Save changes</button><div class="button-row">${live ? `<button type="button" class="button button-secondary" data-action="cancel-deadline" data-deadline="${esc(e.id)}">Mark as cancelled</button>` : `<button type="button" class="button button-secondary" data-action="reopen-deadline" data-deadline="${esc(e.id)}">Reactivate</button>`}<button type="button" class="button button-secondary" data-action="delete-deadline" data-deadline="${esc(e.id)}">Delete</button></div></form>`);
  }
  async function updateDeadlineRow(id, patch) {
    const r = await state.sb.from("exams_deadlines").update(patch).eq("id", id).select("id");
    if (r.error) return { error: r.error };
    if (!r.data || !r.data.length) return { error: { message: "The database did not allow this change. Only the person who created a deadline may edit it, unless your policies allow more." } };
    return { error: null };
  }
  async function saveDeadlineEdit(form) {
    const patch = { title: form.elements.title.value.trim(), description: form.elements.description.value.trim(), due_date: form.elements.due_date.value, priority: form.elements.priority.value, course_id: form.elements.course_id.value || null };
    const r = await updateDeadlineRow(form.dataset.deadline, patch);
    if (r.error) return toast(`Deadline not saved: ${errorText(r.error)}`);
    toast("Deadline updated."); await loadData({ quiet: true }); openDeadlineManager();
  }
  async function setDeadlineActive(id, active) {
    let r;
    if (active) {
      r = await updateDeadlineRow(id, { status: "active", archived_at: null });
      if (r.error) r = await updateDeadlineRow(id, { status: "active" });
    } else {
      r = await updateDeadlineRow(id, { status: "cancelled" });
      if (r.error) r = await updateDeadlineRow(id, { archived_at: new Date().toISOString() });
    }
    if (r.error) return toast(`Could not change it: ${errorText(r.error)}`);
    toast(active ? "Deadline reactivated." : "Deadline cancelled."); await loadData({ quiet: true }); openDeadlineManager();
  }
  async function deleteDeadline(id) {
    const e = deadlineById(id); if (!e) return;
    if (!confirm(`Delete "${e.title}" permanently?`)) return;
    const r = await state.sb.from("exams_deadlines").delete().eq("id", id).select("id");
    if (r.error) return toast(`Could not delete: ${errorText(r.error)}`);
    if (!r.data || !r.data.length) return toast("The database did not allow deleting this. Try Mark as cancelled instead.");
    toast("Deadline deleted."); await loadData({ quiet: true }); openDeadlineManager();
  }

  async function archiveRow(table, id) {
    const r = await state.sb.from(table).update({ archived_at: new Date().toISOString() }).eq("id", id).select("id");
    if (r.error) return `The database refused this (${errorText(r.error)}). Run fix_everything_editable.sql once in Supabase.`;
    if (!r.data || !r.data.length) return "The database did not allow this. Run fix_everything_editable.sql once in Supabase, then try again.";
    return null;
  }
  async function clearCourseSchedule(courseId) {
    const c = courseOf(courseId); if (!c) return;
    const open = activeTasks(state.user.id).filter(t => t.course_id === courseId && !done(t.id));
    if (!open.length) return toast("There are no unfinished scheduled tasks for this course.");
    if (!confirm(`Remove ${open.length} unfinished scheduled task${open.length === 1 ? "" : "s"} for "${c.title}"? Completed tasks stay.`)) return;
    let failed = 0;
    for (const t of open) {
      const r = await state.sb.rpc("update_task_instance", { p_task_id: t.id, p_task_title: t.task_title, p_scheduled_date: t.scheduled_date, p_deadline: t.deadline || null, p_priority: t.priority, p_status: "cancelled", p_sequence_override_confirmed: false, p_reason: "Schedule cleared by participant" });
      if (r.error) failed++;
    }
    toast(failed ? `${open.length - failed} removed, ${failed} could not be removed.` : "Schedule cleared. You can schedule the course again any time.");
    await loadData({ quiet: true });
  }
  async function archiveCourse(courseId) {
    const c = courseOf(courseId); if (!c || c.owner_id !== state.user.id) return;
    if (!confirm(`Archive "${c.title}"? It disappears from the app. Your completed history is kept.`)) return;
    const err = await archiveRow("courses", courseId); if (err) return toast(err);
    closeDialog(); toast("Course archived."); await loadData({ quiet: true });
  }
  async function archiveCourseDo(kind, id, courseId) {
    const table = kind === "topic" ? "course_topics" : "course_sections";
    const row = (kind === "topic" ? state.topics : state.sections).find(x => x.id === id);
    if (!confirm(`Remove ${kind} "${row?.title || ""}"${kind === "topic" ? " and its sections" : ""}?`)) return;
    const err = await archiveRow(table, id); if (err) return toast(err);
    if (kind === "topic") for (const sec of state.sections.filter(x => x.topic_id === id && !x.archived_at)) await archiveRow("course_sections", sec.id);
    toast(`${kind === "topic" ? "Topic" : "Section"} removed.`); await loadData({ quiet: true }); openCourseEdit(courseId);
  }
  async function createRecurring(form) {
    const recurrence=form.elements.recurrence.value, weekdays=[...form.querySelectorAll('[name="weekdays"]:checked')].map(x=>Number(x.value));
    if(recurrence==="weekdays"&&!weekdays.length)return toast("Choose at least one weekday.");
    const start=form.elements.start_date.value;
    const r=await state.sb.rpc("create_recurring_rule",{p_title:form.elements.title.value.trim(),p_task_type:form.elements.task_type.value,p_recurrence:recurrence,p_weekdays:weekdays,p_start_date:start,p_active_until:form.elements.active_until.value||null,p_priority:form.elements.priority.value,p_course_id:form.elements.course_id.value||null});
    if(r.error)return toast(`Recurrence not saved: ${errorText(r.error)}`);
    closeDialog();toast("Recurring rule saved. Task generation is idempotent.");await loadData({quiet:true});
  }
  function openCourseTransfer(courseId) {
    const course=courseOf(courseId);if(!course||course.owner_id!==state.user.id)return;
    const members=state.members.filter(p=>p.id!==state.user.id);
    if(!members.length)return toast("A different active member must be available before ownership can be transferred.");
    openDialog("Transfer course ownership",`<p class="callout">The recipient becomes the only course editor. Your schedules, selections, and progress remain personal and unchanged.</p><form id="transfer-course-form" data-course="${esc(course.id)}" class="form-stack"><label>New owner<select name="new_owner" required>${members.map(p=>`<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join("")}</select></label><button type="submit" class="button button-primary">Transfer ownership</button></form>`);
  }
  async function transferCourse(form) {
    const r=await state.sb.rpc("transfer_course_ownership",{p_course_id:form.dataset.course,p_new_owner:form.elements.new_owner.value});
    if(r.error)return toast(`Ownership was not changed: ${errorText(r.error)}`);
    closeDialog();toast("Course ownership transferred. Personal study records were not moved.");await loadData({quiet:true});
  }
  async function saveCourseEdit(form) {
    try {
      const id=form.dataset.course, outline=JSON.parse(form.elements.structure.value);
      const parsed=validateImport(JSON.stringify({course_title:form.elements.title.value,description:form.elements.description.value,topics:outline}));
      const result=await state.sb.rpc("update_course_definition",{p_course_id:id,p_title:parsed.course_title,p_description:parsed.description,p_visibility:form.elements.visibility.value,p_topics:parsed.topics});
      if(result.error)throw result.error;
      closeDialog();toast("Course outline saved. Existing task history was retained.");await loadData({quiet:true});
    } catch(e){toast(`Course not saved: ${errorText(e)}`);}
  }
  async function addTaskDate(form) {
    const ids=[...form.querySelectorAll('[name="backlog_task"]:checked')].map(x=>x.value);
    const moves=ids.map(id=>({task_id:id,scheduled_date:form.querySelector(`[data-backlog-date="${CSS.escape(id)}"]`)?.value}));
    if(!moves.length) return toast("Select at least one task.");
    if(moves.some(m=>!m.scheduled_date||m.scheduled_date<lagosDate()))return toast("Every new date must be today or later.");
    const conflicts=scheduledOrderConflicts(moves),approved=!!form.elements.sequence_override?.checked;
    if(conflicts.pairs.length&&!approved){refreshBacklogOrder();return toast("Review the new section-order warning and explicitly confirm before rescheduling.");}
    moves.forEach(m=>m.sequence_override_confirmed=approved&&conflicts.ids.has(m.task_id));
    const r=await state.sb.rpc("move_tasks",{p_moves:moves,p_reason:form.elements.reason.value||"Participant-approved backlog redistribution"});
    if(r.error)return toast(`No tasks moved: ${errorText(r.error)}`);
    closeDialog();toast(`${r.data} selected task(s) rescheduled.`);await loadData({quiet:true});
  }

  async function adoptCourse(courseId, selectedIds, all = false) {
    if(!requireOwner())return;
    const c=courseOf(courseId);if(!c)return;
    if(c.visibility==="shared"&&!state.courseMemberships.some(m=>m.course_id===c.id&&m.status==="active")){
      const join=await state.sb.from("course_memberships").upsert({course_id:c.id,profile_id:state.user.id,status:"active",left_at:null},{onConflict:"course_id,profile_id"});if(join.error)return toast(`Could not join course: ${errorText(join.error)}`);
    }
    let sections=all?state.sections.filter(s=>state.topics.some(t=>t.id===s.topic_id&&t.course_id===c.id&&!t.archived_at)&&!s.archived_at):state.sections.filter(s=>selectedIds.includes(s.id));
    if(!sections.length)return toast("Select at least one section to adopt.");
    const already=new Set(state.courseSelections.filter(x=>x.section_id).map(x=>x.section_id));
    const rows=sections.filter(s=>!already.has(s.id)).map(s=>({profile_id:state.user.id,course_id:c.id,topic_id:null,section_id:s.id}));
    if(!rows.length)return toast("Those sections are already in your plan.");
    const r=await state.sb.from("personal_course_selections").insert(rows);if(r.error&&r.error.code!=="23505")return toast(`Selections not saved: ${errorText(r.error)}`);
    closeDialog();toast(`${sections.length} section(s) adopted. They have not been scheduled yet.`);await loadData({quiet:true});
  }
  async function joinCourse(courseId) {
    const course=courseOf(courseId);if(!course)return;
    const current=state.courseMemberships.find(m=>m.course_id===courseId);
    const joining=current?.status!=="active";
    const r=joining?await state.sb.from("course_memberships").upsert({course_id:courseId,profile_id:state.user.id,status:"active",left_at:null},{onConflict:"course_id,profile_id"}):await state.sb.from("course_memberships").update({status:"left",left_at:new Date().toISOString()}).eq("course_id",courseId).eq("profile_id",state.user.id);
    if(r.error)return toast(`Course membership not changed: ${errorText(r.error)}`);
    closeDialog();toast(joining?"Joined shared course.":"Left course; your personal records are preserved.");await loadData({quiet:true});
  }
  async function cloneCourse(courseId) {
    const c=courseOf(courseId);if(!c)return;
    const topics=state.topics.filter(t=>t.course_id===c.id&&!t.archived_at).sort((a,b)=>a.sequence_number-b.sequence_number).map(t=>({title:t.title,sequence:t.sequence_number,description:t.description,sections:state.sections.filter(s=>s.topic_id===t.id&&!s.archived_at).map(s=>({title:s.title,sequence:s.sequence_number,description:s.description,source_reference:s.source_reference,prerequisites:s.prerequisites,notes:s.notes}))}));
    if(!topics.length)return toast("This course has no content to copy.");
    const r=await state.sb.rpc("create_course_from_import",{p_course_title:`${c.title} · private copy`,p_description:`Private copy of shared course material. Original: ${c.title}.`,p_topics:topics,p_visibility:"private"});
    if(r.error)return toast(`Private copy not created: ${errorText(r.error)}`);
    closeDialog();toast("Private course copy created without another participant's schedule or progress.");await loadData({quiet:true});
  }

  async function claimLegacy(form) {
    if(!state.user)return;
    const code=form.elements.claim_code.value.trim();
    const r=await state.sb.rpc("claim_legacy_identity",{p_code:code});
    if(r.error)return toast(`Claim not completed: ${errorText(r.error)}`);
    closeDialog();toast(`Legacy identity linked. ${r.data?.unmapped_tick_count||0} old tick(s) need review.`);await loadData({quiet:true});
  }
  async function membershipAction(rejoin) {
    const r=rejoin
      ? await state.sb.from("group_members").update({status:"active",left_at:null}).eq("group_id",currentGroupId()).eq("profile_id",state.user.id)
      : await state.sb.from("group_members").update({status:"left",left_at:new Date().toISOString()}).eq("group_id",currentGroupId()).eq("profile_id",state.user.id);
    if(r.error)return toast(`Membership was not changed: ${errorText(r.error)}`);
    toast(rejoin?"Welcome back to the study team.":"You left the group. Your account and records remain saved.");state.viewerId=state.user.id;await loadData({quiet:true});
  }
  async function requestPasswordReset(emailOverride=null) {
    const email=(emailOverride||$("#login-form").elements.email.value||"").trim().toLowerCase();
    if(!email)return setAuthFeedback("Enter your account email address first.","error");
    const {error}=await state.sb.auth.resetPasswordForEmail(email,{redirectTo:`${location.origin}${location.pathname}?auth_flow=recovery`});
    if(state.user)setStatus(error?errorText(error):"If this email has an account, password-reset instructions have been sent.",error?"error":"success");
    else setAuthFeedback(error?errorText(error):"If this email has an account, password-reset instructions have been sent.",error?"error":"success");
  }
  async function signOut() {
    if(!state.sb)return;
    await disposeRealtime();
    const r=await state.sb.auth.signOut();
    if(r.error)return toast(`Sign out failed: ${errorText(r.error)}`);
    state.user=null;state.profile=null;state.privateProfile=null;state.members=[];state.tasks=[];state.completions.clear();state.events=[];state.notifications=[];state.ankiLogs=[];state.ankiTargets=[];state.audit=[];state.loaded=false;state.viewerId=null;
    // Remove only this app's cache keys; the Supabase SDK manages its own session storage.
    for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i);if(k?.startsWith("tetralogy:")||k?.startsWith("tetralogy-theme:"))localStorage.removeItem(k);}
    showAuth("login");headerActions();setStatus("");
  }

  function download(name, content, type) {
    const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  function personalBackup() {
    const id=state.user.id;
    return {format:"tetralogy-personal-backup",version:1,exported_at:new Date().toISOString(),display_name:state.profile.display_name,
      legacy_identity:state.privateProfile?.legacy_person_key||null,profile:{display_name:state.profile.display_name},courses:state.courses.filter(c=>c.owner_id===id&&c.visibility==="private"),
      topics:state.topics.filter(t=>state.courses.some(c=>c.id===t.course_id&&c.owner_id===id)),
      sections:state.sections.filter(s=>state.topics.some(t=>t.id===s.topic_id&&state.courses.some(c=>c.id===t.course_id&&c.owner_id===id))),
      course_selections:state.courseSelections,plans:state.plans.filter(p=>p.owner_id===id),tasks:state.tasks.filter(t=>t.owner_id===id),
      completions:[...state.completions.values()].filter(c=>c.owner_id===id),schedule_history:state.scheduleHistory.filter(h=>h.owner_id===id),
      audit:state.audit,legacy_activity_history:state.legacyActivity,anki_targets:state.ankiTargets,anki_logs:state.ankiLogs,
      statistics:{active_tasks:activeTasks(id).length,completed_tasks:activeTasks(id).filter(t=>done(t.id)).length,anki:currentAnkiSummary(id)}};
  }
  function exportJson() { download(`tetralogy-backup-${lagosDate()}.json`,JSON.stringify(personalBackup(),null,2),"application/json;charset=utf-8"); }
  function exportCsv() {
    const rows=[["Record type","ID","Title or action","Course","Date","Deadline","Status","Value","Details"]];
    for(const t of state.tasks.filter(x=>x.owner_id===state.user.id)){
      const c=state.completions.get(t.id);
      rows.push(["task",t.id,taskTitle(t),courseOf(t.course_id)?.title||"",t.scheduled_date,t.deadline||"",t.status,t.priority,c?`completed ${c.completed_at}`:"not completed",c?.scheduled_date_credit||""]);
    }
    for(const p of state.plans.filter(x=>x.owner_id===state.user.id))rows.push(["plan",p.id,p.title,courseOf(p.course_id)?.title||"",p.start_date||"",p.deadline||"",p.status,p.priority,JSON.stringify(p.preferences||{})]);
    for(const h of state.scheduleHistory.filter(x=>x.owner_id===state.user.id))rows.push(["schedule history",h.task_id,h.action,"",h.new_date||h.old_date||"", "",h.new_status||h.old_status||"",h.reason,h.created_at]);
    for(const c of [...state.completions.values()].filter(x=>x.owner_id===state.user.id))rows.push(["completion",c.task_id,"completed","",c.scheduled_date_credit,"","current",c.completed_at,""]);
    for(const t of state.ankiTargets)rows.push(["Anki target",t.id,"target", "",t.effective_from,"","active",t.target_count,"cards per day"]);
    for(const l of state.ankiLogs)rows.push(["Anki log",l.id,"daily progress","",l.log_date,"",l.completed?"target met":"in progress",l.cards_completed??"",`target ${l.target_count}; logged ${l.entered_at}`]);
    for(const s of state.courseSelections)rows.push(["course selection",s.id,sectionOf(s.section_id)?.title||topicOf(s.topic_id)?.title||"Selection",courseOf(s.course_id)?.title||"","","","selected","",""]);
    for(const a of state.audit)rows.push(["completion audit",a.id,a.action,"","","","history",a.scheduled_date_credit||"",a.event_time]);
    const m=currentAnkiSummary(state.user.id);rows.push(["statistics","","personal summary","",lagosDate(),"","derived",JSON.stringify({active_tasks:activeTasks(state.user.id).length,completed_tasks:activeTasks(state.user.id).filter(t=>done(t.id)).length,anki:m}),"Counts are recalculated from the exported records."]);
    const csv=rows.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\r\n");
    download(`tetralogy-personal-export-${lagosDate()}.csv`,csv,"text/csv;charset=utf-8");
  }
  function openRestoreDialog() {
    openDialog("Restore a personal backup", `<p class="callout">Restore accepts only a Tetralogy JSON backup. It only restores records owned by the signed-in account; shared progress and records from other people are never overwritten. A backup exported from another account will be rejected.</p><form id="restore-form" class="form-stack" style="margin-top:13px"><label>Backup file<input type="file" name="backup" accept="application/json,.json" required></label><div id="restore-preview"></div></form>`);
  }
  async function parseRestoreFile(form) {
    const file=form.elements.backup.files?.[0]; if(!file)return;
    const output=$("#restore-preview");
    if(file.size>5_000_000){output.innerHTML=`<p class="form-feedback is-error">Backup must be smaller than 5 MB.</p>`;return;}
    try {
      const backup=JSON.parse(await file.text());
      if(backup?.format!=="tetralogy-personal-backup"||backup?.version!==1||!Array.isArray(backup.courses)||!Array.isArray(backup.topics)||!Array.isArray(backup.sections)||!Array.isArray(backup.course_selections)||!Array.isArray(backup.tasks)||!Array.isArray(backup.plans)||!Array.isArray(backup.completions)) throw new Error("This is not a supported Tetralogy personal backup.");
      const unknown=backup.tasks.length>10000||backup.plans.length>1000||backup.completions.length>10000;
      if(unknown)throw new Error("This backup exceeds safe record limits.");
      state.restoreDraft=backup;
      output.innerHTML=`<div class="preview-warning">${plural(backup.plans.length,"plan")}, ${plural(backup.tasks.length,"task")}, ${plural(backup.completions.length,"completion")}, ${plural((backup.anki_logs||[]).length,"Anki log")}. Imported by stable record ID; existing records are retained. This action cannot restore the password or claim-code secret.</div><div class="dialog-actions"><button type="button" class="button button-primary" data-action="confirm-restore">Restore these records</button></div>`;
    }catch(e){state.restoreDraft=null;output.innerHTML=`<p class="form-feedback is-error">${esc(errorText(e))}</p>`;}
  }
  async function restoreBackup() {
    const backup=state.restoreDraft;if(!backup)return toast("Choose a valid backup first.");
    const res=await state.sb.rpc("restore_personal_backup",{p_backup:backup});
    if(res.error)return toast(`Backup was not restored: ${errorText(res.error)}`);
    state.restoreDraft=null;closeDialog();toast("Personal backup restored. Existing records were not overwritten.");await loadData({quiet:true});
  }

  async function setReadState({all=false,noticeId=null,activity=false}={}) {
    try {
      if(all||activity){
        const ids=state.events.filter(e=>!state.activityReads.has(e.id)).map(e=>e.id);
        if(ids.length){const r=await state.sb.rpc("mark_activity_read",{p_event_ids:ids});if(r.error)throw r.error;}
        const personals=state.notifications.filter(n=>n.recipient_id===state.user.id&&!n.read_at&&!n.archived_at);
        if(personals.length){const r=await state.sb.from("notifications").update({read_at:new Date().toISOString()}).in("id",personals.map(n=>n.id));if(r.error)throw r.error;}
        const general=state.notifications.filter(n=>n.recipient_id===null&&!state.notificationReceipts.get(n.id)?.read_at&&!n.archived_at);
        if(general.length){const r=await state.sb.from("notification_receipts").upsert(general.map(n=>({notification_id:n.id,profile_id:state.user.id,read_at:new Date().toISOString()})),{onConflict:"notification_id,profile_id"});if(r.error)throw r.error;}
      }else if(noticeId){
        const n=state.notifications.find(x=>x.id===noticeId);if(!n)return;
        if(n.recipient_id===state.user.id){const r=await state.sb.from("notifications").update({read_at:new Date().toISOString()}).eq("id",noticeId);if(r.error)throw r.error;}
        else {const r=await state.sb.from("notification_receipts").upsert({notification_id:noticeId,profile_id:state.user.id,read_at:new Date().toISOString()},{onConflict:"notification_id,profile_id"});if(r.error)throw r.error;}
      }
      await loadData({quiet:true});
    }catch(e){toast(`Read state not saved: ${errorText(e)}`);}
  }
  async function archiveNotification(id) {
    const n=state.notifications.find(x=>x.id===id);if(!n)return;
    if(n.recipient_id===state.user.id){const r=await state.sb.from("notifications").update({archived_at:new Date().toISOString(),read_at:n.read_at||new Date().toISOString()}).eq("id",id);if(r.error)return toast(errorText(r.error));}
    else {const r=await state.sb.from("notification_receipts").upsert({notification_id:id,profile_id:state.user.id,read_at:new Date().toISOString(),archived_at:new Date().toISOString()},{onConflict:"notification_id,profile_id"});if(r.error)return toast(errorText(r.error));}
    await loadData({quiet:true});
  }
  function openTaskEdit(id) {
    const t=state.tasks.find(x=>x.id===id);if(!t||t.owner_id!==state.user.id)return;
    const sequenceNote=t.sequence_number?`<p class="callout">Sequence position ${t.sequence_number} is retained. Moving this task ahead of a prerequisite requires an explicit override confirmation.</p>`:"";
    const minDate=t.scheduled_date<lagosDate()?t.scheduled_date:lagosDate();
    openDialog("Edit task schedule", `<form id="edit-task-form" data-task="${esc(id)}" class="form-stack">${sequenceNote}<label>Task title<input name="task_title" value="${esc(t.task_title)}" maxlength="240" required></label><div class="field-grid"><label>Scheduled date${dayDateInput("scheduled_date",t.scheduled_date,minDate)}</label><label>Deadline<input type="date" name="deadline" min="${t.deadline&&t.deadline<lagosDate()?t.deadline:lagosDate()}" value="${esc(t.deadline||"")}"></label><label>Priority<select name="priority">${["critical","high","normal","low"].map(x=>`<option value="${x}" ${t.priority===x?"selected":""}>${x}</option>`).join("")}</select></label><label>Status<select name="status"><option value="scheduled" ${t.status==="scheduled"?"selected":""}>Scheduled</option><option value="cancelled" ${t.status==="cancelled"?"selected":""}>Cancelled; keep history</option><option value="archived" ${t.status==="archived"?"selected":""}>Archived; keep history</option></select></label></div>${t.sequence_number?`<label class="check-line"><input type="checkbox" name="sequence_override"> I approve an out-of-sequence move, if the new date conflicts with the course order.</label>`:""}<label>Reason<input name="reason" maxlength="1000" value="Participant-edited schedule"></label><div class="dialog-actions"><button type="button" class="button button-secondary" data-action="remove-task" data-task="${esc(id)}">Remove task</button><button type="submit" class="button button-primary">Save changes</button></div></form>`);
  }
  async function removeTask(id) {
    const t = state.tasks.find(x => x.id === id); if (!t || t.owner_id !== state.user.id) return;
    if (!confirm(`Remove "${taskTitle(t)}" from your schedule? Its history is kept.`)) return;
    const r = await state.sb.rpc("update_task_instance", { p_task_id: t.id, p_task_title: t.task_title, p_scheduled_date: t.scheduled_date, p_deadline: t.deadline || null, p_priority: t.priority, p_status: "cancelled", p_sequence_override_confirmed: false, p_reason: "Removed by participant" });
    if (r.error) return toast(`Could not remove it: ${errorText(r.error)}`);
    closeDialog(); toast("Task removed."); await loadData({ quiet: true });
  }
  async function saveTaskEdit(form) {
    const t=state.tasks.find(x=>x.id===form.dataset.task);if(!t)return;
    const date=form.elements.scheduled_date.value,status=form.elements.status.value;
    if(status==="scheduled"&&date<lagosDate())return toast("An active task cannot be scheduled in the past.");
    const conflicts=scheduledOrderConflicts([{task_id:t.id,scheduled_date:date}]);
    if(conflicts.ids.has(t.id)&&!form.elements.sequence_override?.checked)return toast("This move conflicts with course order. Review and explicitly confirm the sequence override.");
    const r=await state.sb.rpc("update_task_instance",{p_task_id:t.id,p_task_title:form.elements.task_title.value.trim(),p_scheduled_date:date,p_deadline:form.elements.deadline.value||null,p_priority:form.elements.priority.value,p_status:status,p_sequence_override_confirmed:conflicts.ids.has(t.id)&&!!form.elements.sequence_override?.checked,p_reason:form.elements.reason.value||"Participant-edited schedule"});
    if(r.error)return toast(`Task changes were not saved: ${errorText(r.error)}`);
    closeDialog();toast("Task changes saved with history.");await loadData({quiet:true});
  }

  async function disposeRealtime() {
    if(state.sb&&state.realtime.length){await Promise.all(state.realtime.map(ch=>state.sb.removeChannel(ch)));state.realtime=[];}
  }
  async function startRealtime() {
    await disposeRealtime(); if(!state.sb||!state.user||state.membership?.status!=="active")return;
    const channel=state.sb.channel(`tetralogy-${state.user.id}-${crypto.randomUUID()}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"task_instances"},()=>loadData({quiet:true}))
      .on("postgres_changes",{event:"*",schema:"public",table:"task_completions"},()=>loadData({quiet:true}))
      .on("postgres_changes",{event:"*",schema:"public",table:"study_activity_events"},()=>loadData({quiet:true}))
      .on("postgres_changes",{event:"*",schema:"public",table:"notifications"},()=>loadData({quiet:true}))
      .on("postgres_changes",{event:"*",schema:"public",table:"course_sections"},()=>loadData({quiet:true}))
      .subscribe();state.realtime=[channel];
  }

  async function handleLogin(form) {
    const email=form.elements.email.value.trim().toLowerCase(),password=form.elements.password.value;
    setAuthFeedback("Signing in…");
    const {data,error}=await state.sb.auth.signInWithPassword({email,password});
    if(error){setAuthFeedback(errorText(error),"error");return;}
    if(data.user&&!data.user.email_confirmed_at){await state.sb.auth.signOut();setAuthFeedback("Verify your email before signing in. Check the invitation email or request another verification.","error");return;}
    setAuthFeedback("Signed in. Opening your study space…","success");
  }
  async function handleRegistration(form) {
    const displayName=form.elements.display_name.value.trim();
    const email=form.elements.email.value.trim().toLowerCase();
    const inviteCode=form.elements.invite_code.value.trim();
    const password=form.elements.password.value;
    if(password.length<8)return setAuthFeedback("Use a password with at least 8 characters.","error");
    if(password!==form.elements.confirm_password.value)return setAuthFeedback("The two passwords do not match.","error");
    setAuthFeedback("Checking invitation and sending verification email…");
    const {data,error}=await state.sb.auth.signUp({email,password,options:{
      data:{display_name:displayName,invite_code:inviteCode},
      emailRedirectTo:`${location.origin}${location.pathname}?auth_flow=signup`
    }});
    if(error){const raw=String(error.message||"");setAuthFeedback(/database error saving new user/i.test(raw)?"Sign-up was not accepted. Copy the group invitation code exactly as it was sent to you, and check that this email is not already registered.":errorText(error),"error");return;}
    form.reset();
    if(data.session&&data.user&&!data.user.email_confirmed_at){await state.sb.auth.signOut();}
    setAuthFeedback("Check your email and verify your address. Then sign in with the password you chose. Original members can claim their old records after signing in.","success");
  }
  function passwordRecoveryScreen() {
    state.passwordSetupRequired=true;
    $("#auth-panel").hidden=false;$("#app-shell").hidden=true;
    $("#login-form").hidden=true;$("#register-form").hidden=true;$(".auth-switch").hidden=true;
    $("#new-password-form").hidden=false;
    const p=$("#password-flow-copy");if(p)p.textContent="Set a password for your verified invitation or password-reset link.";
    setAuthFeedback("Your secure email link is active. Choose a new password to continue.","success");
  }
  async function handleNewPassword(form) {
    const a=form.elements.password.value,b=form.elements.confirm_password.value;
    if(a.length<8)return setAuthFeedback("Use a password with at least 8 characters.","error");
    if(a!==b)return setAuthFeedback("The two passwords do not match.","error");
    const {error}=await state.sb.auth.updateUser({password:a});if(error)return setAuthFeedback(errorText(error),"error");
    state.passwordSetupRequired=false;history.replaceState(null,"",location.pathname+location.search);setAuthFeedback("Password saved. Loading your account…","success");await loadData();await startRealtime();
  }
  document.addEventListener("click",async event=>{
    const tab=event.target.closest("[data-tab]");if(tab){state.tab=tab.dataset.tab;state.viewerId=state.viewerId||state.user.id;renderApp();if(state.tab==="notifications"&&state.notificationMode==="general")setReadState({activity:true});return;}
    const view=event.target.closest("[data-viewer]");if(view){state.viewerId=view.dataset.viewer;state.tab="dashboard";renderApp();return;}
    const authTab=event.target.closest("[data-auth-mode]");if(authTab){showAuth(authTab.dataset.authMode);return;}
    const nmode=event.target.closest("[data-notification-mode]");if(nmode){state.notificationMode=nmode.dataset.notificationMode;renderApp();if(state.notificationMode==="general")setReadState({activity:true});return;}
    const day=event.target.closest("[data-calendar-date]");if(day){state.selectedDate=day.dataset.calendarDate;state.calendarMonth=firstOfMonth(state.selectedDate);renderApp();return;}
    const actionEl=event.target.closest("[data-action]");if(!actionEl)return;
    const action=actionEl.dataset.action;
    try {
      if(action==="theme-toggle"){applyTheme(state.theme==="dark"?"light":"dark");renderApp();}
      else if(action==="sign-out")await signOut();
      else if(action==="close-dialog")closeDialog();
      else if(action==="quick-task")openQuickTask();
      else if(action==="add-task-date")openQuickTask(actionEl.dataset.date||state.selectedDate);
      else if(action==="add-deadline")openDeadlineDialog();
      else if(action==="manage-deadlines")openDeadlineManager();
      else if(action==="remove-task")await removeTask(actionEl.dataset.task);
      else if(action==="clear-schedule")await clearCourseSchedule(actionEl.dataset.course);
      else if(action==="archive-course")await archiveCourse(actionEl.dataset.course);
      else if(action==="remove-topic")await archiveCourseDo("topic",actionEl.dataset.id,actionEl.dataset.course);
      else if(action==="remove-section")await archiveCourseDo("section",actionEl.dataset.id,actionEl.dataset.course);
      else if(action==="edit-deadline")openDeadlineEdit(actionEl.dataset.deadline);
      else if(action==="cancel-deadline")await setDeadlineActive(actionEl.dataset.deadline,false);
      else if(action==="reopen-deadline")await setDeadlineActive(actionEl.dataset.deadline,true);
      else if(action==="delete-deadline")await deleteDeadline(actionEl.dataset.deadline);
      else if(action==="claim-legacy")openClaimDialog();
      else if(action==="toggle-day"){const d=actionEl.dataset.date;state.openDays.has(d)?state.openDays.delete(d):state.openDays.add(d);renderApp();}
      else if(action==="toggle-task")await toggleTask(actionEl.dataset.task);
      else if(action==="open-calendar"){state.tab="calendar";renderApp();}
      else if(action==="calendar-prev"){state.calendarMonth=shiftMonth(state.calendarMonth,-1);renderApp();}
      else if(action==="calendar-next"){state.calendarMonth=shiftMonth(state.calendarMonth,1);renderApp();}
      else if(action==="calendar-today"){state.calendarMonth=firstOfMonth(lagosDate());state.selectedDate=lagosDate();renderApp();}
      else if(action==="open-import")openImportDialog();
      else if(action==="preview-import")previewImport();
      else if(action==="commit-import")await commitImport();
      else if(action==="copy-import-prompt"){await navigator.clipboard.writeText($("#import-prompt").value);toast("Prompt copied.");}
      else if(action==="schedule-course")openSchedule(actionEl.dataset.course);
      else if(action==="commit-schedule")await commitSchedule();
      else if(action==="course-detail")openCourseDetail(actionEl.dataset.course);
      else if(action==="edit-course")openCourseEdit(actionEl.dataset.course);
      else if(action==="join-course")await joinCourse(actionEl.dataset.course);
      else if(action==="clone-course")await cloneCourse(actionEl.dataset.course);
      else if(action==="adopt-whole-course")await adoptCourse(actionEl.dataset.course,[],true);
      else if(action==="transfer-course")openCourseTransfer(actionEl.dataset.course);
      else if(action==="edit-task")openTaskEdit(actionEl.dataset.task);
      else if(action==="open-backlog")openBacklog();
      else if(action==="open-recurring")openRecurringDialog();
      else if(action==="edit-recurring")openRecurringEdit(actionEl.dataset.rule);
      else if(action==="pause-recurring")await manageRecurring(actionEl.dataset.rule,"pause");
      else if(action==="resume-recurring")await manageRecurring(actionEl.dataset.rule,"resume");
      else if(action==="stop-recurring")await manageRecurring(actionEl.dataset.rule,"stop");
      else if(action==="reset-password")await requestPasswordReset(state.user?.email);
      else if(action==="review-suggestion")openSuggestion(actionEl.dataset.notice);
      else if(action==="approve-suggestion")await acceptSuggestion(actionEl.dataset.notice);
      else if(action==="reject-suggestion"){await archiveNotification(actionEl.dataset.notice);closeDialog();toast("Suggestion rejected; your schedule was left unchanged.");}
      else if(action==="read-notice"||action==="read-general-notice")await setReadState({noticeId:actionEl.dataset.notice});
      else if(action==="archive-notice")await archiveNotification(actionEl.dataset.notice);
      else if(action==="mark-all-read")await setReadState({all:true});
      else if(action==="export-json")exportJson();
      else if(action==="export-csv")exportCsv();
      else if(action==="restore-backup")openRestoreDialog();
      else if(action==="confirm-restore")await restoreBackup();
      else if(action==="leave-group"){if(confirm("Leave Tetralogy? Your personal data and history will remain saved; group access will end until you rejoin."))await membershipAction(false);}
      else if(action==="rejoin")await membershipAction(true);
      else if(action==="undo-anki"){const taskId=actionEl.dataset.task;const r=await state.sb.rpc("undo_anki_task",{p_task_id:taskId});if(r.error)throw r.error;closeDialog();toast("Anki completion reopened; card history retained.");await loadData({quiet:true});}
    }catch(e){toast(errorText(e));}
  });

  document.addEventListener("change",event=>{
    const choice=event.target.closest("[data-import-choice]");if(choice){state.importChoices[choice.dataset.importChoice]=choice.value;previewImport();return;}
    const rename=event.target.closest("[data-import-rename]");if(rename){state.importChoices[rename.dataset.importRename+":name"]=rename.value;return;}
    if(event.target.id==="import-destination"){state.importDestination=event.target.value;if(state.importDraft)previewImport();return;}
    if(event.target.matches("#restore-form input[type=file]")){parseRestoreFile(event.target.form);return;}
  });
  document.addEventListener("submit",async event=>{
    const form=event.target;if(!(form instanceof HTMLFormElement))return;
    event.preventDefault();
    try {
      if(form.id==="login-form")await handleLogin(form);
      else if(form.id==="register-form")await handleRegistration(form);
      else if(form.id==="new-password-form")await handleNewPassword(form);
      else if(form.id==="claim-form")await claimLegacy(form);
      else if(form.id==="quick-task-form")await createQuickTask(form);
      else if(form.id==="deadline-form")await saveDeadline(form);
      else if(form.id==="deadline-edit-form")await saveDeadlineEdit(form);
      else if(form.id==="schedule-form"){const p=scheduleProposal(form);showSchedulePreview(p);}
      else if(form.id==="backlog-form")await addTaskDate(form);
      else if(form.id==="anki-log-form")await submitAnki(form,event.submitter?.value==="true");
      else if(form.id==="profile-form")await saveProfile(form);
      else if(form.id==="preferences-form")await savePreferences(form);
      else if(form.id==="anki-target-form")await saveTarget(form);
      else if(form.id==="recurring-form")await createRecurring(form);
      else if(form.id==="edit-recurring-form")await saveRecurringEdit(form);
      else if(form.id==="transfer-course-form")await transferCourse(form);
      else if(form.id==="edit-course-form")await saveCourseEdit(form);
      else if(form.id==="adopt-form")await adoptCourse(form.dataset.course,[...form.querySelectorAll('[name="adopt_section"]:checked')].map(x=>x.value));
      else if(form.id==="edit-task-form")await saveTaskEdit(form);
      else if(form.id==="restore-form")await parseRestoreFile(form);
    }catch(e){toast(errorText(e));}
  });

  function exposePasswordSetupIfNeeded() {
    const params=new URLSearchParams(location.hash.replace(/^#/ ,""));
    const type=new URLSearchParams(location.search).get("auth_flow")||params.get("type");
    if(type==="invite"||type==="recovery")passwordRecoveryScreen();
    return type;
  }
  async function initialize() {
    const url=document.querySelector('meta[name="supabase-url"]')?.content;
    const key=document.querySelector('meta[name="supabase-anon-key"]')?.content;
    if(!url||!key||!window.supabase?.createClient){showAuth();setAuthFeedback("Supabase configuration or client library is unavailable. Check the setup instructions and reload.","error");return;}
    state.sb=window.supabase.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:"pkce"},realtime:{params:{eventsPerSecond:10}}});
    const flow=exposePasswordSetupIfNeeded();
    const {data,error}=await state.sb.auth.getSession();
    if(error){showAuth();setAuthFeedback(errorText(error),"error");return;}
    if(data.session){state.user=data.session.user;state.viewerId=state.user.id;if(state.passwordSetupRequired)passwordRecoveryScreen();else{await loadData();await startRealtime();}}
    else if(flow==="invite"||flow==="recovery")passwordRecoveryScreen();
    else {showAuth("login");if(flow==="signup")setAuthFeedback("Email verified. Sign in with the password you chose.","success");}
    state.sb.auth.onAuthStateChange((event,session)=>{
      if(event==="PASSWORD_RECOVERY"){passwordRecoveryScreen();return;}
      if(state.passwordSetupRequired){if(session?.user){state.user=session.user;state.viewerId=state.user.id;}passwordRecoveryScreen();return;}
      if(session?.user){state.user=session.user;state.viewerId=state.viewerId||state.user.id;setTimeout(async()=>{await loadData();await startRealtime();},0);}
      else if(event==="SIGNED_OUT"){disposeRealtime();state.user=null;state.loaded=false;showAuth("login");}
    });
    window.addEventListener("online",()=>{if(state.user){setStatus("Back online. Refreshing shared data…","success");loadData().then(startRealtime);}});
    window.addEventListener("offline",()=>{if(state.user)setStatus("Offline — study data is read-only. Unsaved changes are not queued.","error");});
    document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&state.user&&navigator.onLine)loadData({quiet:true});});
    $$("[data-action='forgot-password']").forEach(b=>b.addEventListener("click",()=>requestPasswordReset()));
    $("#app-dialog").addEventListener("click",e=>{if(e.target===$("#app-dialog"))closeDialog();});
  }
  document.addEventListener("DOMContentLoaded",initialize,{once:true});
})();
