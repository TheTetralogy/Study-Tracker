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
  const TASK_TYPES = [["study", "Study / reading"], ["anki", "Anki cards"], ["practice", "Practice questions"], ["revision", "Revision"], ["practical", "Practical preparation"], ["assignment", "Assignment"]];
  const CACHE_FIELDS = ["profile", "privateProfile", "membership", "members", "courses", "topics", "sections", "courseMemberships", "courseSelections", "plans", "tasks", "events", "notifications", "exams", "ankiTargets", "ankiLogs", "preferences", "recurringRules", "unmappedTicks", "ankiSummary"];
  const state = {
    sb: null, user: null, profile: null, privateProfile: null, membership: null, members: [], passwordSetupRequired: false,
    viewerId: null, tab: "dashboard", notificationMode: "general", theme: "dark",
    courses: [], topics: [], sections: [], courseMemberships: [], courseSelections: [], plans: [], tasks: [], recurringRules: [], recurringRuleHistory: [], unmappedTicks: [],
    completions: new Map(), events: [], notifications: [], notificationReceipts: new Map(),
    activityReads: new Set(), exams: [], scheduleHistory: [], audit: [], ankiTargets: [], ankiLogs: [],
    ankiSummary: [], legacyActivity: [], preferences: {}, loading: false, loaded: false, openDays: new Set(),
    selectedDate: lagosDate(), calendarMonth: firstOfMonth(lagosDate()), toastTimer: null,
    importDraft: null, importDestination: "new", importChoices: {}, pendingProposal: null,
    realtime: [], realtimeTimer: null, outlineCache: new Map(), plan: null, editor: null, dialogDirty: false,
    renderPending: false, reloadQueued: false, fromCache: false, lastLoad: 0, showEarlier: false, swStarted: false,
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
  function taskTitle(task) { return String(task?.task_title || "").trim() || (task?.section_id && sectionOf(task.section_id)?.title) || "Study task"; }
  function taskTypeLabel(type, label = "") {
    if (type && typeof type === "object") { label = type.task_type_label || ""; type = type.task_type; }
    if (type === "custom" && String(label || "").trim()) return String(label).trim();
    return ({ study: "Study", anki: "Anki", practice: "Questions", revision: "Revision", practical: "Practical", assignment: "Assignment", custom: "Task" })[type] || "Task";
  }
  function activeTasks(ownerId = state.viewerId) { return state.tasks.filter(t => t.owner_id === ownerId && t.status === "scheduled" && !t.archived_at); }
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
  function taskGroup(task) {
    if (task.course_id) return courseOf(task.course_id)?.title || "Course";
    if (String(task.course_label || "").trim()) return String(task.course_label).trim();
    return taskTypeLabel(task);
  }
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
  /* Fetch every row in pages of 1,000 so nothing is ever silently cut off. */
  async function loadData({ quiet = false } = {}) {
    if (!state.sb || !state.user) return;
    if (state.loading) { state.reloadQueued = true; return; }
    state.loading = true; state.reloadQueued = false;
    if (!quiet && !state.loaded) setStatus("Loading your shared study space…");
    if (state.fromCache) setUpdating(true);
    try {
      const uid = state.user.id;
      const [profileRows, privateRows, memberships] = await Promise.all([
        fetchData(state.sb.from("profiles").select("id,display_name,avatar_url,status,created_at")),
        fetchData(state.sb.from("profile_private").select("profile_id,email_ref,legacy_person_key").eq("profile_id", uid).limit(1)),
        fetchData(state.sb.from("group_members").select("group_id,profile_id,status,joined_at,left_at")),
      ]);
      const own = profileRows.find(p => p.id === uid);
      if (!own) throw new Error("Your profile is not available. Confirm your email and ask the project owner to check membership setup.");
      state.profile = own;
      state.privateProfile = privateRows[0] || null;
      const mine = memberships.filter(m => m.profile_id === uid);
      state.membership = mine.find(m => m.status === "active") || mine[0] || null;
      if (!state.membership || state.membership.status !== "active") {
        state.members = [state.profile]; state.viewerId = uid; state.loaded = true; state.fromCache = false; renderApp();
        setStatus(state.membership?.status === "left" ? "You have left the group. Rejoin when you are ready; your personal data is preserved." : "Your group membership is awaiting email verification.");
        return;
      }
      const gid = state.membership.group_id;
      const ids = new Set(memberships.filter(m => m.group_id === gid && m.status === "active").map(m => m.profile_id));
      state.members = profileRows.filter(p => ids.has(p.id) && p.status === "active").sort((a, b) => a.id === uid ? -1 : b.id === uid ? 1 : a.display_name.localeCompare(b.display_name));
      if (!state.members.some(p => p.id === uid)) state.members.unshift(state.profile);
      if (!state.viewerId || !state.members.some(p => p.id === state.viewerId)) state.viewerId = uid;
      const memberIds = state.members.map(p => p.id);
      const sb = state.sb;
      const [courses, topics, sections, membershipsAll, selections, plans, tasks, completions, activity, notifications, exams, history, targets, logs, prefs, audit, legacyActivity, recurringRules, recurringRuleHistory, unmappedTicks, aReads, nReads, ankiSummary] = await Promise.all([
        fetchAll(() => sb.from("courses").select("*").order("title").order("id")),
        fetchAll(() => sb.from("course_topics").select("*").order("sequence_number").order("id")),
        fetchAll(() => sb.from("course_sections").select("*").order("sequence_number").order("id")),
        fetchAll(() => sb.from("course_memberships").select("course_id,profile_id,status,joined_at,left_at").order("course_id").order("profile_id")),
        fetchAll(() => sb.from("personal_course_selections").select("*").eq("profile_id", uid).order("id")),
        fetchAll(() => sb.from("personal_plans").select("*").in("owner_id", memberIds).order("created_at", { ascending: false }).order("id")),
        fetchAll(() => sb.from("task_instances").select("*").in("owner_id", memberIds).order("scheduled_date").order("id")),
        fetchAll(() => sb.from("task_completions").select("*").in("owner_id", memberIds).order("id")),
        fetchData(sb.from("study_activity_events").select("*").order("created_at", { ascending: false }).limit(300)),
        fetchData(sb.from("notifications").select("*").eq("group_id", gid).order("created_at", { ascending: false }).limit(400)),
        fetchAll(() => sb.from("exams_deadlines").select("*").eq("group_id", gid).order("due_date").order("id")),
        fetchAll(() => sb.from("task_schedule_history").select("*").in("owner_id", memberIds).order("created_at", { ascending: true }).order("id")),
        fetchData(sb.from("anki_targets").select("*").eq("owner_id", uid).order("effective_from", { ascending: false })),
        fetchAll(() => sb.from("anki_logs").select("*").eq("owner_id", uid).order("log_date", { ascending: false }).order("id")),
        fetchData(sb.from("user_preferences").select("*").eq("profile_id", uid).limit(1)),
        fetchData(sb.from("task_completion_audit").select("*").eq("owner_id", uid).order("event_time", { ascending: false }).limit(500)),
        fetchData(sb.from("legacy_activity_history").select("*").eq("owner_id", uid).order("created_at", { ascending: false }).limit(1000)),
        fetchData(sb.from("recurring_rules").select("*").eq("owner_id", uid).order("created_at", { ascending: false })),
        fetchData(sb.from("recurring_rule_history").select("*").eq("owner_id", uid).order("created_at", { ascending: false }).limit(100)),
        fetchData(sb.from("legacy_unmapped_ticks").select("*").eq("profile_id", uid).order("imported_at", { ascending: false }).limit(1000)),
        fetchAll(() => sb.from("activity_reads").select("event_id,read_at").eq("profile_id", uid).order("event_id")),
        fetchAll(() => sb.from("notification_receipts").select("notification_id,read_at,archived_at").eq("profile_id", uid).order("notification_id")),
        fetchData(sb.rpc("get_group_anki_summary")),
      ]);
      state.courses = courses; state.topics = topics; state.sections = sections; state.courseMemberships = membershipsAll; state.courseSelections = selections;
      state.plans = plans; state.tasks = tasks; state.completions = new Map(completions.map(c => [c.task_id, c]));
      state.events = activity; state.notifications = notifications; state.exams = exams; state.scheduleHistory = history;
      state.ankiTargets = targets; state.ankiLogs = logs; state.preferences = prefs[0] || {};
      state.audit = audit; state.legacyActivity = legacyActivity; state.recurringRules = recurringRules; state.recurringRuleHistory = recurringRuleHistory; state.unmappedTicks = unmappedTicks; state.activityReads = new Set(aReads.map(r => r.event_id));
      state.notificationReceipts = new Map(nReads.map(r => [r.notification_id, r])); state.ankiSummary = ankiSummary || [];
      state.outlineCache = new Map();
      if (!localTheme() && state.preferences.theme) applyTheme(state.preferences.theme, { save: false });
      state.loaded = true; state.fromCache = false; state.lastLoad = Date.now();
      if (!state.openDays.size) state.openDays.add(lagosDate());
      setStatus("");
      saveCache();
      safeRender();
      if (!navigator.onLine) setStatus("Offline — shared data is read-only until you reconnect.");
    } catch (error) {
      state.loaded = true;
      setStatus(state.fromCache ? `Showing your last saved copy. Could not refresh: ${errorText(error)}` : `Could not load the study data: ${errorText(error)}. No changes were sent.`, "error");
      safeRender();
    } finally {
      state.loading = false; setUpdating(false);
      if (state.reloadQueued) { state.reloadQueued = false; setTimeout(() => loadData({ quiet: true }), 50); }
    }
  }

  function applyTheme(theme, { save = true } = {}) {
    state.theme = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = state.theme;
    const meta = $('meta[name="theme-color"]'); if (meta) meta.content = state.theme === "dark" ? "#17133d" : "#f5f2ec";
    try { localStorage.setItem("tetralogy-theme", state.theme); } catch { /* ignore */ }
    if (save && state.sb && state.user) {
      state.preferences = { ...(state.preferences || {}), theme: state.theme };
      state.sb.from("user_preferences").upsert({ profile_id: state.user.id, theme: state.theme }, { onConflict: "profile_id" }).then(r => { if (r.error) toast(`Theme kept on this phone; account copy not saved (${errorText(r.error)}).`); });
    }
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
      return `<div class="deadline-row"><span class="deadline-date">${remaining < 0 ? "Past" : remaining === 0 ? "Today" : `${remaining}d`}</span><div class="deadline-copy"><strong>${esc(e.title)}</strong><small>${esc(formatDate(e.due_date))}${e.visibility === "group" ? " · group" : " · personal"}</small></div>${ownerId === state.user.id && canEditDeadline(e) ? `<button type="button" class="text-button deadline-edit" data-action="edit-deadline" data-deadline="${esc(e.id)}" aria-label="Edit ${esc(e.title)}">Edit</button>` : ""}</div>`;
    }).join("") || `<div class="empty-state">No upcoming deadlines recorded.</div>`;
    const recent = state.events.slice(0, 5).map(e => `<div class="activity-row"><i class="activity-dot"></i><div class="activity-copy"><strong>${esc(nameOf(e.actor_id))} · ${esc(e.payload?.title || "completed a task")}</strong><small>${esc(formatTime(e.created_at))}</small></div></div>`).join("") || `<div class="empty-state">Shared activity will appear here.</div>`;
    const claimBanner = ownerId === state.user.id && !state.privateProfile?.legacy_person_key ? `<div class="inline-banner"><span class="banner-icon">↗</span><p><strong>Did you study with Tetralogy before?</strong> Claim your old identity with your private one-time code to bring in your legacy plan and progress. New members can skip this.</p><button type="button" class="button button-quiet" data-action="claim-legacy">Claim records</button></div>` : "";
    const overdue = tasks.filter(t => t.scheduled_date < today && !done(t.id));
    const backlog = ownerId === state.user.id && overdue.length ? `<div class="inline-banner"><span class="banner-icon">!</span><p><strong>${plural(overdue.length, "unfinished task")} from earlier dates.</strong> Pick new dates for any of them; nothing moves until you approve it.</p><button type="button" class="button button-quiet" data-action="open-backlog">Review tasks</button></div>` : "";
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
      ${open ? `<div class="day-body">${tasks.length ? sortTasksForDay(tasks).map(t => taskRow(t, ownerId === state.user.id)).join("") : `<div class="free-day">${futureEmpty ? "Free day · add a task when you need one." : "No tasks scheduled for this date."}</div>`}${ownerId === state.user.id ? htmlButton("add-task-date", "＋ Add task to this date", "button button-quiet", `data-date="${date}"`) : ""}</div>` : ""}</article>`;
  }
  function taskRow(task, editable) {
    const isDone = done(task.id); const c = state.completions.get(task.id);
    const subtitle = `${esc(taskGroup(task))}${task.priority && task.priority !== "normal" ? ` · ${esc(task.priority)}` : ""}${c?.completed_at ? ` · completed ${esc(formatTime(c.completed_at))}` : ""}`;
    const check = task.task_type === "anki" ? "Anki log" : isDone ? "Completed" : "Mark complete";
    return `<div class="task-row ${isDone ? "is-complete" : ""}" data-task-row="${esc(task.id)}"><button type="button" class="task-check" data-action="toggle-task" data-task="${esc(task.id)}" aria-label="${esc(check)}: ${esc(taskTitle(task))}" aria-pressed="${isDone}" ${editable && navigator.onLine ? "" : "disabled"}>✓</button><span class="task-title">${sectionBadge(task.section_id)}${esc(taskTitle(task))}<small class="task-subtitle">${subtitle}</small></span><span class="task-side"><span class="task-type">${esc(taskTypeLabel(task))}</span>${editable ? `<button type="button" class="task-edit" data-action="edit-task" data-task="${esc(task.id)}" aria-label="Edit ${esc(taskTitle(task))}">Edit</button>` : ""}</span></div>`;
  }

  function renderCalendar(view) {
    const month = state.calendarMonth; const first = dateObj(month); const offset = first.getUTCDay(); const start = addDays(month, -offset);
    const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    const weekdayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(n => `<div class="calendar-weekday">${n}</div>`).join("");
    const cells = days.map(d => {
      const tasks = tasksForDate(view.id, d); const inMonth = d.slice(0,7) === month.slice(0,7);
      return `<button type="button" class="calendar-day ${!inMonth ? "is-outside" : ""} ${d === lagosDate() ? "is-today" : ""} ${d === state.selectedDate ? "is-selected" : ""}" data-calendar-date="${d}" aria-pressed="${d === state.selectedDate}"><span class="calendar-day-num">${dateObj(d).getUTCDate()}</span><span class="calendar-dots">${tasks.slice(0,8).map(t => `<i title="${esc(taskTitle(t))}" style="background:${done(t.id) ? "var(--teal)" : "var(--indigo)"}"></i>`).join("")}</span><small>${tasks.length ? `${tasks.filter(t=>done(t.id)).length}/${tasks.length}` : d > lagosDate() ? "Free" : ""}</small></button>`;
    }).join("");
    const dayTasks = sortTasksForDay(tasksForDate(view.id, state.selectedDate));
    return `${sectionHeader("Calendar", "Browse any date and add tasks on any day, past or future.", view.id === state.user.id ? htmlButton("add-task-date", "＋ Add task", "button button-primary", `data-date="${state.selectedDate}"`) : "")}
      <section class="calendar-panel surface"><div class="calendar-controls"><button type="button" class="icon-button" data-action="calendar-prev" aria-label="Previous month">‹</button><h2>${esc(formatDate(month,{month:"long",year:"numeric"}))}</h2><div class="button-row"><button type="button" class="button button-quiet" data-action="calendar-today">Today</button><button type="button" class="icon-button" data-action="calendar-next" aria-label="Next month">›</button></div></div><div class="calendar-grid">${weekdayNames}${cells}</div><div class="selected-date-tasks"><div class="section-heading"><div><h2>${esc(formatLongDate(state.selectedDate))}</h2><p>${dayTasks.length ? `${dayTasks.filter(t=>done(t.id)).length}/${dayTasks.length} tasks completed` : state.selectedDate > lagosDate() ? "Free day" : "No tasks scheduled"}</p></div></div><div class="task-list">${dayTasks.map(t => taskRow(t, view.id === state.user.id)).join("") || `<div class="empty-state">No tasks on this date.</div>`}</div></div></section>`;
  }

  function renderPlanner(view) {
    const own = view.id === state.user.id;
    const visibleCourses = state.courses.filter(c => !c.archived_at && (c.owner_id === view.id || c.visibility === "shared")).sort((a, b) => a.title.localeCompare(b.title));
    const courses = visibleCourses.map(c => courseCard(c, view)).join("");
    const today = lagosDate();
    const all = activeTasks(view.id);
    const upcoming = all.filter(t => t.scheduled_date >= today).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || (sectionNumber(a.section_id) || 1e9) - (sectionNumber(b.section_id) || 1e9));
    const earlier = all.filter(t => t.scheduled_date < today).sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
    const backlogCount = earlier.filter(t => !done(t.id)).length;
    const row = t => `<div class="activity-row ${done(t.id) ? "is-done-row" : ""}"><div class="activity-copy"><strong>${sectionBadge(t.section_id)}${esc(taskTitle(t))}</strong><small>${esc(formatDate(t.scheduled_date,{weekday:"short",month:"short",day:"numeric"}))} · ${esc(taskTypeLabel(t))} · ${esc(taskGroup(t))}${done(t.id) ? " · done" : ""}</small></div>${own ? htmlButton("edit-task", "Edit", "button button-quiet", `data-task="${esc(t.id)}"`) : `<span class="pill">${done(t.id) ? "complete" : "scheduled"}</span>`}</div>`;
    const showEarlier = state.showEarlier;
    return `${sectionHeader("Study planner", own ? "Plan any sections, in any order, on any days. Nothing is fixed until you save it." : "Read-only course and task view.", own ? `${htmlButton("create-course", "＋ Create course", "button button-secondary")} ${htmlButton("open-import", "Import", "button button-secondary")} ${htmlButton("quick-task", "＋ Add task", "button button-primary")}` : "")}
      ${own ? `<div class="button-row" style="margin-bottom:14px">${htmlButton("open-backlog", `Review backlog${backlogCount ? ` · ${backlogCount}` : ""}`, "button button-quiet")} ${htmlButton("open-recurring", "＋ Recurring task", "button button-quiet")}</div>` : ""}
      <div class="section-heading"><div><h2>Courses and material</h2><p>Shared courses are sources; each person chooses their own sections, order and dates.</p></div></div>
      <div class="two-col">${courses || `<div class="surface empty-state"><strong>No courses yet.</strong>${own ? "Create a course, import an outline, or add a single task." : "This member has no visible courses."}</div>`}</div>
      <div class="section-heading"><div><h2>${own ? "Your active schedule" : `${esc(view.display_name)}'s active schedule`}</h2><p>${plural(upcoming.length,"upcoming task")}${earlier.length ? ` · ${earlier.length} earlier` : ""}</p></div></div>
      <div class="surface"><div class="task-list">${upcoming.map(row).join("") || `<div class="empty-state">No upcoming tasks.</div>`}</div>${earlier.length ? `<div class="button-row" style="margin-top:12px">${htmlButton("toggle-earlier", showEarlier ? "Hide earlier tasks" : `Show earlier tasks (${earlier.length})`, "button button-quiet")}</div>${showEarlier ? `<div class="task-list earlier-list">${earlier.map(row).join("")}</div>` : ""}` : ""}</div>`;
  }

  function renderStatistics(view) {
    const ownerId = view.id, tasks = activeTasks(ownerId), complete = tasks.filter(t => done(t.id));
    const today = lagosDate(), weekStart = addDays(today, -6), monthStart = addDays(today, -29);
    const due = tasks.filter(t => t.scheduled_date <= today), dueDone = due.filter(t => done(t.id));
    const recent = complete.filter(t => { const c = state.completions.get(t.id); return c && c.scheduled_date_credit >= weekStart && c.scheduled_date_credit <= today; }).length;
    const onTime = complete.filter(t => { const c = state.completions.get(t.id); return c && c.scheduled_date_credit && lagosDate(new Date(c.completed_at)) <= c.scheduled_date_credit; }).length;
    const overdue = tasks.filter(t => t.scheduled_date < today && !done(t.id)).length;
    const monthDays = new Set(complete.map(t => state.completions.get(t.id)?.scheduled_date_credit).filter(d => d && d >= monthStart && d <= today));
    const sectionsDone = complete.filter(t => t.section_id).length, sectionsPlanned = tasks.filter(t => t.section_id).length;
    const groups = new Map();
    for (const t of tasks.filter(x => x.task_type !== "anki" && (x.course_id || x.course_label))) {
      const key = t.course_id ? `id:${t.course_id}` : `label:${String(t.course_label).trim().toLowerCase()}`;
      const title = t.course_id ? (courseOf(t.course_id)?.title || "Course") : String(t.course_label).trim();
      if (!groups.has(key)) groups.set(key, { title, total: 0, done: 0 });
      const g = groups.get(key); g.total++; if (done(t.id)) g.done++;
    }
    const byCourse = [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
    const anki = currentAnkiSummary(ownerId);
    const pastHistory = ownerId === state.user.id ? state.audit.slice(0,12).map(a => `<div class="history-item"><span>${esc(a.action === "completed" ? "Completed" : "Reopened")} · ${esc(taskTitle(state.tasks.find(t=>t.id===a.task_id)||{task_title:"Study task"}))}</span><small>${esc(formatTime(a.event_time))}</small></div>`).join("") : "";
    return `${sectionHeader("Statistics", `Separate measures for ${view.display_name}; schedules and activity are not combined into a single score.`)}
      <div class="stat-grid"><div class="stat-box"><span>Task completion rate</span><strong>${pct(dueDone.length,due.length)}%</strong><small>${dueDone.length} of ${due.length} tasks dated today or earlier</small></div><div class="stat-box"><span>Course sections complete</span><strong>${sectionsDone}</strong><small>of ${sectionsPlanned} planned course sections</small></div><div class="stat-box"><span>Daily plan completion · today</span><strong>${pct(tasksForDate(ownerId,today).filter(t=>done(t.id)).length,tasksForDate(ownerId,today).length)}%</strong><small>Credited to scheduled date</small></div><div class="stat-box"><span>Weekly productivity</span><strong>${recent}</strong><small>Tasks credited in last 7 days</small></div><div class="stat-box"><span>Scheduled-day completions</span><strong>${onTime}</strong><small>Completed by their credited date</small></div><div class="stat-box"><span>Overdue tasks</span><strong>${overdue}</strong><small>Current schedule, incomplete and past due</small></div><div class="stat-box"><span>Consistency</span><strong>${monthDays.size}</strong><small>Days with completed work in the last 30 days</small></div><div class="stat-box"><span>Anki cards</span><strong>${anki?.cards_total || 0}</strong><small>Target total: ${anki?.target_total || 0}</small></div><div class="stat-box"><span>Anki streak</span><strong>${anki?.current_streak || 0}d</strong><small>Longest ${anki?.longest_streak || 0} days · ${anki?.completed_days || 0} target days</small></div></div>
      <div class="two-col" style="margin-top:14px"><section class="surface"><div class="panel-title"><div><h2>Course progress</h2><p>Completed tasks / planned tasks for each course.</p></div></div><div class="course-bars">${byCourse.map(g=>`<div class="course-bar"><span>${esc(g.title)}</span><div class="course-bar-track"><i class="course-bar-fill" style="width:${pct(g.done,g.total)}%"></i></div><em>${g.done}/${g.total}</em></div>`).join("")||`<div class="empty-state">No course tasks to measure.</div>`}</div></section><section class="surface"><div class="panel-title"><div><h2>Historical task actions</h2><p>Actual activity timestamps are separate from scheduled-date credit.</p></div></div><div class="history-list">${pastHistory || (ownerId === state.user.id ? `<div class="empty-state">No personal completion history yet.</div>` : `<p class="field-help">Personal Anki logs and audit details are only visible to their owner.</p>`)}</div></section></div>`;
  }

  function renderLeaderboards() {
    const today = lagosDate(), week = addDays(today,-6), month = addDays(today,-29);
    const metrics = state.members.map(p => {
      const tasks = activeTasks(p.id), complete = tasks.filter(t=>done(t.id));
      const due = tasks.filter(t => t.scheduled_date <= today), dueDone = due.filter(t => done(t.id));
      const weekly = complete.filter(t => { const c=state.completions.get(t.id); return c?.scheduled_date_credit>=week && c?.scheduled_date_credit<=today; }).length;
      const activeDays = new Set(complete.map(t=>state.completions.get(t.id)?.scheduled_date_credit).filter(d=>d>=month&&d<=today)).size;
      const anki = currentAnkiSummary(p.id) || {};
      return { p, done: complete.length, total: tasks.length, rate: pct(dueDone.length,due.length), weekly, activeDays, cards: anki.cards_total||0, streak: anki.current_streak||0 };
    });
    const renderMetric = (label, hint, key, unit = "") => {
      const sorted = [...metrics].sort((a,b)=>b[key]-a[key]); let last = null, rank = 0;
      return `<section class="surface"><div class="panel-title"><div><h2>${esc(label)}</h2><p>${esc(hint)}</p></div></div><div class="leader-list">${sorted.map((r,i)=>{if(r[key]!==last)rank=i+1;last=r[key];return `<div class="leader-row"><span class="rank">${rank}</span><span class="leader-copy"><strong>${esc(r.p.display_name)}</strong><small>${r.done}/${r.total} active tasks · ${r.activeDays} activity days</small></span><strong class="leader-value">${r[key]}${unit}</strong></div>`}).join("")}</div></section>`;
    };
    return `${sectionHeader("Leaderboards", "Each category stands alone. Ties share a rank.")}
      <div class="two-col">${renderMetric("Tasks completed","Current completion state; each task counted once.","done")}${renderMetric("Completion rate","Completed tasks dated today or earlier, out of all tasks dated today or earlier.","rate","%")}${renderMetric("Weekly productivity","Tasks credited to their scheduled date in the last 7 days.","weekly")}${renderMetric("Consistency","Days with completed work in the last 30 days.","activeDays")}${renderMetric("Anki progress","Self-reported completed cards; target days are shown alongside.","cards")}
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
        <section class="surface"><div class="panel-title"><div><h2>Study preferences</h2><p>Displayed dates use Africa/Lagos.</p></div></div><form id="preferences-form" class="form-stack"><label>Theme<select name="theme"><option value="dark" ${state.theme==="dark"?"selected":""}>Dark (default)</option><option value="light" ${state.theme==="light"?"selected":""}>Light</option></select></label><label>Preferred sections per day (optional guide)<input type="number" name="daily_section_capacity" min="1" max="100" step="1" value="${esc(preferences.daily_section_capacity||"")}" placeholder="Leave blank for no guide"></label><p class="field-help">Only used for “Suggest a spread” and a gentle note when a day has more. It never blocks planning.</p><button type="submit" class="button button-primary">Save preferences</button></form></section>
        <section class="surface"><div class="panel-title"><div><h2>Anki target</h2><p>Self-reported cards; no automatic AnkiDroid connection.</p></div></div><form id="anki-target-form" class="form-stack"><label>Daily card target<input type="number" name="target_count" min="1" max="100000" step="1" value="${esc(target?.target_count||"")}" placeholder="Set your own target" required></label><label>Starts on<input type="date" name="effective_from" value="${lagosDate()}" required></label><button type="submit" class="button button-primary">Save target</button></form><div class="history-list" style="margin-top:12px">${state.ankiTargets.map(t=>`<div class="history-item"><span>${t.target_count} cards</span><small>from ${esc(formatDate(t.effective_from,{month:"short",day:"numeric",year:"numeric"}))}</small></div>`).join("")||`<p class="field-help">No target history yet.</p>`}</div></section>
        <section class="surface"><div class="panel-title"><div><h2>Recurring tasks</h2><p>Tasks that repeat on a pattern. Editing a rule changes only future unfinished occurrences.</p></div>${htmlButton("open-recurring","＋ Add rule","button button-quiet")}</div><div class="history-list">${recurrences||`<p class="field-help">No recurring rules yet.</p>`}</div><div class="section-heading"><div><h3>Recent rule history</h3><p>Changes and pauses are retained.</p></div></div><div class="history-list">${recurrenceHistory||`<p class="field-help">No rule changes yet.</p>`}</div></section>
        <section class="surface"><div class="panel-title"><div><h2>Data portability</h2><p>Exports are personal to this account; restore never writes another person's records.</p></div></div><div class="button-row">${htmlButton("export-json","Download JSON backup","button button-secondary")}${htmlButton("export-csv","Download CSV","button button-quiet")}${htmlButton("restore-backup","Preview restore","button button-quiet")}</div><div style="margin-top:16px"><h3>Group membership</h3><p class="field-help">Leaving preserves your account, personal data, and history. You can rejoin later.</p>${htmlButton("leave-group","Leave Tetralogy","button button-danger")}</div></section>
      </div>`;
  }

  function openDialog(title, content, label = "") {
    const dialog = $("#app-dialog"); $("#dialog-title").textContent = title; $("#dialog-content").innerHTML = content;
    state.dialogDirty = false;
    dialog.setAttribute("aria-label", label || title); if (!dialog.open) dialog.showModal();
    const body = $("#dialog-content"); if (body) body.scrollTop = 0;
  }
  function closeDialog() {
    const d = $("#app-dialog"); if (d.open) d.close();
    state.pendingProposal = null; state.plan = null; state.editor = null; state.dialogDirty = false;
    setTimeout(flushRender, 0);
  }
  function dayDateInput(name, value, required = true) { return `<input type="date" name="${esc(name)}" value="${esc(value || "")}" ${required ? "required" : ""}>`; }
  function openClaimDialog() {
    openDialog("Claim existing study records", `<p class="callout">Only a privately supplied, single-use code can link a legacy identity. Do not choose a participant from a list. Your existing display name is restored when the claim succeeds.</p><form id="claim-form" class="form-stack" style="margin-top:13px"><label>One-time claim code<input name="claim_code" type="password" autocomplete="off" minlength="12" maxlength="200" required></label><button class="button button-primary" type="submit">Claim identity</button></form>`);
  }
  function openQuickTask(date = lagosDate()) {
    if (!requireOwner()) return toast("Only your own account can add tasks.");
    openDialog("Add a task", `<form id="quick-task-form" class="form-stack"><label>Task title<input name="task_title" maxlength="240" required></label><div class="field-grid">${typeField("study")}${priorityField()}<label>Date${dayDateInput("scheduled_date", date)}</label><label>Deadline (optional)<input type="date" name="deadline"></label></div>${courseField("", "", { sections: true })}<label class="check-line" data-done-wrap ${date <= lagosDate() ? "" : "hidden"}><input type="checkbox" name="mark_done"> Already done (counts on this date)</label><button class="button button-primary" type="submit">Add task</button></form>`);
  }
  function openDeadlineDialog() {
    openDialog("Add an exam or deadline", `<form id="deadline-form" class="form-stack"><label>Title<input name="title" maxlength="160" required></label><label>Description<textarea name="description" maxlength="4000"></textarea></label><div class="field-grid"><label>Date${dayDateInput("due_date", lagosDate())}</label>${priorityField()}<label>Visibility<select name="visibility"><option value="private">Only me</option><option value="group">Group-wide</option></select></label>${courseField("")}</div><button class="button button-primary" type="submit">Save deadline</button></form>`);
  }
  function openRecurringDialog() {
    openDialog("Create recurring task", `<form id="recurring-form" class="form-stack">${recurringFields()}<button class="button button-primary" type="submit">Create recurrence</button></form>`);
  }
  function openRecurringEdit(id) {
    const r = state.recurringRules.find(x => x.id === id); if (!r || r.status === "stopped") return;
    openDialog("Edit recurring task", `<form id="edit-recurring-form" data-rule="${esc(r.id)}" class="form-stack"><p class="callout">Only future unfinished occurrences change. Completed occurrences and past dates stay as they are.</p>${recurringFields(r)}<button class="button button-primary" type="submit">Save rule changes</button></form>`);
  }
  async function saveRecurringEdit(form) {
    const weekdays = [...form.querySelectorAll('[name="weekdays"]:checked')].map(x => Number(x.value));
    if (form.elements.recurrence.value === "weekdays" && !weekdays.length) return toast("Choose at least one weekday.");
    if (form.elements.active_until.value && form.elements.active_until.value < form.elements.start_date.value) return toast("The stop date must be on or after the start date.");
    const type = readType(form), course = readCourse(form);
    const patch = { title: form.elements.title.value.trim(), task_type: type.task_type, task_type_label: type.task_type_label || "", recurrence: form.elements.recurrence.value, weekdays, start_date: form.elements.start_date.value, active_until: form.elements.active_until.value || "", priority: form.elements.priority.value, course_id: course.course_id || "", course_label: course.course_label || "" };
    const r = await state.sb.rpc("manage_recurring_rule", { p_rule_id: form.dataset.rule, p_action: "edit", p_patch: patch });
    if (r.error) return toast(`Rule not updated: ${errorText(r.error)}`);
    closeDialog(); toast("Rule saved. Only future unfinished occurrences were changed."); await loadData({ quiet: true });
  }
  async function manageRecurring(id, action) {
    const r = state.recurringRules.find(x => x.id === id); if (!r) return;
    const msg = { pause: ["Pause this rule?", "Its future unfinished occurrences are cancelled until you resume it. Completed work and history stay.", "Pause", false], resume: ["Resume this rule?", "Its paused future occurrences come back.", "Resume", false], stop: ["Stop this rule for good?", "Its future unfinished occurrences are cancelled. A stopped rule can't be resumed; you can create a new one.", "Stop rule", true] }[action];
    if (!(await confirmed({ title: msg[0], message: msg[1], confirmLabel: msg[2], danger: msg[3] }))) return;
    const result = await state.sb.rpc("manage_recurring_rule", { p_rule_id: id, p_action: action, p_patch: {} });
    if (result.error) return toast(`Rule not changed: ${errorText(result.error)}`);
    toast(action === "stop" ? "Rule stopped. Existing history was kept." : action === "pause" ? "Rule paused." : "Rule resumed."); await loadData({ quiet: true });
  }

  function openCourseDetail(courseId) {
    const course = courseOf(courseId); if (!course) return;
    const outline = courseOutline(courseId), own = state.viewerId === state.user.id, mine = course.owner_id === state.user.id, joined = joinedCourse(courseId);
    const rows = outline.topics.map(({ topic, sections }) => `<div class="form-section"><h3>${esc(topic.title)}</h3>${sections.map(({ section, number }) => { const t = taskForSection(section.id); const status = t ? (done(t.id) ? `<span class="pill is-good">Done</span>` : `<span class="pill">${esc(weekdayName(t.scheduled_date))}</span>`) : `<span class="pill is-muted">Not planned</span>`; return `<div class="outline-row"><span class="sec-num">#${number}</span><span class="outline-title">${esc(section.title)}</span>${own ? status : ""}</div>`; }).join("") || `<p class="field-help">No sections in this topic yet.</p>`}</div>`).join("") || `<div class="empty-state">No topics or sections yet.</div>`;
    const actions = [];
    if (own && (mine || joined)) actions.push(htmlButton("plan-sections", "Plan sections", "button button-primary", `data-course="${esc(courseId)}"`));
    if (own && !mine && course.visibility === "shared" && !joined) actions.push(htmlButton("join-course", myMembership(courseId)?.status === "left" ? "Join again" : "Join", "button button-primary", `data-course="${esc(courseId)}"`));
    if (own && mine) actions.push(htmlButton("edit-course", "Edit course", "button button-secondary", `data-course="${esc(courseId)}"`));
    if (own && mine && course.visibility === "shared") actions.push(htmlButton("transfer-course", "Transfer ownership", "button button-quiet", `data-course="${esc(courseId)}"`));
    if (own && !mine) actions.push(htmlButton("clone-course", "Make a private copy", "button button-quiet", `data-course="${esc(courseId)}"`));
    if (own && !mine && joined) actions.push(htmlButton("leave-course", "Leave course", "button button-quiet button-leave", `data-course="${esc(courseId)}"`));
    openDialog(course.title, `<p class="callout">${esc(course.description || "No description")} · ${course.visibility === "shared" ? `Shared with the group${mine ? "" : ` · owned by ${esc(nameOf(course.owner_id))}`}` : "Private to its owner"} · ${plural(outline.total, "section")}</p><div class="button-row" style="margin:12px 0">${actions.join("")}</div><div class="preview-list outline-list">${rows}</div>`);
  }

  /* ---------- import ---------- */
  function openCourseEdit(courseId) {
    const c = courseId ? courseOf(courseId) : null;
    if (courseId && (!c || c.owner_id !== state.user.id)) return toast("Only the course owner can edit this course.");
    const topics = c ? activeTopics(c.id).map(t => ({ id: t.id, title: t.title, description: t.description || "", sections: activeSections(t.id).map(s => ({ id: s.id, title: s.title, description: s.description || "", source_reference: s.source_reference || "", notes: s.notes || "", topic: t.id })) })) : [];
    const archivedTopics = c ? state.topics.filter(t => t.course_id === c.id && t.archived_at) : [];
    const archivedSections = c ? state.sections.filter(s => s.archived_at && state.topics.some(t => t.id === s.topic_id && t.course_id === c.id)) : [];
    state.editor = { id: c?.id || null, title: c?.title || "", description: c?.description || "", visibility: c?.visibility || "", originalVisibility: c?.visibility || "", topics, archivedTopics, archivedSections, removedTopics: 0, removedSections: 0, newTopic: "" };
    openDialog(c ? "Edit course" : "Create a course", `<div id="editor-body"></div>`);
    renderEditorBody();
  }

  function openImportDialog() {
    state.importDraft = null; state.importChoices = {}; state.importDestination = "new";
    const opts = state.courses.filter(c => !c.archived_at && c.owner_id === state.user.id).sort((a, b) => a.title.localeCompare(b.title)).map(c => `<option value="${esc(c.id)}">Add to ${esc(c.title)}</option>`).join("");
    openDialog("Import a study plan", `<p class="callout">Use any external AI tool. Paste the returned JSON below, review possible duplicates, then confirm. Importing material does not schedule it; you plan sections afterwards.</p><div class="form-stack" style="margin-top:13px"><label>Destination<select id="import-destination"><option value="new">Create a new course</option>${opts}</select></label><fieldset class="form-section" id="import-visibility-wrap"><legend>Who can see the new course?</legend><label class="check-line"><input type="radio" name="import_visibility" value="private"> Private · only me</label><label class="check-line"><input type="radio" name="import_visibility" value="shared"> Shared · every member can see and join it</label></fieldset><label>Copyable prompt<textarea id="import-prompt" readonly rows="6">Return JSON only using this shape: {"course_title":"Course title","description":"Optional description","topics":[{"title":"Topic title","sequence":1,"sections":[{"title":"Section title","sequence":1,"description":"Optional","source_reference":"Optional","prerequisites":[],"notes":"Optional"}]}]}. Preserve the source order. Do not include scripts, HTML, or executable content.</textarea></label><button type="button" class="button button-quiet" data-action="copy-import-prompt">Copy prompt</button><label>Study-plan JSON<textarea id="import-json" rows="9" placeholder="Paste the structured JSON returned by your external AI tool"></textarea></label><div class="button-row"><button type="button" class="button button-secondary" data-action="preview-import">Validate and preview</button></div><div id="import-preview"></div></div>`);
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
    if (!state.importDraft) return toast("Validate the JSON before confirming.");
    const body = importPayload(); if (!body.topics.length) return toast("All topics are marked skip; nothing was imported.");
    const destination = state.importDestination;
    let visibility = null;
    if (destination === "new") {
      visibility = document.querySelector('[name="import_visibility"]:checked')?.value || null;
      if (!visibility) { $("#import-visibility-wrap")?.scrollIntoView({ block: "center" }); return toast("Choose whether the new course is private or shared."); }
    } else {
      const c = courseOf(destination);
      if (!(await confirmed({ title: `Add to ${c?.title || "this course"}?`, message: `${plural(body.topics.length, "topic")} will be added after the existing topics.${c?.visibility === "shared" ? " Members who joined will see the new material." : ""}`, confirmLabel: "Add material" }))) return;
    }
    try {
      const result = destination !== "new"
        ? await state.sb.rpc("append_course_material", { p_course_id: destination, p_topics: body.topics })
        : await state.sb.rpc("create_course_from_import", { p_course_title: body.title, p_description: body.description, p_topics: body.topics, p_visibility: visibility });
      if (result.error) throw result.error;
      closeDialog(); toast(destination === "new" ? `Course imported as ${visibility}. Plan its sections when you're ready.` : "New material added to the course."); await loadData({ quiet: true });
    } catch (e) { toast(`Import was not saved: ${errorText(e)}`); }
  }

  /* ---------- the manual planner ---------- */

  function openBacklog() {
    const tasks = activeTasks(state.user.id).filter(t => t.scheduled_date < lagosDate() && !done(t.id)).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
    if (!tasks.length) return toast("No unfinished past tasks need rescheduling.");
    const groups = new Map(); tasks.forEach(t => { const key = t.course_id || "other"; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(t); });
    const groupRows = [...groups].map(([key, rows]) => `<fieldset class="form-section"><legend>${esc(key === "other" ? "Other tasks" : courseOf(key)?.title || "Course")}</legend>${rows.map(t => `<div class="suggestion-task"><span>${sectionBadge(t.section_id)}${esc(taskTitle(t))}<small class="task-subtitle">Was ${esc(weekdayName(t.scheduled_date))}${t.task_type === "anki" ? ` · ${ankiRemainingForTask(t) === null ? "Anki target not set" : `${ankiRemainingForTask(t)} cards remaining`}` : ""}</small></span><label>Move to<input type="date" value="" data-backlog-date="${esc(t.id)}"></label></div>`).join("")}</fieldset>`).join("");
    openDialog("Review unfinished work", `<form id="backlog-form" class="form-stack"><p class="callout">Pick a new date for any task you want to move. Rows left without a date stay where they are.</p><div class="button-row">${htmlButton("backlog-all-today", "Move all to today", "button button-quiet")}${htmlButton("backlog-spread", "Spread from tomorrow", "button button-quiet")}${htmlButton("backlog-clear", "Clear dates", "button button-quiet")}</div>${groupRows}<label>Reason (optional)<input name="reason" maxlength="1000" value="Backlog review"></label><div class="dialog-actions"><button type="submit" class="button button-primary">Move tasks with a date</button></div></form>`);
  }
  function openSuggestion(noticeId) {
    const n = state.notifications.find(x => x.id === noticeId); if (!n || n.recipient_id !== state.user.id) return;
    const tasks = (n.payload?.tasks || []).filter(t => { const task = state.tasks.find(x => x.id === t.task_id); return task && task.status === "scheduled" && !done(task.id); });
    if (!tasks.length) return openDialog("Review rescheduling suggestion", `<p class="callout">These tasks are already done, moved or removed. Nothing is left to change.</p><div class="dialog-actions"><button type="button" class="button button-primary" data-action="reject-suggestion" data-notice="${esc(noticeId)}">Archive suggestion</button></div>`);
    const rows = tasks.map(t => { const task = state.tasks.find(x => x.id === t.task_id), remaining = task && ankiRemainingForTask(task); return `<div class="suggestion-task"><span>${sectionBadge(task?.section_id)}${esc(task ? taskTitle(task) : t.task_title || "Study task")}<small class="task-subtitle">Originally ${esc(formatDate(t.scheduled_date))}${task?.task_type === "anki" ? ` · ${remaining === null ? "target not set" : `${remaining} cards remaining`}` : ""}</small></span><label>Proposed date<input type="date" value="${esc(n.payload?.proposed_date || lagosDate())}" data-suggestion-task="${esc(t.task_id)}"></label></div>`; }).join("");
    openDialog("Review rescheduling suggestion", `<p class="callout">This is a private suggestion. Nothing changes unless you approve it. Edit any date, or clear a date to leave that task where it is.</p>${rows}<div class="dialog-actions"><button type="button" class="button button-quiet" data-action="reject-suggestion" data-notice="${esc(noticeId)}">Reject · leave schedule unchanged</button><button type="button" class="button button-primary" data-action="approve-suggestion" data-notice="${esc(noticeId)}">Approve dates</button></div>`);
  }
  async function acceptSuggestion(noticeId) {
    const moves = $$("[data-suggestion-task]").filter(el => el.value).map(el => ({ task_id: el.dataset.suggestionTask, scheduled_date: el.value }));
    if (!moves.length) return toast("Give at least one task a date, or reject the suggestion.");
    if (!(await confirmed({ title: `Move ${plural(moves.length, "task")}?`, message: "Each moves to the date shown. Their history is kept.", confirmLabel: "Approve and move" }))) return;
    try {
      const r = await state.sb.rpc("move_tasks", { p_moves: moves, p_reason: "Participant approved reschedule suggestion" }); if (r.error) throw r.error;
      await state.sb.from("notifications").update({ read_at: new Date().toISOString(), archived_at: new Date().toISOString() }).eq("id", noticeId);
      state.dialogDirty = false; closeDialog(); toast(`${r.data} task(s) moved.`); await loadData({ quiet: true });
    } catch (e) { toast(`The schedule was not changed: ${errorText(e)}`); }
  }

  /* ---------- ticking, adding and editing tasks ---------- */
  async function toggleTask(taskId) {
    const task = state.tasks.find(t => t.id === taskId); if (!task || !requireOwner()) return;
    if (task.task_type === "anki") return openAnkiDialog(task);
    if (!navigator.onLine) return toast("You're offline. Reconnect before changing tasks.");
    const wasDone = done(taskId);
    if (wasDone && !(await confirmed({ title: "Untick this task?", message: `“${taskTitle(task)}” will no longer count as done.`, confirmLabel: "Untick" }))) return;
    const previous = state.completions.get(taskId);
    if (wasDone) state.completions.delete(taskId); else state.completions.set(taskId, { task_id: taskId, owner_id: state.user.id, scheduled_date_credit: task.scheduled_date, completed_at: new Date().toISOString() });
    renderApp();
    try {
      const result = wasDone
        ? await state.sb.from("task_completions").delete().eq("task_id", taskId).eq("owner_id", state.user.id)
        : await state.sb.from("task_completions").insert({ task_id: taskId, owner_id: state.user.id, scheduled_date_credit: task.scheduled_date });
      if (result.error) throw result.error;
      toast(wasDone ? "Task reopened." : "Task completed."); loadData({ quiet: true });
    } catch (e) {
      if (wasDone && previous) state.completions.set(taskId, previous); else state.completions.delete(taskId);
      renderApp(); setStatus(`Task was not changed: ${errorText(e)}`, "error");
    }
  }
  function openAnkiDialog(task) {
    const day=task.scheduled_date, target=targetForDay(day), log=state.ankiLogs.find(x=>x.log_date===day), complete=done(task.id);
    if(!target) return openDialog("Set an Anki target", `<p class="callout">This task is on ${esc(formatDate(day))}. In Settings, set an Anki target that starts on or before this date, then log your cards.</p><div class="dialog-actions"><button type="button" class="button button-secondary" data-tab="settings">Open Settings</button></div>`);
    openDialog("Log Anki cards", `<p class="callout">Target: ${target.target_count} cards · ${esc(formatDate(day))}. Card counts are self-reported. You can save partial progress without marking the task complete.</p><form id="anki-log-form" data-task="${esc(task.id)}" data-date="${esc(day)}" class="form-stack"><label>Cards completed so far (optional)<input type="number" name="cards_completed" min="0" step="1" value="${esc(log?.cards_completed??"")}" placeholder="Leave blank if you do not want to report a count"></label><div class="field-help">Remaining cards: ${Math.max(0,target.target_count-(Number(log?.cards_completed)||0))}. Counts above target are retained.</div><div class="button-row"><button type="submit" name="complete" value="false" class="button button-secondary">Save progress only</button>${!complete?`<button type="submit" name="complete" value="true" class="button button-primary">Mark target complete</button>`:`<button type="button" class="button button-quiet" data-action="undo-anki" data-task="${esc(task.id)}">Undo completion</button>`}</div></form>`);
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
    if(capacity!==null&&(!Number.isInteger(capacity)||capacity<1||capacity>100)) return toast("Daily guide must be a whole number from 1 to 100.");
    const r=await state.sb.from("user_preferences").upsert({profile_id:state.user.id,theme,daily_section_capacity:capacity},{onConflict:"profile_id"});
    if(r.error) return toast(`Preferences not saved: ${errorText(r.error)}`);
    applyTheme(theme,{save:false});toast("Preferences saved.");await loadData({quiet:true});
  }
  async function saveTarget(form) {
    const count=Number(form.elements.target_count.value), date=form.elements.effective_from.value;
    if(!Number.isInteger(count)||count<1||count>100000) return toast("Target must be a positive whole number.");
    if(!date) return toast("Choose the date the target starts.");
    const r=await state.sb.rpc("set_anki_target",{p_target_count:count,p_effective_from:date});
    if(r.error) return toast(`Target not saved: ${errorText(r.error)}`);
    toast("Anki target saved.");await loadData({quiet:true});
  }
  async function createQuickTask(form) {
    const type = readType(form), course = readCourse(form), date = form.elements.scheduled_date.value;
    const sectionId = form.elements.section_id?.value || null;
    const markDone = !!form.elements.mark_done?.checked && date <= lagosDate() && type.task_type !== "anki";
    if (form.elements.deadline.value && form.elements.deadline.value < date) return toast("The deadline can't be before the task's date.");
    const task = { task_title: form.elements.task_title.value.trim(), ...type, priority: form.elements.priority.value, scheduled_date: date, deadline: form.elements.deadline.value || null, course_id: course.course_id, course_label: course.course_label, section_id: course.course_id ? sectionId : null, idempotency_key: `manual:${crypto.randomUUID()}`, mark_done: markDone };
    const r = await state.sb.rpc("commit_task_schedule", { p_plan_id: null, p_tasks: [task], p_reason: "Participant-created task" });
    if (r.error) return toast(`Task not saved: ${errorText(r.error)}`);
    state.dialogDirty = false; closeDialog(); toast(markDone ? "Task added and marked done." : "Task added to your schedule."); await loadData({ quiet: true });
  }
  async function saveDeadline(form) {
    const visibility = form.elements.visibility.value, course = readCourse(form);
    const row = { group_id: currentGroupId(), owner_id: visibility === "private" ? state.user.id : null, course_id: course.course_id, title: form.elements.title.value.trim(), description: form.elements.description.value.trim(), due_date: form.elements.due_date.value, priority: form.elements.priority.value, visibility, status: "active", created_by: state.user.id };
    if (course.course_label) row.course_label = course.course_label;
    const r = await state.sb.from("exams_deadlines").insert(row); if (r.error) return toast(`Deadline not saved: ${errorText(r.error)}`);
    state.dialogDirty = false; closeDialog(); toast("Deadline saved."); await loadData({ quiet: true });
  }

  function deadlineById(id) { return state.exams.find(e => e.id === id); }
  function deadlineStatusLabel(e) { return e.archived_at ? "Removed" : e.status === "active" ? "Active" : e.status === "cancelled" ? "Cancelled" : e.status === "completed" ? "Completed" : String(e.status || "Active"); }
  function openDeadlineManager() {
    const today = lagosDate();
    const rows = [...state.exams].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date))).map(e => {
      const live = e.status === "active" && !e.archived_at;
      const remaining = dayDiff(today, e.due_date);
      const when = remaining < 0 ? `${-remaining}d ago` : remaining === 0 ? "Today" : `in ${remaining}d`;
      const course = e.course_id ? courseOf(e.course_id)?.title : e.course_label;
      return `<div class="deadline-row ${live ? "" : "is-inactive"}"><span class="deadline-date">${live ? esc(when) : esc(deadlineStatusLabel(e))}</span><div class="deadline-copy"><strong>${esc(e.title)}</strong><small>${esc(formatDate(e.due_date))}${e.visibility === "group" ? " · group" : " · personal"}${course ? ` · ${esc(course)}` : ""}</small></div>${canEditDeadline(e) ? `<button type="button" class="text-button deadline-edit" data-action="edit-deadline" data-deadline="${esc(e.id)}">Edit</button>` : ""}</div>`;
    }).join("") || `<div class="empty-state">No deadlines yet. Use the add button to create one.</div>`;
    openDialog("Manage exams and deadlines", `<div class="deadline-list">${rows}</div><div class="dialog-actions"><button type="button" class="button button-primary" data-action="add-deadline">Add a deadline</button></div>`);
  }
  function openDeadlineEdit(id) {
    const e = deadlineById(id); if (!e) return toast("That deadline could not be found. Refresh and try again.");
    if (!canEditDeadline(e)) return toast("Only its owner can edit a personal deadline.");
    const live = e.status === "active" && !e.archived_at;
    openDialog("Edit deadline", `<form id="deadline-edit-form" class="form-stack" data-deadline="${esc(e.id)}"><label>Title<input name="title" maxlength="160" value="${esc(e.title)}" required></label><label>Description<textarea name="description" maxlength="4000">${esc(e.description || "")}</textarea></label><div class="field-grid"><label>Date<input type="date" name="due_date" value="${esc(e.due_date)}" required></label>${priorityField(e.priority)}${courseField(e.course_id || "", e.course_label || "")}</div><button class="button button-primary" type="submit">Save changes</button><div class="button-row">${live ? `<button type="button" class="button button-secondary" data-action="cancel-deadline" data-deadline="${esc(e.id)}">Mark as cancelled</button>` : `<button type="button" class="button button-secondary" data-action="reopen-deadline" data-deadline="${esc(e.id)}">Reactivate</button>`}<button type="button" class="button button-danger" data-action="delete-deadline" data-deadline="${esc(e.id)}">Delete</button></div></form>`);
  }
  async function updateDeadlineRow(id, patch) {
    const r = await state.sb.from("exams_deadlines").update(patch).eq("id", id).select("id");
    if (r.error) return { error: r.error };
    if (!r.data || !r.data.length) return { error: { message: "The database did not allow this change." } };
    return { error: null };
  }
  async function saveDeadlineEdit(form) {
    const course = readCourse(form);
    const patch = { title: form.elements.title.value.trim(), description: form.elements.description.value.trim(), due_date: form.elements.due_date.value, priority: form.elements.priority.value, course_id: course.course_id, course_label: course.course_label };
    const r = await updateDeadlineRow(form.dataset.deadline, patch);
    if (r.error) return toast(`Deadline not saved: ${errorText(r.error)}`);
    state.dialogDirty = false; toast("Deadline updated."); await loadData({ quiet: true }); openDeadlineManager();
  }
  async function setDeadlineActive(id, active) {
    const e = deadlineById(id); if (!e) return;
    if (!active && !(await confirmed({ title: `Cancel “${e.title}”?`, message: "It stays in the list as cancelled, and you can reactivate it later.", confirmLabel: "Mark as cancelled" }))) return;
    let r;
    if (active) { r = await updateDeadlineRow(id, { status: "active", archived_at: null }); if (r.error) r = await updateDeadlineRow(id, { status: "active" }); }
    else { r = await updateDeadlineRow(id, { status: "cancelled" }); if (r.error) r = await updateDeadlineRow(id, { archived_at: new Date().toISOString() }); }
    if (r.error) return toast(`Could not change it: ${errorText(r.error)}`);
    state.dialogDirty = false; toast(active ? "Deadline reactivated." : "Deadline cancelled."); await loadData({ quiet: true }); openDeadlineManager();
  }
  async function deleteDeadline(id) {
    const e = deadlineById(id); if (!e) return;
    if (!(await confirmed({ title: `Delete “${e.title}”?`, message: "This removes it permanently for everyone who can see it.", confirmLabel: "Delete", danger: true }))) return;
    const r = await state.sb.from("exams_deadlines").delete().eq("id", id).select("id");
    if (r.error) return toast(`Could not delete: ${errorText(r.error)}`);
    if (!r.data || !r.data.length) return toast("The database did not allow deleting this. Try Mark as cancelled instead.");
    state.dialogDirty = false; toast("Deadline deleted."); await loadData({ quiet: true }); openDeadlineManager();
  }

  async function clearCourseSchedule(courseId) {
    const c = courseOf(courseId); if (!c) return;
    const open = activeTasks(state.user.id).filter(t => t.course_id === courseId && !done(t.id));
    if (!open.length) return toast("There are no unfinished tasks for this course.");
    if (!(await confirmed({ title: `Clear your schedule for “${c.title}”?`, message: `${plural(open.length, "unfinished task")} will be removed from your schedule. Completed tasks stay. You can plan the course again any time.`, confirmLabel: "Clear schedule", danger: true }))) return;
    const r = await state.sb.rpc("clear_course_schedule", { p_course_id: courseId });
    if (r.error) return toast(`Schedule not cleared: ${errorText(r.error)}`);
    toast(`${plural(r.data || 0, "task")} removed. You can plan this course again any time.`); await loadData({ quiet: true });
  }
  async function archiveCourse(courseId) {
    const c = courseOf(courseId); if (!c || c.owner_id !== state.user.id) return;
    if (!(await confirmed({ title: `Archive “${c.title}”?`, message: "It disappears from the planner for everyone. Completed history is kept.", confirmLabel: "Archive course", danger: true }))) return;
    const r = await state.sb.from("courses").update({ archived_at: new Date().toISOString() }).eq("id", courseId).select("id");
    if (r.error || !r.data?.length) return toast(`Course not archived: ${r.error ? errorText(r.error) : "the database did not allow it"}`);
    state.dialogDirty = false; closeDialog(); toast("Course archived."); await loadData({ quiet: true });
  }

  /* ---------- backlog and suggestions ---------- */
  async function createRecurring(form) {
    const recurrence = form.elements.recurrence.value, weekdays = [...form.querySelectorAll('[name="weekdays"]:checked')].map(x => Number(x.value));
    if (recurrence === "weekdays" && !weekdays.length) return toast("Choose at least one weekday.");
    const start = form.elements.start_date.value, until = form.elements.active_until.value || null;
    if (until && until < start) return toast("The stop date must be on or after the start date.");
    const type = readType(form), course = readCourse(form);
    const r = await state.sb.rpc("create_recurring_rule", { p_title: form.elements.title.value.trim(), p_task_type: type.task_type, p_recurrence: recurrence, p_weekdays: weekdays, p_start_date: start, p_active_until: until, p_priority: form.elements.priority.value, p_course_id: course.course_id, p_task_type_label: type.task_type_label, p_course_label: course.course_label });
    if (r.error) return toast(`Recurrence not saved: ${errorText(r.error)}`);
    closeDialog(); toast("Recurring task created."); await loadData({ quiet: true });
  }

  /* ---------- course outline (read-only view for everyone) ---------- */
  function openCourseTransfer(courseId) {
    const course = courseOf(courseId); if (!course || course.owner_id !== state.user.id) return;
    const members = state.members.filter(p => p.id !== state.user.id);
    if (!members.length) return toast("Another active member is needed before ownership can be transferred.");
    openDialog("Transfer course ownership", `<p class="callout">The new owner becomes the only person who can edit this course. Your own schedule and progress stay with you.</p><form id="transfer-course-form" data-course="${esc(course.id)}" class="form-stack"><label>New owner<select name="new_owner" required>${members.map(p => `<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join("")}</select></label><button type="submit" class="button button-primary">Transfer ownership</button></form>`);
  }
  async function transferCourse(form) {
    const name = nameOf(form.elements.new_owner.value), c = courseOf(form.dataset.course);
    if (!(await confirmed({ title: `Give “${c?.title}” to ${name}?`, message: `${name} becomes the owner and the only person who can edit it. You can't undo this yourself; ${name} would have to transfer it back.`, confirmLabel: "Transfer", danger: true }))) return;
    const r = await state.sb.rpc("transfer_course_ownership", { p_course_id: form.dataset.course, p_new_owner: form.elements.new_owner.value });
    if (r.error) return toast(`Ownership was not changed: ${errorText(r.error)}`);
    state.dialogDirty = false; closeDialog(); toast("Course ownership transferred."); await loadData({ quiet: true });
  }
  async function addTaskDate(form) {
    const moves = $$("[data-backlog-date]", form).filter(el => el.value).map(el => ({ task_id: el.dataset.backlogDate, scheduled_date: el.value }));
    if (!moves.length) return toast("Give at least one task a new date.");
    if (!(await confirmed({ title: `Move ${plural(moves.length, "task")}?`, message: "Each moves to the date you picked. Their history is kept.", confirmLabel: "Move tasks" }))) return;
    const r = await state.sb.rpc("move_tasks", { p_moves: moves, p_reason: form.elements.reason.value || "Participant-approved backlog redistribution" });
    if (r.error) return toast(`No tasks moved: ${errorText(r.error)}`);
    state.dialogDirty = false; closeDialog(); toast(`${r.data} task(s) moved.`); await loadData({ quiet: true });
  }

  async function joinCourse(courseId) {
    const course = courseOf(courseId); if (!course) return;
    if (!(await confirmed({ title: `Join “${course.title}”?`, message: "You'll be able to plan any of its sections on your own days. Nothing is added to your schedule until you plan it.", confirmLabel: "Join course" }))) return;
    const r = await state.sb.rpc("join_course", { p_course_id: courseId });
    if (r.error) return toast(`Could not join: ${errorText(r.error)}`);
    toast("Joined. Tap Plan sections to add it to your schedule."); await loadData({ quiet: true });
    if ($("#app-dialog")?.open) openCourseDetail(courseId);
  }
  async function cloneCourse(form) {
    const c = courseOf(form.dataset.course); if (!c) return;
    const topics = activeTopics(c.id).map((t, i) => ({ title: t.title, sequence: i + 1, description: t.description, sections: activeSections(t.id).map((s, k) => ({ title: s.title, sequence: k + 1, description: s.description, source_reference: s.source_reference, prerequisites: s.prerequisites, notes: s.notes })) }));
    if (!topics.length) return toast("This course has no content to copy.");
    const r = await state.sb.rpc("create_course_from_import", { p_course_title: form.elements.title.value.trim(), p_description: `Private copy of ${c.title}.`, p_topics: topics, p_visibility: "private" });
    if (r.error) return toast(`Private copy not created: ${errorText(r.error)}`);
    state.dialogDirty = false; closeDialog(); toast("Private copy created."); await loadData({ quiet: true });
  }

  async function claimLegacy(form) {
    if(!state.user)return;
    const code=form.elements.claim_code.value.trim();
    const r=await state.sb.rpc("claim_legacy_identity",{p_code:code});
    if(r.error)return toast(`Claim not completed: ${errorText(r.error)}`);
    closeDialog();toast(`Legacy identity linked. ${r.data?.unmapped_tick_count||0} old tick(s) need review.`);await loadData({quiet:true});
  }
  async function membershipAction(rejoin) {
    if (!rejoin && !(await confirmed({ title: "Leave Tetralogy?", message: "Your account, personal data and history stay saved, but group access ends until you rejoin.", confirmLabel: "Leave the group", danger: true }))) return;
    const r = rejoin
      ? await state.sb.from("group_members").update({ status: "active", left_at: null }).eq("group_id", currentGroupId()).eq("profile_id", state.user.id)
      : await state.sb.from("group_members").update({ status: "left", left_at: new Date().toISOString() }).eq("group_id", currentGroupId()).eq("profile_id", state.user.id);
    if (r.error) return toast(`Membership was not changed: ${errorText(r.error)}`);
    toast(rejoin ? "Welcome back to the study team." : "You left the group. Your account and records remain saved."); state.viewerId = state.user.id; await loadData({ quiet: true });
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
    state.user=null;state.profile=null;state.privateProfile=null;state.members=[];state.tasks=[];state.completions.clear();state.events=[];state.notifications=[];state.ankiLogs=[];state.ankiTargets=[];state.audit=[];state.loaded=false;state.viewerId=null;state.fromCache=false;
    // Remove this app's saved copies of study data; the theme choice stays on this device.
    try{for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i);if(k?.startsWith("tetralogy:"))localStorage.removeItem(k);}}catch{/* ignore */}
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
      rows.push(["task",t.id,taskTitle(t),courseOf(t.course_id)?.title||t.course_label||"",t.scheduled_date,t.deadline||"",t.status,t.priority,c?`completed ${c.completed_at}`:"not completed",c?.scheduled_date_credit||""]);
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
    const backup = state.restoreDraft; if (!backup) return toast("Choose a valid backup first.");
    if (!(await confirmed({ title: "Restore this backup?", message: "Missing records from the file are added back. Records you already have are never overwritten.", confirmLabel: "Restore" }))) return;
    const res = await state.sb.rpc("restore_personal_backup", { p_backup: backup });
    if (res.error) return toast(`Backup was not restored: ${errorText(res.error)}`);
    state.restoreDraft = null; state.dialogDirty = false; closeDialog(); toast("Personal backup restored. Existing records were not overwritten."); await loadData({ quiet: true });
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
    const t = state.tasks.find(x => x.id === id); if (!t || t.owner_id !== state.user.id) return;
    const isDone = done(t.id);
    openDialog("Edit task", `<form id="edit-task-form" data-task="${esc(id)}" class="form-stack">${t.section_id ? `<p class="callout">${sectionBadge(t.section_id)} Linked to the section “${esc(sectionOf(t.section_id)?.title || "")}”.</p>` : ""}${isDone ? `<p class="callout">This task is marked done${state.completions.get(t.id)?.completed_at ? ` (${esc(formatTime(state.completions.get(t.id).completed_at))})` : ""}.</p>` : ""}<label>Task title<input name="task_title" value="${esc(t.task_title)}" maxlength="240" required></label><div class="field-grid">${typeField(t.task_type, t.task_type_label || "")}${priorityField(t.priority)}<label>Date${dayDateInput("scheduled_date", t.scheduled_date)}</label><label>Deadline (optional)<input type="date" name="deadline" value="${esc(t.deadline || "")}"></label></div>${courseField(t.course_id || "", t.course_label || "", { sections: true, sectionId: t.section_id || "" })}<label>Status<select name="status"><option value="scheduled" ${t.status === "scheduled" ? "selected" : ""}>Scheduled</option><option value="cancelled" ${t.status === "cancelled" ? "selected" : ""}>Cancelled (history kept)</option><option value="archived" ${t.status === "archived" ? "selected" : ""}>Archived (history kept)</option></select></label>${!isDone && t.task_type !== "anki" ? `<label class="check-line" data-done-wrap ${t.scheduled_date <= lagosDate() ? "" : "hidden"}><input type="checkbox" name="mark_done"> Mark as done (counts on its date)</label>` : ""}<label>Reason (optional)<input name="reason" maxlength="1000" value="Participant-edited task"></label><div class="dialog-actions"><button type="button" class="button button-danger" data-action="remove-task" data-task="${esc(id)}">Remove task</button><button type="submit" class="button button-primary">Save changes</button></div></form>`);
  }
  async function removeTask(id) {
    const t = state.tasks.find(x => x.id === id); if (!t || t.owner_id !== state.user.id) return;
    const isDone = done(t.id);
    if (!(await confirmed({ title: "Remove this task?", message: `“${taskTitle(t)}” will be taken off your schedule. Its history is kept.${isDone ? " It is marked done, so its completion will also be removed." : ""}`, confirmLabel: "Remove task", danger: true }))) return;
    const r = await state.sb.rpc("update_task_instance", { p_task_id: t.id, p_task_title: t.task_title, p_scheduled_date: t.scheduled_date, p_deadline: t.deadline || null, p_priority: t.priority, p_status: "cancelled", p_reason: "Removed by participant", p_remove_completion: isDone });
    if (r.error) return toast(`Could not remove it: ${errorText(r.error)}`);
    state.dialogDirty = false; closeDialog(); toast("Task removed."); await loadData({ quiet: true });
  }
  async function saveTaskEdit(form) {
    const t = state.tasks.find(x => x.id === form.dataset.task); if (!t) return;
    const date = form.elements.scheduled_date.value, status = form.elements.status.value, deadline = form.elements.deadline.value || null;
    if (!date) return toast("Choose a date for the task.");
    if (status === "scheduled" && deadline && deadline < date) return toast("The deadline can't be before the task's date.");
    const type = readType(form), course = readCourse(form), sectionId = course.course_id ? (form.elements.section_id?.value || null) : null;
    const isDone = done(t.id);
    if (type.task_type === "anki" && t.task_type !== "anki" && isDone) return toast("Untick the task before turning it into an Anki task.");
    let removeCompletion = false;
    if (isDone && status !== "scheduled") {
      if (!(await confirmed({ title: status === "cancelled" ? "Cancel a completed task?" : "Archive a completed task?", message: "This task is marked done. Saving will also remove its completion.", confirmLabel: "Save anyway", danger: true }))) return;
      removeCompletion = true;
    }
    const r = await state.sb.rpc("update_task_instance", { p_task_id: t.id, p_task_title: form.elements.task_title.value.trim(), p_scheduled_date: date, p_deadline: deadline, p_priority: form.elements.priority.value, p_status: status, p_reason: form.elements.reason.value || "Participant-edited task", p_apply_details: true, p_task_type: type.task_type, p_task_type_label: type.task_type_label, p_course_id: course.course_id, p_course_label: course.course_label, p_section_id: sectionId, p_remove_completion: removeCompletion });
    if (r.error) return toast(`Task changes were not saved: ${errorText(r.error)}`);
    if (status === "scheduled" && !isDone && form.elements.mark_done?.checked && date <= lagosDate() && type.task_type !== "anki") {
      const c = await state.sb.from("task_completions").insert({ task_id: t.id, owner_id: state.user.id, scheduled_date_credit: date });
      if (c.error) toast(`Saved, but not marked done: ${errorText(c.error)}`);
    }
    state.dialogDirty = false; closeDialog(); toast("Task changes saved."); await loadData({ quiet: true });
  }

  async function disposeRealtime() {
    clearTimeout(state.realtimeTimer);
    if(state.sb&&state.realtime.length){const chans=state.realtime;state.realtime=[];await Promise.all(chans.map(ch=>state.sb.removeChannel(ch)));}
  }
  /* Apply one live change to the data already on screen; fall back to a quiet refresh. */
  async function startRealtime() {
    await disposeRealtime(); if(!state.sb||!state.user||state.membership?.status!=="active")return;
    let channel=state.sb.channel(`tetralogy-${state.user.id}-${crypto.randomUUID()}`);
    for(const table of ["task_instances","task_completions","study_activity_events","notifications","course_sections"]) channel=channel.on("postgres_changes",{event:"*",schema:"public",table},payload=>applyRealtime(table,payload));
    channel.subscribe();state.realtime=[channel];
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
  function myMembership(courseId) { return state.courseMemberships.find(m => m.course_id === courseId && m.profile_id === state.user?.id) || null; }
  function joinedCourse(courseId) { return myMembership(courseId)?.status === "active"; }
  function canPlanCourse(c) { return !!c && !c.archived_at && (c.owner_id === state.user?.id || (c.visibility === "shared" && joinedCourse(c.id))); }
  function usableCourses(ownerId = state.user?.id) { return state.courses.filter(c => !c.archived_at && (c.owner_id === ownerId || c.visibility === "shared")).sort((a, b) => a.title.localeCompare(b.title)); }
  function activeTopics(courseId) { return state.topics.filter(t => t.course_id === courseId && !t.archived_at).sort((a, b) => a.sequence_number - b.sequence_number); }
  function activeSections(topicId) { return state.sections.filter(s => s.topic_id === topicId && !s.archived_at).sort((a, b) => a.sequence_number - b.sequence_number); }
  /* Course-wide section numbers 1–N: topics in course order, then sections in each topic. */
  function courseOutline(courseId) {
    if (!state.outlineCache) state.outlineCache = new Map();
    if (state.outlineCache.has(courseId)) return state.outlineCache.get(courseId);
    let n = 0;
    const topics = activeTopics(courseId).map(t => ({ topic: t, sections: activeSections(t.id).map(s => ({ section: s, number: ++n })) }));
    const outline = { topics, total: n, numbers: new Map(topics.flatMap(t => t.sections.map(x => [x.section.id, x.number]))) };
    state.outlineCache.set(courseId, outline);
    return outline;
  }
  function sectionNumber(sectionId) {
    const course = sectionCourse(sectionId); if (!course) return null;
    return courseOutline(course.id).numbers.get(sectionId) || null;
  }
  function sectionBadge(sectionId) { const n = sectionId ? sectionNumber(sectionId) : null; return n ? `<span class="sec-num" title="Section ${n} of the course">#${n}</span>` : ""; }
  function taskForSection(sectionId, ownerId = state.user?.id) {
    const rows = activeTasks(ownerId).filter(t => t.section_id === sectionId);
    return rows.find(t => done(t.id)) || rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0] || null;
  }
  /* A task-type dropdown that ends with "Custom…"; choosing it reveals a text box. */
  function typeField(type = "study", label = "", fieldLabel = "Type") {
    const custom = type === "custom";
    return `<label>${esc(fieldLabel)}<select name="task_type" data-custom-select="task_type_label">${TASK_TYPES.map(([v, l]) => `<option value="${v}" ${type === v ? "selected" : ""}>${esc(l)}</option>`).join("")}<option value="custom" ${custom ? "selected" : ""}>Custom…</option></select><input name="task_type_label" class="custom-input" maxlength="60" placeholder="Type your own task type" value="${esc(custom ? label || "" : "")}" ${custom ? "" : "hidden"} aria-label="Custom task type"></label>`;
  }
  function readType(form) {
    const type = form.elements.task_type.value;
    const label = type === "custom" ? String(form.elements.task_type_label?.value || "").trim() : "";
    return { task_type: type, task_type_label: label || null };
  }
  /* A course dropdown: No course, the courses, then "Custom…" with a text box. */
  function courseField(courseId = "", label = "", { name = "course_id", fieldLabel = "Course (optional)", sections = false, sectionId = "" } = {}) {
    const custom = !courseId && String(label || "").trim() !== "";
    const courses = usableCourses();
    const extra = courseId && !courses.some(c => c.id === courseId) && courseOf(courseId) ? [courseOf(courseId)] : [];
    const options = [...courses, ...extra].map(c => `<option value="${esc(c.id)}" ${c.id === courseId ? "selected" : ""}>${esc(c.title)}</option>`).join("");
    const sectionPart = sections ? `<label data-section-wrap ${courseId ? "" : "hidden"}>Section (optional)<select name="section_id">${sectionOptions(courseId, sectionId)}</select></label>` : "";
    return `<label>${esc(fieldLabel)}<select name="${esc(name)}" data-custom-select="course_label" ${sections ? "data-section-source" : ""}><option value="" ${!courseId && !custom ? "selected" : ""}>No course</option>${options}<option value="__custom" ${custom ? "selected" : ""}>Custom…</option></select><input name="course_label" class="custom-input" maxlength="120" placeholder="Type a course or subject name" value="${esc(custom ? label : "")}" ${custom ? "" : "hidden"} aria-label="Custom course name"></label>${sectionPart}`;
  }
  function sectionOptions(courseId, selected = "") {
    if (!courseId || courseId === "__custom") return `<option value="">No section</option>`;
    const outline = courseOutline(courseId);
    return `<option value="">No section</option>${outline.topics.map(t => `<optgroup label="${esc(t.topic.title)}">${t.sections.map(x => `<option value="${esc(x.section.id)}" ${x.section.id === selected ? "selected" : ""}>#${x.number} · ${esc(x.section.title)}</option>`).join("")}</optgroup>`).join("")}`;
  }
  function readCourse(form, name = "course_id") {
    const v = form.elements[name]?.value || "";
    if (v === "__custom") { const label = String(form.elements.course_label?.value || "").trim(); return { course_id: null, course_label: label || null }; }
    return { course_id: v || null, course_label: null };
  }
  function priorityField(value = "normal") {
    return `<label>Priority<select name="priority">${[["critical", "Critical"], ["high", "High"], ["normal", "Normal"], ["low", "Low"]].map(([v, l]) => `<option value="${v}" ${value === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
  }
  function weekdayName(date) { return formatDate(date, { weekday: "short", month: "short", day: "numeric" }); }

  /* ---------- in-app confirmation box ---------- */
  function confirmBox({ title = "Are you sure?", message = "", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false, checkbox = "" } = {}) {
    return new Promise(resolve => {
      const d = $("#confirm-dialog");
      if (!d) return resolve({ ok: window.confirm(`${title}\n\n${message}`), checked: false });
      $("#confirm-title").textContent = title;
      $("#confirm-body").innerHTML = `<p>${esc(message).replace(/\n/g, "<br>")}</p>${checkbox ? `<label class="check-line confirm-check"><input type="checkbox" id="confirm-checkbox">${esc(checkbox)}</label>` : ""}<div class="dialog-actions"><button type="button" class="button button-quiet" data-confirm="no">${esc(cancelLabel)}</button><button type="button" class="button ${danger ? "button-danger" : "button-primary"}" data-confirm="yes">${esc(confirmLabel)}</button></div>`;
      const finish = ok => { const checked = !!$("#confirm-checkbox")?.checked; d.removeEventListener("click", onClick); d.removeEventListener("cancel", onCancel); if (d.open) d.close(); resolve({ ok, checked }); };
      const onClick = e => { const b = e.target.closest("[data-confirm]"); if (b) { e.stopPropagation(); finish(b.dataset.confirm === "yes"); } };
      const onCancel = e => { e.preventDefault(); finish(false); };
      d.addEventListener("click", onClick); d.addEventListener("cancel", onCancel);
      d.showModal();
      d.querySelector('[data-confirm="yes"]')?.focus();
    });
  }
  async function confirmed(options) { return (await confirmBox(options)).ok; }

  /* ---------- data loading ---------- */
  async function fetchAll(makeQuery, max = 50000) {
    const rows = [];
    for (let from = 0; from < max; from += 1000) {
      const page = await fetchData(makeQuery().range(from, from + 999));
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows;
  }
  function cacheKey() { return state.user ? `tetralogy:cache:${state.user.id}` : null; }
  function saveCache() {
    const key = cacheKey(); if (!key) return;
    try {
      const snap = { v: 2, at: Date.now() };
      for (const f of CACHE_FIELDS) snap[f] = state[f];
      snap.completions = [...state.completions.values()];
      snap.notificationReceipts = [...state.notificationReceipts.values()];
      snap.activityReads = [...state.activityReads];
      snap.events = (state.events || []).slice(0, 120);
      localStorage.setItem(key, JSON.stringify(snap));
    } catch { /* storage full or blocked: the app still works without the saved copy */ }
  }
  function restoreCache() {
    const key = cacheKey(); if (!key) return false;
    try {
      const snap = JSON.parse(localStorage.getItem(key) || "null");
      if (!snap || snap.v !== 2 || !snap.profile || snap.profile.id !== state.user.id) return false;
      for (const f of CACHE_FIELDS) if (snap[f] !== undefined) state[f] = snap[f];
      state.completions = new Map((snap.completions || []).map(c => [c.task_id, c]));
      state.notificationReceipts = new Map((snap.notificationReceipts || []).map(r => [r.notification_id, r]));
      state.activityReads = new Set(snap.activityReads || []);
      state.outlineCache = new Map();
      if (!state.viewerId || !state.members.some(p => p.id === state.viewerId)) state.viewerId = state.user.id;
      state.loaded = true; state.fromCache = true;
      if (!state.openDays.size) state.openDays.add(lagosDate());
      return true;
    } catch { return false; }
  }
  function setUpdating(on) { const el = $("#updating-note"); if (el) el.hidden = !on; }
  /* Background refreshes never redraw over an open box or a field you are typing in. */
  function userIsBusy() {
    if ($("#app-dialog")?.open || $("#confirm-dialog")?.open) return true;
    const a = document.activeElement;
    return !!(a && a.closest && a.closest("#app") && a.matches("input, textarea, select"));
  }
  function safeRender() {
    if (userIsBusy()) { state.renderPending = true; return; }
    state.renderPending = false; renderApp();
  }
  function flushRender() { if (state.renderPending && !userIsBusy()) { state.renderPending = false; renderApp(); } }
  function localTheme() { try { const t = localStorage.getItem("tetralogy-theme"); return t === "light" || t === "dark" ? t : null; } catch { return null; } }
  function canEditDeadline(e) { return !!e && (e.visibility === "group" || e.owner_id === state.user?.id || e.created_by === state.user?.id); }
  function sortTasksForDay(tasks) {
    return [...tasks].sort((a, b) => {
      const ca = a.course_id || "~", cb = b.course_id || "~";
      if (ca !== cb) return ca.localeCompare(cb);
      return (sectionNumber(a.section_id) || 1e9) - (sectionNumber(b.section_id) || 1e9) || taskTitle(a).localeCompare(taskTitle(b));
    });
  }
  function courseCard(c, view) {
    const own = view.id === state.user.id, mine = c.owner_id === state.user.id;
    const outline = courseOutline(c.id);
    const tasks = activeTasks(view.id).filter(t => t.course_id === c.id);
    const planned = new Set(tasks.filter(t => t.section_id).map(t => t.section_id));
    const doneSections = new Set(tasks.filter(t => t.section_id && done(t.id)).map(t => t.section_id));
    const joinedCount = state.courseMemberships.filter(m => m.course_id === c.id && m.status === "active" && m.profile_id !== c.owner_id).length;
    const membership = myMembership(c.id), joined = membership?.status === "active", left = membership?.status === "left";
    const badges = [`<span class="pill ${c.visibility === "shared" ? "is-good" : "is-private"}">${esc(c.visibility)}</span>`];
    if (own && mine) badges.push(`<span class="pill is-owner">Owner</span>`);
    if (own && !mine && joined) badges.push(`<span class="pill is-joined">✓ Joined</span>`);
    const buttons = [];
    if (own) {
      if (mine || joined) buttons.push(htmlButton("plan-sections", "Plan sections", "button button-primary", `data-course="${esc(c.id)}"`));
      if (!mine && c.visibility === "shared" && !joined) buttons.push(htmlButton("join-course", left ? "Join again" : "Join", "button button-primary", `data-course="${esc(c.id)}"`));
      buttons.push(htmlButton("course-detail", "View outline", "button button-quiet", `data-course="${esc(c.id)}"`));
      if (mine) buttons.push(htmlButton("edit-course", "Edit course", "button button-quiet", `data-course="${esc(c.id)}"`));
      if (tasks.some(t => !done(t.id))) buttons.push(htmlButton("clear-schedule", "Clear schedule", "button button-quiet", `data-course="${esc(c.id)}"`));
      if (!mine && joined) buttons.push(htmlButton("leave-course", "Leave", "button button-quiet button-leave", `data-course="${esc(c.id)}"`));
    } else buttons.push(htmlButton("course-detail", "View outline", "button button-quiet", `data-course="${esc(c.id)}"`));
    return `<article class="course-card"><div class="course-card-top"><div><h3>${esc(c.title)}</h3><p>${esc(c.description || "No course description")}</p></div><div class="badge-stack">${badges.join("")}</div></div><div class="course-card-stats"><span>${plural(outline.topics.length,"topic")}</span><span>${plural(outline.total,"section")}</span><span>${planned.size} planned · ${doneSections.size} done</span>${c.visibility === "shared" ? `<span>${plural(joinedCount, "member")} joined</span>` : ""}</div>${!mine && c.visibility === "shared" && own && !joined ? `<p class="field-help">Join this course to plan its sections on your own days.</p>` : ""}<div class="button-row">${buttons.join("")}</div></article>`;
  }
  async function requestCloseDialog() {
    if (state.dialogDirty && !(await confirmed({ title: "Discard your changes?", message: "You have typed or changed something in this box. Closing it now will lose those changes.", confirmLabel: "Discard", cancelLabel: "Keep editing", danger: true }))) return;
    closeDialog();
  }
  function recurringFields(r = {}) {
    const days = new Set(r.weekdays || []);
    return `<label>Task title<input name="title" value="${esc(r.title || "")}" maxlength="200" required></label><div class="field-grid">${typeField(r.task_type || "study", r.task_type_label || "")}<label>Repeats<select name="recurrence">${[["daily","Daily"],["weekly","Weekly"],["weekdays","Selected weekdays"]].map(([v,l])=>`<option value="${v}" ${(r.recurrence||"daily")===v?"selected":""}>${l}</option>`).join("")}</select></label><label>Start date${dayDateInput("start_date", r.start_date || lagosDate())}</label><label>Stop after (optional)<input type="date" name="active_until" value="${esc(r.active_until || "")}"></label>${priorityField(r.priority || "normal")}${courseField(r.course_id || "", r.course_label || "")}</div><fieldset class="form-section"><legend>Weekdays (used when repeats is “Selected weekdays”)</legend><div class="button-row">${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((n,i)=>`<label class="check-line"><input type="checkbox" name="weekdays" value="${i}" ${days.has(i)?"checked":""}>${n}</label>`).join("")}</div></fieldset><p class="field-help">Tasks are created from today onward, even when the start date is earlier.</p>`;
  }
  function openPlanner(courseId) {
    const c = courseOf(courseId); if (!c || isReadOnly()) return;
    if (!canPlanCourse(c)) return toast(c.visibility === "shared" ? "Join this course first, then plan its sections." : "This course isn't available to you.");
    if (!courseOutline(c.id).total) return toast("This course has no sections yet." + (c.owner_id === state.user.id ? " Add some in Edit course." : ""));
    state.plan = { courseId: c.id, start: lagosDate(), end: "", daysOff: new Set(), priority: "normal", assign: new Map(), remove: new Set(), ticked: new Set(), done: new Set(), range: ["", ""] };
    openDialog(`Plan sections · ${c.title}`, `<div id="planner-body"></div>`);
    renderPlannerBody();
  }
  function planDays() {
    const p = state.plan; const out = [];
    const end = p.end && p.end >= p.start ? p.end : addDays(p.start, 13);
    for (let d = p.start, i = 0; d <= end && i < 400; d = addDays(d, 1), i++) if (!p.daysOff.has(dayCode(d))) out.push(d);
    return out;
  }
  function planState(sectionId) {
    const p = state.plan, task = taskForSection(sectionId), isDone = !!(task && done(task.id));
    const date = p.remove.has(sectionId) ? "" : (p.assign.get(sectionId) ?? task?.scheduled_date ?? "");
    return { task, isDone, date, changed: p.assign.has(sectionId) && p.assign.get(sectionId) !== (task?.scheduled_date || ""), removing: p.remove.has(sectionId) };
  }
  function planCounts() {
    const counts = new Map();
    const outline = courseOutline(state.plan.courseId);
    const inCourse = new Set(outline.topics.flatMap(t => t.sections.map(x => x.section.id)));
    for (const t of activeTasks(state.user.id)) if (!(t.section_id && inCourse.has(t.section_id))) counts.set(t.scheduled_date, (counts.get(t.scheduled_date) || 0) + 1);
    for (const id of inCourse) { const s = planState(id); if (s.date) counts.set(s.date, (counts.get(s.date) || 0) + 1); }
    return counts;
  }
  function renderPlannerBody() {
    const p = state.plan; if (!p) return; const host = $("#planner-body"); if (!host) return;
    const list = host.querySelector(".plan-list"), scroll = list ? list.scrollTop : 0;
    const today = lagosDate(), outline = courseOutline(p.courseId), counts = planCounts(), days = planDays();
    const cap = Number(state.preferences?.daily_section_capacity) || null;
    const dayOpts = days.map(d => `<option value="${d}">${esc(weekdayName(d))}${d === today ? " (today)" : ""} · ${counts.get(d) || 0} planned</option>`).join("");
    const rows = outline.topics.map(({ topic, sections }) => {
      const selectable = sections.filter(x => !planState(x.section.id).isDone);
      const allTicked = selectable.length && selectable.every(x => p.ticked.has(x.section.id));
      return `<div class="plan-topic"><label class="check-line plan-topic-head"><input type="checkbox" data-plan-topic="${esc(topic.id)}" ${allTicked ? "checked" : ""} ${selectable.length ? "" : "disabled"}><strong>${esc(topic.title)}</strong><small>${plural(sections.length, "section")}</small></label>${sections.map(({ section, number }) => {
        const s = planState(section.id);
        const status = s.isDone ? `<span class="pill is-good">Done ${esc(formatDate(s.task.scheduled_date))}</span>` : s.removing ? `<span class="pill is-warn">Will be removed</span>` : s.changed ? `<span class="pill is-new">${s.task ? "Moving" : "New"}</span>` : s.task ? `<span class="pill">Planned</span>` : `<span class="pill is-muted">Not planned</span>`;
        const doneBox = !s.isDone && s.date && s.date <= today ? `<label class="check-line plan-done"><input type="checkbox" data-plan-done="${esc(section.id)}" ${p.done.has(section.id) ? "checked" : ""}> Already done</label>` : "";
        return `<div class="plan-row ${p.ticked.has(section.id) ? "is-ticked" : ""} ${s.isDone ? "is-done" : ""}"><label class="plan-pick"><input type="checkbox" data-plan-tick="${esc(section.id)}" ${p.ticked.has(section.id) ? "checked" : ""} ${s.isDone ? "disabled" : ""} aria-label="Tick section ${number}"><span class="sec-num">#${number}</span><span class="plan-title">${esc(section.title)}</span></label><div class="plan-controls">${status}${s.isDone ? "" : `<input type="date" value="${esc(s.date)}" data-plan-date="${esc(section.id)}" aria-label="Date for section ${number}">${s.task && !s.removing ? `<button type="button" class="text-button" data-action="plan-unplan" data-section="${esc(section.id)}">Remove</button>` : ""}${s.removing ? `<button type="button" class="text-button" data-action="plan-keep" data-section="${esc(section.id)}">Keep</button>` : ""}`}${doneBox}</div></div>`;
      }).join("")}</div>`;
    }).join("");
    const pending = [...p.assign].filter(([id, d]) => { const s = planState(id); return !s.isDone && d && d !== (s.task?.scheduled_date || ""); });
    const newCount = pending.filter(([id]) => !planState(id).task).length, moveCount = pending.length - newCount;
    const doneCount = [...p.done].filter(id => { const s = planState(id); return s.date && s.date <= today && !s.isDone; }).length;
    const affected = new Map(); for (const [, d] of pending) affected.set(d, (affected.get(d) || 0) + 1);
    const warnings = [];
    const past = pending.filter(([, d]) => d < today).length; if (past) warnings.push(`${plural(past, "section")} on a past date${doneCount ? "" : " — tick “Already done” if you finished them"}.`);
    if (p.end) { const beyond = pending.filter(([, d]) => d > p.end).length; if (beyond) warnings.push(`${plural(beyond, "section")} after your end date.`); }
    if (cap) { const over = [...affected.keys()].filter(d => (counts.get(d) || 0) > cap); if (over.length) warnings.push(`${plural(over.length, "day")} above your preferred ${cap} a day: ${over.slice(0, 4).map(d => `${weekdayName(d)} (${counts.get(d)})`).join(", ")}${over.length > 4 ? "…" : ""}.`); }
    const summary = [...affected].sort(([a], [b]) => a.localeCompare(b)).slice(0, 10).map(([d, n]) => `${weekdayName(d)}: ${n}`).join(" · ");
    const nothing = !pending.length && !p.remove.size && !doneCount;
    host.innerHTML = `<p class="callout">Tick any sections, in any order, then pick a day and tap <strong>Assign ticked</strong>, or set dates row by row. Nothing is saved until you tap <strong>Save plan</strong>.</p>
      <div class="field-grid plan-settings"><label>Start date<input type="date" data-plan-field="start" value="${esc(p.start)}"></label><label>End date (optional)<input type="date" data-plan-field="end" value="${esc(p.end)}"></label>${priorityField(p.priority).replace('name="priority"', 'name="priority" data-plan-field="priority"')}<fieldset class="form-section plan-daysoff"><legend>Days off</legend><div class="button-row">${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((n,i)=>`<label class="check-line"><input type="checkbox" data-plan-dayoff="${i}" ${p.daysOff.has(i) ? "checked" : ""}>${n}</label>`).join("")}</div></fieldset></div>
      <div class="plan-tools"><div class="button-row">${htmlButton("plan-tick-unplanned", "Tick all unplanned", "button button-quiet")}${htmlButton("plan-tick-none", "Clear ticks", "button button-quiet")}</div><div class="plan-range"><span>Tick from</span><input type="number" min="1" max="${outline.total}" value="${esc(p.range[0])}" data-plan-range="0" aria-label="From section number" placeholder="#">to<input type="number" min="1" max="${outline.total}" value="${esc(p.range[1])}" data-plan-range="1" aria-label="To section number" placeholder="#">${htmlButton("plan-tick-range", "Tick range", "button button-quiet")}</div><div class="button-row">${htmlButton("plan-spread", "Suggest a spread", "button button-secondary", p.ticked.size && days.length ? "" : "disabled")}${htmlButton("plan-clear-dates", "Clear dates of ticked", "button button-quiet", p.ticked.size ? "" : "disabled")}</div><p class="field-help">“Suggest a spread” shares the ticked sections evenly over your days${p.end ? " up to the end date" : `, ${cap || 2} a day (set an end date to fit them in)`}. You can change any date afterwards.</p></div>
      <div class="plan-assign"><strong class="plan-count">${p.ticked.size} ticked</strong><select id="plan-day" aria-label="Day to assign the ticked sections to">${dayOpts || `<option value="">No available days</option>`}</select>${htmlButton("plan-assign", "Assign", "button button-primary", p.ticked.size && days.length ? "" : "disabled")}</div>
      <div class="preview-list plan-list">${rows}</div>
      <div class="plan-review"><div class="plan-review-line"><strong>${nothing ? "No changes yet." : `${newCount} new · ${plural(moveCount, "move")}${p.remove.size ? ` · ${p.remove.size} to remove` : ""}${doneCount ? ` · ${doneCount} done` : ""}`}</strong>${summary ? `<details><summary>By day</summary><small>${esc(summary)}${affected.size > 10 ? " · …" : ""}</small></details>` : ""}</div>${warnings.map(w => `<p class="preview-warning">${esc(w)}</p>`).join("")}<div class="plan-review-actions"><button type="button" class="button button-quiet" data-action="close-dialog">Cancel</button><button type="button" class="button button-primary" data-action="plan-save" ${nothing ? "disabled" : ""}>Save plan</button></div></div>`;
    const nl = host.querySelector(".plan-list"); if (nl) nl.scrollTop = scroll;
  }
  function planOrderedTicked() {
    const outline = courseOutline(state.plan.courseId);
    return outline.topics.flatMap(t => t.sections).filter(x => state.plan.ticked.has(x.section.id)).map(x => x.section.id);
  }
  function planAction(action, el) {
    const p = state.plan; if (!p) return;
    const outline = courseOutline(p.courseId), all = outline.topics.flatMap(t => t.sections);
    if (action === "plan-tick-unplanned") all.forEach(x => { const s = planState(x.section.id); if (!s.isDone && !s.date) p.ticked.add(x.section.id); });
    else if (action === "plan-tick-none") p.ticked.clear();
    else if (action === "plan-tick-range") {
      const a = Number(p.range[0]), b = Number(p.range[1] || p.range[0]);
      if (!a || !b) return toast("Enter the first and last section numbers.");
      const lo = Math.min(a, b), hi = Math.max(a, b);
      all.filter(x => x.number >= lo && x.number <= hi && !planState(x.section.id).isDone).forEach(x => p.ticked.add(x.section.id));
    } else if (action === "plan-assign") {
      const day = $("#plan-day")?.value; if (!day) return toast("Choose a day first.");
      for (const id of p.ticked) if (!planState(id).isDone) { p.assign.set(id, day); p.remove.delete(id); }
      p.ticked.clear(); state.dialogDirty = true;
    } else if (action === "plan-spread") {
      const ids = planOrderedTicked().filter(id => !planState(id).isDone);
      const days = planDays(); if (!days.length) return toast("No available days. Change the start date, end date or days off.");
      let slots;
      if (p.end) {
        // Even spacing across the whole window: 22 sections over 10 days gives 2–3 a day; 5 over 30 days gives one every 6 days.
        slots = ids.map((_, i) => days[Math.floor(i * days.length / ids.length)]);
      } else {
        const per = Number(state.preferences?.daily_section_capacity) || 2; slots = [];
        for (let i = 0, day = p.start; slots.length < ids.length && i < 2000; i++, day = addDays(day, 1)) if (!p.daysOff.has(dayCode(day))) for (let k = 0; k < per; k++) slots.push(day);
      }
      ids.forEach((id, i) => { p.assign.set(id, slots[i]); p.remove.delete(id); });
      p.ticked.clear(); state.dialogDirty = true;
    } else if (action === "plan-clear-dates") {
      for (const id of p.ticked) { const s = planState(id); if (s.task) p.remove.add(id); p.assign.delete(id); p.done.delete(id); }
      p.ticked.clear(); state.dialogDirty = true;
    } else if (action === "plan-unplan") { p.remove.add(el.dataset.section); p.assign.delete(el.dataset.section); p.done.delete(el.dataset.section); state.dialogDirty = true; }
    else if (action === "plan-keep") p.remove.delete(el.dataset.section);
    renderPlannerBody();
  }
  function plannerInput(el) {
    const p = state.plan; if (!p) return false;
    if (el.dataset.planTick !== undefined) { el.checked ? p.ticked.add(el.dataset.planTick) : p.ticked.delete(el.dataset.planTick); }
    else if (el.dataset.planTopic !== undefined) {
      const ids = activeSections(el.dataset.planTopic).map(s => s.id).filter(id => !planState(id).isDone);
      ids.forEach(id => el.checked ? p.ticked.add(id) : p.ticked.delete(id));
    } else if (el.dataset.planDate !== undefined) {
      const id = el.dataset.planDate, s = planState(id);
      if (el.value) { p.assign.set(id, el.value); p.remove.delete(id); }
      else { p.assign.delete(id); if (s.task) p.remove.add(id); p.done.delete(id); }
      state.dialogDirty = true;
    } else if (el.dataset.planDone !== undefined) { el.checked ? p.done.add(el.dataset.planDone) : p.done.delete(el.dataset.planDone); state.dialogDirty = true; }
    else if (el.dataset.planDayoff !== undefined) { const d = Number(el.dataset.planDayoff); el.checked ? p.daysOff.add(d) : p.daysOff.delete(d); }
    else if (el.dataset.planField !== undefined) { if (el.dataset.planField === "start" && !el.value) return true; p[el.dataset.planField] = el.value; }
    else if (el.dataset.planRange !== undefined) { p.range[Number(el.dataset.planRange)] = el.value; return true; }
    else return false;
    renderPlannerBody(); return true;
  }
  async function savePlan() {
    const p = state.plan; if (!p) return;
    const today = lagosDate(), c = courseOf(p.courseId);
    const items = [], outline = courseOutline(p.courseId);
    for (const { section } of outline.topics.flatMap(t => t.sections)) {
      const s = planState(section.id); if (s.isDone || s.removing || !s.date) continue;
      const changed = p.assign.has(section.id) && p.assign.get(section.id) !== (s.task?.scheduled_date || "");
      const markDone = p.done.has(section.id) && s.date <= today;
      if (changed || markDone) items.push({ section_id: section.id, scheduled_date: s.date, mark_done: markDone });
    }
    const removals = [...p.remove].map(id => taskForSection(id)).filter(t => t && !done(t.id));
    if (!items.length && !removals.length) return toast("Nothing to save yet.");
    if (removals.length && !(await confirmed({ title: `Remove ${plural(removals.length, "planned section")}?`, message: "They will be taken off your schedule. Their history is kept and you can plan them again later.", confirmLabel: "Save and remove", danger: true }))) return;
    setStatus("Saving your plan…");
    try {
      let result = { created: 0, moved: 0, completed: 0 };
      if (items.length) {
        const r = await state.sb.rpc("plan_sections", { p_course_id: p.courseId, p_items: items, p_priority: p.priority, p_reason: `Planned sections · ${c?.title || "course"}` });
        if (r.error) throw r.error; result = r.data || result;
      }
      let removed = 0;
      for (const t of removals) {
        const r = await state.sb.rpc("update_task_instance", { p_task_id: t.id, p_task_title: t.task_title, p_scheduled_date: t.scheduled_date, p_deadline: t.deadline || null, p_priority: t.priority, p_status: "cancelled", p_reason: "Removed in Plan sections" });
        if (r.error) throw r.error; removed++;
      }
      setStatus(""); state.dialogDirty = false; closeDialog();
      toast([result.created ? `${result.created} planned` : "", result.moved ? `${result.moved} moved` : "", result.completed ? `${result.completed} marked done` : "", removed ? `${removed} removed` : ""].filter(Boolean).join(" · ") || "Plan saved.");
      await loadData({ quiet: true });
    } catch (e) { setStatus(""); toast(`Plan not saved: ${errorText(e)}`); }
  }

  /* ---------- the course editor (owner only) ---------- */
  function renderEditorBody() {
    const e = state.editor; if (!e) return; const host = $("#editor-body"); if (!host) return;
    let n = 0;
    const topicHtml = e.topics.map((t, ti) => `<div class="editor-topic"><div class="editor-topic-head"><input value="${esc(t.title)}" maxlength="160" placeholder="Topic title" data-ed-topic="${ti}" aria-label="Topic ${ti + 1} title"><div class="editor-moves">${htmlButton("ed-topic-up", "↑", "icon-button", `data-ti="${ti}" aria-label="Move topic up" ${ti ? "" : "disabled"}`)}${htmlButton("ed-topic-down", "↓", "icon-button", `data-ti="${ti}" aria-label="Move topic down" ${ti < e.topics.length - 1 ? "" : "disabled"}`)}${htmlButton("ed-topic-remove", "✕", "icon-button", `data-ti="${ti}" aria-label="Remove topic"`)}</div></div>${t.sections.map((s, si) => { const num = ++n; const first = ti === 0 && si === 0, last = ti === e.topics.length - 1 && si === t.sections.length - 1; return `<div class="editor-section"><span class="sec-num">#${num}</span><input value="${esc(s.title)}" maxlength="200" placeholder="Section title" data-ed-section="${ti}:${si}" aria-label="Section ${num} title"><div class="editor-moves">${htmlButton("ed-sec-up", "↑", "icon-button", `data-ti="${ti}" data-si="${si}" aria-label="Move section up" ${first ? "disabled" : ""}`)}${htmlButton("ed-sec-down", "↓", "icon-button", `data-ti="${ti}" data-si="${si}" aria-label="Move section down" ${last ? "disabled" : ""}`)}${htmlButton("ed-sec-remove", "✕", "icon-button", `data-ti="${ti}" data-si="${si}" aria-label="Remove section"`)}</div></div>`; }).join("")}<div class="editor-add"><input placeholder="New section title" maxlength="200" data-ed-new-section="${ti}" aria-label="New section in ${esc(t.title || "this topic")}">${htmlButton("ed-sec-add", "＋ Add section", "button button-quiet", `data-ti="${ti}"`)}</div></div>`).join("");
    const archived = e.archivedTopics.length || e.archivedSections.length ? `<details class="editor-archived"><summary>Archived material (${e.archivedTopics.length + e.archivedSections.length})</summary>${e.archivedTopics.map(t => `<div class="history-item"><span>Topic · ${esc(t.title)}</span>${htmlButton("ed-restore-topic", "Restore", "button button-quiet", `data-id="${esc(t.id)}"`)}</div>`).join("")}${e.archivedSections.map(s => `<div class="history-item"><span>Section · ${esc(s.title)}</span>${htmlButton("ed-restore-section", "Restore", "button button-quiet", `data-id="${esc(s.id)}"`)}</div>`).join("")}</details>` : "";
    host.innerHTML = `<div class="form-stack"><label>Course title<input data-ed-field="title" value="${esc(e.title)}" maxlength="120" required></label><label>Description (optional)<textarea data-ed-field="description" maxlength="4000" rows="3">${esc(e.description)}</textarea></label><fieldset class="form-section"><legend>Who can see this course?</legend><label class="check-line"><input type="radio" name="ed_visibility" value="private" ${e.visibility === "private" ? "checked" : ""}> Private · only me</label><label class="check-line"><input type="radio" name="ed_visibility" value="shared" ${e.visibility === "shared" ? "checked" : ""}> Shared · every member can see and join it</label></fieldset>
      <div class="section-heading"><div><h3>Topics and sections</h3><p>Numbers update as you reorder. Members' own dates and progress are never changed.</p></div></div>${topicHtml || `<p class="field-help">No topics yet. Add the first one below.</p>`}
      <div class="editor-add"><input placeholder="New topic title" maxlength="160" data-ed-new-topic value="${esc(e.newTopic)}" aria-label="New topic title">${htmlButton("ed-topic-add", "＋ Add topic", "button button-secondary")}</div>${archived}
      <div class="dialog-actions">${e.id ? htmlButton("archive-course", "Archive course", "button button-quiet", `data-course="${esc(e.id)}"`) : ""}<button type="button" class="button button-quiet" data-action="close-dialog">Cancel</button><button type="button" class="button button-primary" data-action="ed-save">${e.id ? "Save course" : "Create course"}</button></div></div>`;
  }
  function editorInput(el) {
    const e = state.editor; if (!e) return false;
    if (el.dataset.edField) e[el.dataset.edField] = el.value;
    else if (el.dataset.edTopic !== undefined) e.topics[Number(el.dataset.edTopic)].title = el.value;
    else if (el.dataset.edSection !== undefined) { const [ti, si] = el.dataset.edSection.split(":").map(Number); e.topics[ti].sections[si].title = el.value; }
    else if (el.name === "ed_visibility") e.visibility = el.value;
    else if (el.dataset.edNewTopic !== undefined) { e.newTopic = el.value; return true; }
    else if (el.dataset.edNewSection !== undefined) return true;
    else return false;
    state.dialogDirty = true; return true;
  }
  function editorAction(action, el) {
    const e = state.editor; if (!e) return;
    const ti = Number(el.dataset.ti), si = Number(el.dataset.si);
    if (action === "ed-topic-add") { const title = (e.newTopic || $("[data-ed-new-topic]")?.value || "").trim(); if (!title) return toast("Type the topic title first."); e.topics.push({ id: null, title, description: "", sections: [] }); e.newTopic = ""; }
    else if (action === "ed-sec-add") { const input = $(`[data-ed-new-section="${ti}"]`); const title = (input?.value || "").trim(); if (!title) return toast("Type the section title first."); e.topics[ti].sections.push({ id: null, title, description: "", source_reference: "", notes: "" }); }
    else if (action === "ed-topic-up" && ti > 0) [e.topics[ti - 1], e.topics[ti]] = [e.topics[ti], e.topics[ti - 1]];
    else if (action === "ed-topic-down" && ti < e.topics.length - 1) [e.topics[ti + 1], e.topics[ti]] = [e.topics[ti], e.topics[ti + 1]];
    else if (action === "ed-topic-remove") { const t = e.topics.splice(ti, 1)[0]; if (t.id) e.removedTopics++; e.removedSections += t.sections.filter(s => s.id).length; }
    else if (action === "ed-sec-remove") { const s = e.topics[ti].sections.splice(si, 1)[0]; if (s.id) e.removedSections++; }
    else if (action === "ed-sec-up" || action === "ed-sec-down") {
      const sec = e.topics[ti].sections[si];
      if (action === "ed-sec-up") {
        if (si > 0) [e.topics[ti].sections[si - 1], e.topics[ti].sections[si]] = [sec, e.topics[ti].sections[si - 1]];
        else if (ti > 0) { e.topics[ti].sections.splice(si, 1); e.topics[ti - 1].sections.push(sec); }
      } else {
        if (si < e.topics[ti].sections.length - 1) [e.topics[ti].sections[si + 1], e.topics[ti].sections[si]] = [sec, e.topics[ti].sections[si + 1]];
        else if (ti < e.topics.length - 1) { e.topics[ti].sections.splice(si, 1); e.topics[ti + 1].sections.unshift(sec); }
      }
    } else if (action === "ed-restore-topic") {
      const t = e.archivedTopics.find(x => x.id === el.dataset.id); if (!t) return;
      e.archivedTopics = e.archivedTopics.filter(x => x.id !== t.id);
      e.topics.push({ id: t.id, title: t.title, description: t.description || "", sections: [] });
    } else if (action === "ed-restore-section") {
      const s = e.archivedSections.find(x => x.id === el.dataset.id); if (!s) return;
      e.archivedSections = e.archivedSections.filter(x => x.id !== s.id);
      if (!e.topics.length) return toast("Add or restore a topic first.");
      const home = e.topics.find(t => t.id === s.topic_id) || e.topics[e.topics.length - 1];
      home.sections.push({ id: s.id, title: s.title, description: s.description || "", source_reference: s.source_reference || "", notes: s.notes || "" });
    } else return;
    state.dialogDirty = true; renderEditorBody();
  }
  async function saveEditor() {
    const e = state.editor; if (!e) return;
    const title = (e.title || "").trim();
    if (!title) return toast("Give the course a title.");
    if (!e.visibility) return toast("Choose whether the course is private or shared.");
    const empty = e.topics.findIndex(t => !String(t.title || "").trim()); if (empty >= 0) return toast(`Topic ${empty + 1} needs a title.`);
    for (const t of e.topics) if (t.sections.some(s => !String(s.title || "").trim())) return toast(`A section in “${t.title}” needs a title.`);
    const joined = e.id ? state.courseMemberships.filter(m => m.course_id === e.id && m.status === "active" && m.profile_id !== state.user.id).length : 0;
    const notes = [];
    if (e.originalVisibility === "shared" && e.visibility === "private") notes.push(`The course becomes private. ${joined ? `${plural(joined, "member")} who joined will no longer see it; their existing tasks stay with them.` : "No other member has joined it."}`);
    if (e.removedTopics || e.removedSections) notes.push(`${e.removedTopics ? `${plural(e.removedTopics, "topic")} and ` : ""}${plural(e.removedSections, "section")} will be archived. Existing tasks for them are kept, and you can restore them later.`);
    if (notes.length && !(await confirmed({ title: "Save these changes?", message: notes.join("\n\n"), confirmLabel: "Save course", danger: e.originalVisibility === "shared" && e.visibility === "private" }))) return;
    const topics = e.topics.map(t => ({ id: t.id, title: t.title.trim(), description: t.description || "", sections: t.sections.map(s => ({ id: s.id, title: s.title.trim(), description: s.description || "", source_reference: s.source_reference || "", notes: s.notes || "" })) }));
    const r = await state.sb.rpc("save_course_outline", { p_course_id: e.id, p_title: title, p_description: e.description || "", p_visibility: e.visibility, p_topics: topics });
    if (r.error) return toast(`Course not saved: ${errorText(r.error)}`);
    state.dialogDirty = false; closeDialog(); toast(e.id ? "Course saved. Section numbers are updated for everyone." : `Course created as ${e.visibility}.`); await loadData({ quiet: true });
  }
  function backlogFill(mode) {
    const inputs = $$("[data-backlog-date]"); const per = Number(state.preferences?.daily_section_capacity) || 2;
    inputs.forEach((el, i) => { el.value = mode === "today" ? lagosDate() : mode === "spread" ? addDays(lagosDate(), 1 + Math.floor(i / per)) : ""; });
    state.dialogDirty = mode !== "clear";
  }
  async function leaveCourse(courseId) {
    const course = courseOf(courseId); if (!course) return;
    const open = activeTasks(state.user.id).filter(t => t.course_id === courseId && !done(t.id)).length;
    const answer = await confirmBox({ title: `Leave “${course.title}”?`, message: `You can join again later in one tap.${open ? ` You have ${plural(open, "unfinished task")} from this course.` : ""}`, confirmLabel: "Leave course", danger: true, checkbox: open ? "Also remove my unfinished tasks from this course (completed ones are kept)" : "" });
    if (!answer.ok) return;
    const r = await state.sb.rpc("leave_course", { p_course_id: courseId, p_cancel_unfinished: answer.checked });
    if (r.error) return toast(`Could not leave: ${errorText(r.error)}`);
    if ($("#app-dialog")?.open) closeDialog();
    toast(answer.checked ? `Left the course and removed ${plural(r.data || 0, "task")}.` : "Left the course. Your tasks were kept."); await loadData({ quiet: true });
  }
  function openCloneDialog(courseId) {
    const c = courseOf(courseId); if (!c) return;
    openDialog("Make a private copy", `<form id="clone-form" data-course="${esc(c.id)}" class="form-stack"><p class="callout">This copies the topics and sections into a new private course that only you can edit. Nobody's schedule or progress is copied.</p><label>Name of the copy<input name="title" maxlength="120" value="${esc(`${c.title} · my copy`.slice(0, 120))}" required></label><button type="submit" class="button button-primary">Create private copy</button></form>`);
  }
  async function undoAnki(taskId) {
    if (!(await confirmed({ title: "Undo this Anki completion?", message: "The task is reopened. Your card count for that day is kept.", confirmLabel: "Undo completion" }))) return;
    const r = await state.sb.rpc("undo_anki_task", { p_task_id: taskId }); if (r.error) throw r.error;
    state.dialogDirty = false; closeDialog(); toast("Anki completion reopened; card history retained."); await loadData({ quiet: true });
  }
  function applyRealtime(table, payload) {
    const row = payload.new && Object.keys(payload.new).length ? payload.new : null, old = payload.old || {};
    const upsert = (list, r) => { const i = list.findIndex(x => x.id === r.id); if (i >= 0) list[i] = { ...list[i], ...r }; else list.push(r); };
    const memberIds = new Set(state.members.map(p => p.id));
    if (table === "task_instances") {
      if (payload.eventType === "DELETE") state.tasks = state.tasks.filter(t => t.id !== old.id);
      else if (row && memberIds.has(row.owner_id)) upsert(state.tasks, row);
    } else if (table === "task_completions") {
      if (payload.eventType === "DELETE") { for (const [k, c] of state.completions) if (c.id === old.id || k === old.task_id) state.completions.delete(k); }
      else if (row && memberIds.has(row.owner_id)) state.completions.set(row.task_id, row);
    } else if (table === "study_activity_events") {
      if (row) { const i = state.events.findIndex(e => e.id === row.id); if (row.retracted_at) { if (i >= 0) state.events.splice(i, 1); } else if (i >= 0) state.events[i] = row; else state.events.unshift(row); }
    } else if (table === "notifications") {
      if (row) { if (row.group_id && row.group_id !== currentGroupId()) return; const i = state.notifications.findIndex(n => n.id === row.id); if (i >= 0) state.notifications[i] = row; else state.notifications.unshift(row); }
    } else if (table === "course_sections") {
      if (row) { upsert(state.sections, row); state.outlineCache = new Map(); }
    }
    saveCache(); safeRender();
    clearTimeout(state.realtimeTimer);
    state.realtimeTimer = setTimeout(() => loadData({ quiet: true }), 20000);
  }
  async function afterSignIn() {
    if (!state.user) return;
    if (restoreCache()) { setStatus(""); renderApp(); }
    else renderApp();
    await loadData(); await startRealtime();
  }
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:" || state.swStarted) return;
    state.swStarted = true;
    const showBanner = () => { const banner = $("#update-banner"); if (!banner) return; banner.hidden = false; banner.onclick = () => { banner.textContent = "Refreshing…"; location.reload(); }; };
    navigator.serviceWorker.addEventListener("message", event => { if (event.data === "tetralogy-updated") showBanner(); });
    const start = () => {
      navigator.serviceWorker.register("sw.js").then(reg => { setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000); }).catch(() => { /* the app works without offline support */ });
    };
    if (document.readyState === "complete") start(); else window.addEventListener("load", start, { once: true });
  }
  document.addEventListener("click",async event=>{
    const tab=event.target.closest("[data-tab]");if(tab){if($("#app-dialog").open)closeDialog();state.tab=tab.dataset.tab;state.viewerId=state.viewerId||state.user.id;renderApp();window.scrollTo({top:0});if(state.tab==="notifications"&&state.notificationMode==="general")setReadState({activity:true});return;}
    const view=event.target.closest("[data-viewer]");if(view){state.viewerId=view.dataset.viewer;state.tab="dashboard";renderApp();return;}
    const authTab=event.target.closest("[data-auth-mode]");if(authTab){showAuth(authTab.dataset.authMode);return;}
    const nmode=event.target.closest("[data-notification-mode]");if(nmode){state.notificationMode=nmode.dataset.notificationMode;renderApp();if(state.notificationMode==="general")setReadState({activity:true});return;}
    const day=event.target.closest("[data-calendar-date]");if(day){state.selectedDate=day.dataset.calendarDate;state.calendarMonth=firstOfMonth(state.selectedDate);renderApp();return;}
    const actionEl=event.target.closest("[data-action]");if(!actionEl||actionEl.disabled)return;
    const action=actionEl.dataset.action;
    try {
      if(action.startsWith("plan-")&&action!=="plan-sections"){if(action==="plan-save")await savePlan();else planAction(action,actionEl);return;}
      if(action.startsWith("ed-")){if(action==="ed-save")await saveEditor();else editorAction(action,actionEl);return;}
      if(action==="theme-toggle"){applyTheme(state.theme==="dark"?"light":"dark");renderApp();}
      else if(action==="sign-out")await signOut();
      else if(action==="close-dialog")await requestCloseDialog();
      else if(action==="quick-task")openQuickTask();
      else if(action==="add-task-date")openQuickTask(actionEl.dataset.date||state.selectedDate);
      else if(action==="add-deadline")openDeadlineDialog();
      else if(action==="manage-deadlines")openDeadlineManager();
      else if(action==="remove-task")await removeTask(actionEl.dataset.task);
      else if(action==="clear-schedule")await clearCourseSchedule(actionEl.dataset.course);
      else if(action==="archive-course")await archiveCourse(actionEl.dataset.course);
      else if(action==="edit-deadline")openDeadlineEdit(actionEl.dataset.deadline);
      else if(action==="cancel-deadline")await setDeadlineActive(actionEl.dataset.deadline,false);
      else if(action==="reopen-deadline")await setDeadlineActive(actionEl.dataset.deadline,true);
      else if(action==="delete-deadline")await deleteDeadline(actionEl.dataset.deadline);
      else if(action==="claim-legacy")openClaimDialog();
      else if(action==="toggle-day"){const d=actionEl.dataset.date;state.openDays.has(d)?state.openDays.delete(d):state.openDays.add(d);renderApp();}
      else if(action==="toggle-task")await toggleTask(actionEl.dataset.task);
      else if(action==="toggle-earlier"){state.showEarlier=!state.showEarlier;renderApp();}
      else if(action==="open-calendar"){state.tab="calendar";renderApp();}
      else if(action==="calendar-prev"){state.calendarMonth=shiftMonth(state.calendarMonth,-1);renderApp();}
      else if(action==="calendar-next"){state.calendarMonth=shiftMonth(state.calendarMonth,1);renderApp();}
      else if(action==="calendar-today"){state.calendarMonth=firstOfMonth(lagosDate());state.selectedDate=lagosDate();renderApp();}
      else if(action==="open-import")openImportDialog();
      else if(action==="preview-import")previewImport();
      else if(action==="commit-import")await commitImport();
      else if(action==="copy-import-prompt"){try{await navigator.clipboard.writeText($("#import-prompt").value);toast("Prompt copied.");}catch{$("#import-prompt").select();toast("Select the prompt text and copy it.");}}
      else if(action==="create-course")openCourseEdit(null);
      else if(action==="plan-sections")openPlanner(actionEl.dataset.course);
      else if(action==="course-detail")openCourseDetail(actionEl.dataset.course);
      else if(action==="edit-course")openCourseEdit(actionEl.dataset.course);
      else if(action==="join-course")await joinCourse(actionEl.dataset.course);
      else if(action==="leave-course")await leaveCourse(actionEl.dataset.course);
      else if(action==="clone-course")openCloneDialog(actionEl.dataset.course);
      else if(action==="transfer-course")openCourseTransfer(actionEl.dataset.course);
      else if(action==="edit-task")openTaskEdit(actionEl.dataset.task);
      else if(action==="open-backlog")openBacklog();
      else if(action==="backlog-all-today")backlogFill("today");
      else if(action==="backlog-spread")backlogFill("spread");
      else if(action==="backlog-clear")backlogFill("clear");
      else if(action==="open-recurring")openRecurringDialog();
      else if(action==="edit-recurring")openRecurringEdit(actionEl.dataset.rule);
      else if(action==="pause-recurring")await manageRecurring(actionEl.dataset.rule,"pause");
      else if(action==="resume-recurring")await manageRecurring(actionEl.dataset.rule,"resume");
      else if(action==="stop-recurring")await manageRecurring(actionEl.dataset.rule,"stop");
      else if(action==="reset-password")await requestPasswordReset(state.user?.email);
      else if(action==="review-suggestion")openSuggestion(actionEl.dataset.notice);
      else if(action==="approve-suggestion")await acceptSuggestion(actionEl.dataset.notice);
      else if(action==="reject-suggestion"){await archiveNotification(actionEl.dataset.notice);state.dialogDirty=false;closeDialog();toast("Suggestion rejected; your schedule was left unchanged.");}
      else if(action==="read-notice"||action==="read-general-notice")await setReadState({noticeId:actionEl.dataset.notice});
      else if(action==="archive-notice")await archiveNotification(actionEl.dataset.notice);
      else if(action==="mark-all-read")await setReadState({all:true});
      else if(action==="export-json")exportJson();
      else if(action==="export-csv")exportCsv();
      else if(action==="restore-backup")openRestoreDialog();
      else if(action==="confirm-restore")await restoreBackup();
      else if(action==="leave-group")await membershipAction(false);
      else if(action==="rejoin")await membershipAction(true);
      else if(action==="undo-anki")await undoAnki(actionEl.dataset.task);
    }catch(e){toast(errorText(e));}
  });

  /* Custom… boxes, section lists that follow the course, and the "Already done" tick. */
  function syncFormHelpers(el) {
    const form = el.form || el.closest("form");
    if (el.matches("[data-custom-select]")) {
      const input = el.parentElement.querySelector(`[name="${el.dataset.customSelect}"]`);
      const custom = el.value === "custom" || el.value === "__custom";
      if (input) { input.hidden = !custom; if (custom) setTimeout(() => input.focus(), 30); }
    }
    if (el.matches("[data-section-source]") && form) {
      const wrap = form.querySelector("[data-section-wrap]"), sel = form.elements.section_id;
      const id = el.value && el.value !== "__custom" ? el.value : "";
      if (sel) sel.innerHTML = sectionOptions(id, "");
      if (wrap) wrap.hidden = !id;
    }
    if (form && (el.name === "scheduled_date" || el.name === "task_type")) {
      const wrap = form.querySelector("[data-done-wrap]");
      if (wrap) { const date = form.elements.scheduled_date?.value, anki = form.elements.task_type?.value === "anki"; wrap.hidden = !date || date > lagosDate() || anki; if (wrap.hidden) { const box = wrap.querySelector("input"); if (box) box.checked = false; } }
    }
  }
  document.addEventListener("change",event=>{
    const el=event.target;
    if(state.plan&&el.closest("#planner-body")&&plannerInput(el))return;
    if(state.editor&&el.closest("#editor-body")&&editorInput(el))return;
    if(el.matches("[data-custom-select],[data-section-source],[name='scheduled_date'],[name='task_type']"))syncFormHelpers(el);
    const choice=el.closest("[data-import-choice]");if(choice){state.importChoices[choice.dataset.importChoice]=choice.value;previewImport();return;}
    const rename=el.closest("[data-import-rename]");if(rename){state.importChoices[rename.dataset.importRename+":name"]=rename.value;return;}
    if(el.id==="import-destination"){state.importDestination=el.value;const vis=$("#import-visibility-wrap");if(vis)vis.hidden=el.value!=="new";if(state.importDraft)previewImport();return;}
    if(el.matches("#restore-form input[type=file]")){parseRestoreFile(el.form);return;}
  });
  document.addEventListener("input",event=>{
    const el=event.target;
    if(state.editor&&el.closest("#editor-body")){editorInput(el);return;}
    if(state.plan&&el.closest("#planner-body")&&el.dataset.planRange!==undefined){state.plan.range[Number(el.dataset.planRange)]=el.value;}
  });
  document.addEventListener("submit",async event=>{
    const form=event.target;if(!(form instanceof HTMLFormElement))return;
    event.preventDefault();
    const button=event.submitter;if(button){if(button.dataset.busy)return;button.dataset.busy="1";}
    try {
      if(form.id==="login-form")await handleLogin(form);
      else if(form.id==="register-form")await handleRegistration(form);
      else if(form.id==="new-password-form")await handleNewPassword(form);
      else if(form.id==="claim-form")await claimLegacy(form);
      else if(form.id==="quick-task-form")await createQuickTask(form);
      else if(form.id==="deadline-form")await saveDeadline(form);
      else if(form.id==="deadline-edit-form")await saveDeadlineEdit(form);
      else if(form.id==="backlog-form")await addTaskDate(form);
      else if(form.id==="anki-log-form")await submitAnki(form,event.submitter?.value==="true");
      else if(form.id==="profile-form")await saveProfile(form);
      else if(form.id==="preferences-form")await savePreferences(form);
      else if(form.id==="anki-target-form")await saveTarget(form);
      else if(form.id==="recurring-form")await createRecurring(form);
      else if(form.id==="edit-recurring-form")await saveRecurringEdit(form);
      else if(form.id==="transfer-course-form")await transferCourse(form);
      else if(form.id==="clone-form")await cloneCourse(form);
      else if(form.id==="edit-task-form")await saveTaskEdit(form);
      else if(form.id==="restore-form")await parseRestoreFile(form);
    }catch(e){toast(errorText(e));}
    finally{if(button)delete button.dataset.busy;}
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
    const boot=$("#boot-card");
    registerServiceWorker();
    if(!url||!key||!window.supabase?.createClient){if(boot)boot.hidden=true;showAuth();setAuthFeedback("The app could not reach its database library. Check your connection and reload.","error");return;}
    state.sb=window.supabase.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:"pkce"},realtime:{params:{eventsPerSecond:10}}});
    const flow=exposePasswordSetupIfNeeded();
    const {data,error}=await state.sb.auth.getSession();
    if(boot)boot.hidden=true;
    if(error){showAuth();setAuthFeedback(errorText(error),"error");return;}
    if(data.session){state.user=data.session.user;state.viewerId=state.user.id;if(state.passwordSetupRequired)passwordRecoveryScreen();else await afterSignIn();}
    else if(flow==="invite"||flow==="recovery")passwordRecoveryScreen();
    else {showAuth("login");if(flow==="signup")setAuthFeedback("Email verified. Sign in with the password you chose.","success");}
    state.sb.auth.onAuthStateChange((event,session)=>{
      if(event==="PASSWORD_RECOVERY"){passwordRecoveryScreen();return;}
      if(state.passwordSetupRequired){if(session?.user){state.user=session.user;state.viewerId=state.user.id;}passwordRecoveryScreen();return;}
      if(event==="SIGNED_OUT"){disposeRealtime();state.user=null;state.loaded=false;state.fromCache=false;showAuth("login");headerActions();return;}
      // Token refreshes and focus events re-announce the same user: ignore them (no reload, no theme reset).
      if(session?.user&&(!state.user||state.user.id!==session.user.id)){state.user=session.user;state.viewerId=state.user.id;state.loaded=false;setTimeout(afterSignIn,0);}
      else if(session?.user)state.user=session.user;
    });
    window.addEventListener("online",()=>{if(state.user){setStatus("Back online. Refreshing shared data…","success");loadData({quiet:true}).then(startRealtime);}});
    window.addEventListener("offline",()=>{if(state.user)setStatus("Offline — study data is read-only. Unsaved changes are not queued.","error");});
    document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&state.user&&navigator.onLine&&Date.now()-(state.lastLoad||0)>60000)loadData({quiet:true});});
    $$("[data-action='forgot-password']").forEach(b=>b.addEventListener("click",()=>requestPasswordReset()));
    const dlg=$("#app-dialog");
    dlg.addEventListener("cancel",e=>{e.preventDefault();requestCloseDialog();});
    dlg.addEventListener("close",()=>setTimeout(flushRender,0));
    $("#dialog-content").addEventListener("input",()=>{state.dialogDirty=true;});
    document.addEventListener("focusout",()=>setTimeout(flushRender,300));
  }
  document.addEventListener("DOMContentLoaded",initialize,{once:true});
})();
