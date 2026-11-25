"use strict";

const sessions = window.WAW_SESSIONS.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
const { days, picks, breaks, details } = window.WAW_ROUTE;
const byId = new Map(sessions.map(session => [session.id, session]));
const recommended = new Set(picks);
const storageKey = "wawtech-2026-organizer-v1";
const warsawDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit"
});
const warsawTime = new Intl.DateTimeFormat("uk-UA", {
  timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});
const $ = id => document.getElementById(id);
const dialog = $("dialog");
const importFile = $("import-file");
const emptyPlan = () => ({ saved: [], notes: {}, recap: "" });
const safe = value => String(value ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const normalize = value => value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[’']/g, "");
const dayString = day => `2026-11-${day}`;
const officialAgenda = "https://wawtech.io/2026/agenda";
const faq = "https://wawtech.io/2026/faq";
const shortStages = { MAIN: "Main", ENGINEERING: "Engineering", GROWTH: "Growth", STUDIO: "Studio" };
const gridScale = 4.6;
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const timeLabel = minute => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

let selectedDay = warsawDate.format(new Date()) === dayString(27) ? 27 : 26;
let view = "route";
let plan = readPlan();
let toastTimer;
let activeDialog;
let dialogTrigger;

function cleanPlan(value) {
  if (!value || !Array.isArray(value.saved)) throw new Error("Invalid plan");
  const saved = [...new Set(value.saved.filter(id => byId.has(id)))];
  const notes = Object.fromEntries(
    Object.entries(value.notes ?? {}).filter(([id, note]) => byId.has(id) && typeof note === "string")
      .map(([id, note]) => [id, note.slice(0, 4000)])
  );
  return { saved, notes, recap: typeof value.recap === "string" ? value.recap.slice(0, 6000) : "" };
}

function readPlan() {
  try {
    const value = localStorage.getItem(storageKey);
    return value ? cleanPlan(JSON.parse(value)) : emptyPlan();
  } catch {
    $("storage-alert").hidden = false;
    return emptyPlan();
  }
}

function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(plan));
    $("storage-alert").hidden = true;
    return true;
  } catch {
    $("storage-alert").hidden = false;
    return false;
  }
}

function announce(message) {
  $("toast").textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").textContent = ""; }, 3200);
}

function overlaps(a, b) {
  return a.id !== b.id && a.day === b.day && a.start < b.end && b.start < a.end;
}

function clock(session) {
  return `<span class="time">${session.start}–${session.end}</span>`;
}

function stageBadge(session) {
  return `<span class="stage" data-stage="${session.stage}">${shortStages[session.stage]}</span>`;
}

function button(action, label, className = "secondary", attrs = "") {
  return `<button type="button" class="${className}" data-action="${action}" ${attrs}>${label}</button>`;
}

function sessionCard(session) {
  const { id, title, people, stage, tags } = session;
  const saved = plan.saved.includes(id);
  const clashes = plan.saved.filter(other => overlaps(session, byId.get(other)));
  const selected = recommended.has(id);
  const info = details[id];
  const format = session.format || (tags.includes("Воркшоп") ? "Воркшоп. Умови участі уточни на місці." : "");
  const alternatives = view === "route" && sessions.some(other => details[other.id] && overlaps(session, other));
  return `<article class="card" id="card-${id}" data-stage="${stage}">
    <div class="card-top">
      <div class="card-meta">${clock(session)} ${stageBadge(session)}</div>
      <button class="save" type="button" data-action="save" data-id="${id}" aria-pressed="${saved}"
        aria-label="${saved ? "Прибрати з мого плану" : "Зберегти в мій план"}: ${safe(title)}" title="${saved ? "Прибрати" : "Зберегти"}">${saved ? "★" : "☆"}</button>
    </div>
    <h3>${safe(title)}</h3>
    ${people.length ? `<p class="people">${people.map(p => safe(p.name) + (p.moderator ? " (модератор)" : "")).join(" · ")}</p>` : ""}
    ${view === "route" && info ? `<p class="reason">${safe(info[0])}</p>` : ""}
    ${format ? `<p class="small-status">${safe(format)}</p>` : ""}
    ${clashes.length ? `<p class="alert">Перетин із розкладом: ${clashes.map(other => safe(byId.get(other).title)).join(", ")}</p>` : ""}
    <div class="card-bottom">
      ${button("details", "Деталі й нотатки", "link-button", `data-id="${id}"`)}
      ${alternatives ? button("alternatives", "Паралельні", "link-button", `data-id="${id}"`) : ""}
      ${view !== "route" && selected ? '<span class="eyebrow">У маршруті Odoo</span>' : ""}
    </div>
  </article>`;
}

function breakCard(slot) {
  return `<article class="card break">
    ${clock(slot)}<h3>${safe(slot.title)}</h3><p>${safe(slot.description)}</p>
  </article>`;
}

function timeStatus() {
  const now = new Date();
  const date = warsawDate.format(now);
  const day = Number(date.slice(-2));
  const time = warsawTime.format(now);
  const isConference = warsawDate.format(now) === dayString(26) || warsawDate.format(now) === dayString(27);
  return { date, day, time, isConference };
}

function updateEventStatus() {
  const now = timeStatus();
  if (!now.isConference) return;
  const pool = view === "mine" && plan.saved.length ? sessions.filter(s => plan.saved.includes(s.id)) :
    sessions.filter(s => recommended.has(s.id));
  const current = pool.find(s => s.day === now.day && s.start <= now.time && s.end > now.time);
  const next = pool.find(s => s.day === now.day && s.start > now.time);
  const show = current || next;
  const content = show ? button("jump", `${current ? "Зараз" : "Далі"} · ${show.start} · ${shortStages[show.stage]} · ${safe(show.title)}`,
    "", `data-id="${show.id}"`) : "Час Варшави · EXPO XXI";
  if ($("event-status").innerHTML !== content && document.activeElement?.parentElement !== $("event-status")) {
    $("event-status").innerHTML = content;
  }
}

function viewHeading() {
  if (view === "route") return `<p class="eyebrow">Маршрут Odoo + AI</p><h2>${days[selectedDay].title}</h2><p>${days[selectedDay].description}</p>
    <div class="actions">${button("add-day", "Зберегти маршрут дня", "primary")}${button("guide", "Чекліст на два дні")}</div>`;
  if (view === "agenda") return '<h2>Усі виступи</h2><p>Чотири сцени · місцевий час Варшави.</p>';
  return `<h2>Мій план</h2><p>Розклад і нотатки зберігаються в цьому браузері.</p>
    <div class="actions">${button("view", "Додати виступи", "primary", 'data-view="agenda"')}
    ${button("guide", "Підсумки й нотатки")}${button("export", "Експорт плану")}${button("import", "Імпорт")}</div>`;
}

function filteredSessions() {
  const query = normalize($("query").value.trim()).split(/\s+/).filter(Boolean);
  const stage = $("stage").value;
  const topic = $("topic").value;
  const remaining = $("remaining").checked;
  const now = timeStatus();
  return sessions.filter(s => {
    if (s.day !== selectedDay || (stage && stage !== s.stage) || (topic && !s.tags.includes(topic))) return false;
    if (remaining && (now.date > dayString(s.day) || (now.date === dayString(s.day) && s.end <= now.time))) return false;
    const haystack = normalize([s.title, s.stage, ...s.tags, ...s.people.flatMap(p => [p.name, p.role]), ...(details[s.id] ?? [])].join(" "));
    return query.every(term => haystack.includes(term));
  });
}

function agendaGrid(items) {
  const day = sessions.filter(s => s.day === selectedDay);
  const from = Math.floor(minutes(day[0].start) / 30) * 30;
  const until = Math.ceil(Math.max(...day.map(s => minutes(s.end))) / 30) * 30;
  const stages = $("stage").value ? [$("stage").value] : Object.keys(shortStages);
  const ticks = Array.from({ length: (until - from) / 30 + 1 }, (_, index) => from + index * 30);
  return `<div class="grid-tools">
    <p class="muted" role="status">Виступів: ${items.length}${items.length ? "" : " · зміни фільтри"}</p>
    ${button("grid-now", "До поточного часу", "secondary", "id=grid-now hidden")}
  </div>
  ${stages.length > 1 ? '<p class="grid-hint">Гортай убік, щоб побачити інші сцени.</p>' : ""}
  <div class="agenda-scroll" id="agenda-scroll" tabindex="0" role="region" aria-label="Сітка виступів">
    <div class="agenda-board" data-from="${from}" data-until="${until}" style="--columns:${stages.length};--day-height:${(until - from) * gridScale + 18}px">
      <div class="agenda-heading agenda-corner">Час</div>
      ${stages.map(stage => `<div class="agenda-heading agenda-stage" data-stage="${stage}">${shortStages[stage]}</div>`).join("")}
      <div class="agenda-axis" aria-hidden="true">
        ${ticks.map(tick => `<span class="agenda-tick" style="top:${(tick - from) * gridScale}px">${timeLabel(tick)}</span>`).join("")}
        <span class="agenda-now-label" hidden></span>
      </div>
      ${stages.map(stage => `<section class="agenda-lane" aria-label="${shortStages[stage]}" data-stage="${stage}">
        ${items.filter(s => s.stage === stage).map(s => gridSession(s, from)).join("")}
        <div class="agenda-now-line" aria-hidden="true" hidden></div>
      </section>`).join("")}
    </div>
  </div>`;
}

function gridSession(session, from) {
  const { id, title, start, end, people } = session;
  const saved = plan.saved.includes(id);
  const clash = plan.saved.some(other => overlaps(session, byId.get(other)));
  return `<article class="grid-session" id="card-${id}" data-id="${id}"
    style="top:${(minutes(start) - from) * gridScale}px;height:${(minutes(end) - minutes(start)) * gridScale}px">
    <button type="button" class="grid-session-info" data-action="details" data-id="${id}">
      <span class="grid-slot">${start}–${end}<span class="grid-live" hidden>Йде</span></span>
      <strong>${safe(title)}</strong>
      <span class="grid-people">${safe(people.map(person => person.name).join(", "))}</span>
      ${clash ? '<span class="grid-clash">Перетин із планом</span>' : ""}
    </button>
    <button type="button" class="save grid-save" data-action="save" data-id="${id}" aria-pressed="${saved}"
      aria-label="${saved ? "Прибрати з плану" : "Зберегти в план"}: ${safe(title)}">${saved ? "★" : "☆"}</button>
  </article>`;
}

function showFilteredAgenda() {
  renderList();
  const scroll = $("agenda-scroll");
  if (!scroll) return;
  const first = filteredSessions()[0];
  scroll.scrollTop = first ? Math.max(0, (minutes(first.start) - Number(scroll.firstElementChild.dataset.from)) * gridScale - 28) : 0;
  scroll.scrollLeft = 0;
}

function updateAgendaClock() {
  const board = document.querySelector(".agenda-board");
  if (!board) return;
  const now = timeStatus();
  const minute = minutes(now.time);
  const today = now.isConference && now.day === selectedDay;
  const visible = today && minute >= Number(board.dataset.from) && minute <= Number(board.dataset.until);
  board.style.setProperty("--now-top", `${(minute - Number(board.dataset.from)) * gridScale}px`);
  $("grid-now").hidden = !visible;
  for (const marker of board.querySelectorAll(".agenda-now-label, .agenda-now-line")) marker.hidden = !visible;
  board.querySelector(".agenda-now-label").textContent = now.time;
  for (const card of board.querySelectorAll(".grid-session")) {
    const session = byId.get(card.dataset.id);
    const live = today && session.start <= now.time && now.time < session.end;
    card.classList.toggle("is-live", live);
    card.classList.toggle("is-past", now.date > dayString(selectedDay) || (today && session.end <= now.time));
    card.querySelector(".grid-live").hidden = !live;
  }
}

function renderList() {
  const todays = sessions.filter(s => s.day === selectedDay);
  let items;
  if (view === "route") {
    items = [...todays.filter(s => recommended.has(s.id)), ...breaks.filter(b => b.day === selectedDay)]
      .sort((a, b) => a.start.localeCompare(b.start));
  } else if (view === "mine") {
    items = todays.filter(s => plan.saved.includes(s.id));
  } else {
    const oldGrid = $("agenda-scroll");
    const position = oldGrid ? [oldGrid.scrollLeft, oldGrid.scrollTop] : null;
    $("list").innerHTML = agendaGrid(filteredSessions());
    if (position) $("agenda-scroll").scrollTo(...position);
    updateAgendaClock();
    return;
  }
  const empty = view === "mine" ? "У плані цього дня ще порожньо. Познач зірочкою виступ, який хочеш відвідати." :
    "Виступів за цими фільтрами немає. Спробуй іншу тему чи сцену.";
  $("list").innerHTML = items.length ? items.map(item => item.id ? sessionCard(item) : breakCard(item)).join("") :
    `<p class="empty">${empty}</p>`;
}

function render() {
  for (const tab of document.querySelectorAll(".tabbar button")) {
    if (tab.dataset.view === view) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  for (const day of $("day-picker").querySelectorAll("button")) {
    day.setAttribute("aria-pressed", String(Number(day.dataset.day) === selectedDay));
  }
  $("saved-count").textContent = plan.saved.length || "";
  $("view-head").className = "view-head";
  const heading = viewHeading();
  if ($("view-head").innerHTML !== heading) $("view-head").innerHTML = heading;
  $("main").classList.toggle("agenda-mode", view === "agenda");
  $("filters").hidden = view !== "agenda";
  renderList();
  updateEventStatus();
}

function showView(next, { scroll = true } = {}) {
  view = next;
  render();
  if (scroll) $("main").scrollIntoView({ block: "start" });
}

function showDialog(kind, id) {
  if (!dialog.open) dialogTrigger = document.activeElement;
  activeDialog = { kind, id };
  renderDialog();
  if (!dialog.open) dialog.showModal();
  else dialog.querySelector("[data-action=close]").focus();
  dialog.scrollTop = 0;
}

function calendarLink(s) {
  const stamp = time => `202611${s.day}T${time.replace(":", "")}00`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: s.title,
    dates: `${stamp(s.start)}/${stamp(s.end)}`,
    ctz: "Europe/Warsaw",
    location: `${shortStages[s.stage]}, EXPO XXI Warsaw, Prądzyńskiego 12/14`,
    details: `WAWTech 2026 · ${s.people.map(p => p.name).join(", ")}\n${officialAgenda}`
  });
  return safe(`https://calendar.google.com/calendar/render?${params}`);
}

function detailsDialog(session) {
  const [summary, takeaway, question] = details[session.id] ?? [];
  const saved = plan.saved.includes(session.id);
  const people = session.people.map(p => `<li><strong>${safe(p.name)}</strong>${p.moderator ? " · модератор" : ""}
    ${p.role ? `<p class="muted">${safe(p.role)}</p>` : ""}${p.bio ? `<p>${safe(p.bio)} <a href="${safe(p.url)}">Джерело</a></p>` : ""}</li>`);
  return `<div class="card-meta"><span class="eyebrow">${session.day} листопада</span> ${clock(session)} ${stageBadge(session)}</div>
    <h2 id="dialog-title">${safe(session.title)}</h2>
    ${summary ? `<p>${safe(summary)}</p>` : ""}
    ${session.format ? `<p class="notice">${safe(session.format)}</p>` : ""}
    ${people.length ? `<h3>Спікери</h3><ul>${people.join("")}</ul>` : ""}
    ${takeaway ? `<h3>Що забрати для своєї роботи</h3><p>${safe(takeaway)}</p>` : ""}
    ${question ? `<h3>Запитання до спікера</h3><p>${safe(question)}</p>` : ""}
    <label for="session-note">Моя нотатка</label><textarea id="session-note" data-note="${session.id}" rows="3" maxlength="4000"
      placeholder="Ідея, приклад, метрика або посилання">${safe(plan.notes[session.id])}</textarea>
    <div class="actions">
      ${button("save", saved ? "Прибрати з плану" : "Зберегти в план", "primary", `data-id="${session.id}" data-dialog-save`)}
      <a class="secondary" href="${calendarLink(session)}">Google Календар</a>
      <a class="secondary" href="${officialAgenda}">Офіційна програма</a>
    </div>`;
}

function alternativesDialog(session) {
  const parallel = sessions.filter(other => overlaps(session, other));
  return `<h2 id="dialog-title">Паралельні виступи</h2><p>${safe(session.title)} · ${clock(session)}.</p>
    <ul>${parallel.sort((a, b) => Number(Boolean(details[b.id])) - Number(Boolean(details[a.id]))).map(other =>
      `<li>${clock(other)} ${stageBadge(other)}
        ${button("details", safe(other.title), "link-button", `data-id="${other.id}"`)}
        ${details[other.id] ? `<p class="muted">${safe(details[other.id][0])}</p>` : ""}</li>`).join("")}</ul>`;
}

function venueDialog() {
  return `<h2 id="dialog-title">EXPO XXI Warsaw</h2>
    <p>Prądzyńskiego 12/14, 01-222 Warszawa</p>
    <p>26–27 листопада 2026. Усі години в застосунку — за Варшавою.</p>
    <div class="actions">
      <a class="primary" href="https://www.google.com/maps/search/?api=1&amp;query=EXPO%20XXI%20Warsaw%20Pr%C4%85dzy%C5%84skiego%2012%2F14">Відкрити карту</a>
      <a class="secondary" href="${faq}">FAQ конференції</a>
    </div>
    <h3>На місці</h3>
    <p>Назви сцен у картках відповідають програмі організаторів. На вході знайди схему залів або спитай волонтера, де Main, Engineering, Growth і Studio.</p>
    <p>Заклади 5–10 хвилин на перехід. Тримай QR квитка під рукою та візьми посвідчення особи для реєстрації.</p>`;
}

function guideDialog() {
  return `<h2 id="dialog-title">Що забрати з WAWTech</h2>
    <ol>
      <li><strong>Один сценарій пілота.</strong> Наприклад, чернетка відповіді в Odoo Helpdesk. Випиши подію, типові винятки й власника процесу.</li>
      <li><strong>Одна метрика.</strong> Зафіксуй базовий час на тікет, критерій якості чернетки й допустимий рівень виправлень.</li>
      <li><strong>План безпечного запуску.</strong> Обмеж права агента, підтверджуй зовнішні дії, підготуй evals і перевір аварійне вимкнення.</li>
      <li><strong>Два контакти й два ресурси.</strong> На Expo або після виступу попроси приклад, шаблон чи посилання на попередню доповідь.</li>
    </ol>
    <h3>Як використати телефон</h3>
    <p>На практичному воркшопі дивись демо й попроси матеріали для повторення вдома. Якщо відвідуєш виступи, що збігаються, обери один повністю. За FAQ записи основної програми доступні з квитками PRO та MAX, а вибрані записи можуть стати публічними пізніше.</p>
    <label for="recap">Мій підсумок і наступні кроки</label>
    <textarea id="recap" data-recap rows="5" maxlength="6000" placeholder="Сценарій · метрика · перевірки · контакти">${safe(plan.recap)}</textarea>
    <div class="actions">${button("export", "Експортувати план і нотатки", "primary")} <a class="secondary" href="${faq}">FAQ і записи</a></div>`;
}

function renderDialog() {
  const { kind, id } = activeDialog;
  const bodies = { details: detailsDialog, alternatives: alternativesDialog, venue: venueDialog, guide: guideDialog };
  $("dialog-body").innerHTML = bodies[kind](byId.get(id));
}

function toggleSave(id, target) {
  const saved = plan.saved.includes(id);
  plan.saved = saved ? plan.saved.filter(other => other !== id) : [...plan.saved, id];
  const ok = persist();
  render();
  if (target.hasAttribute("data-dialog-save")) {
    target.textContent = saved ? "Зберегти в план" : "Прибрати з плану";
  } else {
    (document.querySelector(`#card-${id} .save`) ?? $("view-head").querySelector("button"))?.focus({ preventScroll: true });
  }
  if (ok) announce(saved ? "Виступ прибрано з плану" : "Виступ збережено");
}

function addDay() {
  const todays = picks.filter(id => byId.get(id).day === selectedDay);
  const missing = todays.filter(id => !plan.saved.includes(id));
  const compatible = missing.filter(id => !plan.saved.some(other => overlaps(byId.get(id), byId.get(other))));
  plan.saved = [...plan.saved, ...compatible];
  const ok = persist();
  render();
  if (!ok) return;
  const skipped = missing.length - compatible.length;
  announce(skipped ? `Додано: ${compatible.length}. Пропущено через перетини: ${skipped}.` :
    compatible.length ? `Додано виступів: ${compatible.length}` : "Цей маршрут уже в твоєму плані");
}

function exportPlan() {
  const data = JSON.stringify({ version: 1, ...plan }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "wawtech-2026-plan.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importPlan() {
  const file = importFile.files[0];
  if (!file) return;
  try {
    if (file.size > 2000000) throw new Error("Too large");
    const raw = JSON.parse(await file.text());
    if (raw.version !== 1) throw new Error("Unsupported format");
    const incoming = cleanPlan(raw);
    const extraNotes = Object.fromEntries(Object.entries(incoming.notes).filter(([id]) => !plan.notes[id]));
    plan = {
      saved: [...new Set([...plan.saved, ...incoming.saved])],
      notes: { ...plan.notes, ...extraNotes },
      recap: plan.recap || incoming.recap
    };
    const ok = persist();
    showView("mine");
    if (ok) announce("Дані з файлу додано до твого плану");
  } catch {
    announce("Не вдалося прочитати файл. Вибери JSON, експортований із планувальника.");
  } finally {
    importFile.value = "";
  }
}

document.addEventListener("click", event => {
  const target = event.target.closest("button[data-action]");
  if (!target) return;
  const { action, id } = target.dataset;
  if (action === "day") {
    selectedDay = Number(target.dataset.day);
    render();
    $("agenda-scroll")?.scrollTo(0, 0);
  } else if (action === "view") {
    showView(target.dataset.view);
  } else if (action === "jump") {
    selectedDay = byId.get(id).day;
    if (view === "agenda") {
      $("query").value = "";
      $("stage").value = "";
      $("topic").value = "";
      $("remaining").checked = false;
    }
    showView(view === "mine" && !plan.saved.includes(id) ? "route" : view, { scroll: false });
    $("card-" + id)?.scrollIntoView({ block: "start", inline: "center" });
  } else if (action === "grid-now") {
    const board = document.querySelector(".agenda-board");
    if (board) $("agenda-scroll").scrollTop = Math.max(0, (minutes(timeStatus().time) - Number(board.dataset.from)) * gridScale - 100);
  } else if (["details", "alternatives", "venue", "guide"].includes(action)) {
    showDialog(action, id);
  } else if (action === "close") {
    dialog.close();
  } else if (action === "save") {
    toggleSave(id, target);
  } else if (action === "add-day") {
    addDay();
  } else if (action === "export") {
    exportPlan();
  } else if (action === "import") {
    importFile.click();
  }
});

dialog.addEventListener("close", () => {
  if (dialogTrigger?.isConnected) dialogTrigger.focus({ preventScroll: true });
  else if (activeDialog?.id) document.querySelector(`#card-${activeDialog.id} [data-action=details]`)?.focus({ preventScroll: true });
  dialogTrigger = null;
  activeDialog = null;
});

dialog.addEventListener("input", event => {
  const { note, recap } = event.target.dataset;
  if (note) plan.notes[note] = event.target.value;
  else if (recap !== undefined) plan.recap = event.target.value;
  else return;
  persist();
});

for (const tag of [...new Set(sessions.flatMap(s => s.tags))].sort((a, b) => a.localeCompare(b, "uk"))) {
  $("topic").add(new Option(tag, tag));
}
$("query").addEventListener("input", showFilteredAgenda);
for (const id of ["stage", "topic", "remaining"]) $(id).addEventListener("change", showFilteredAgenda);
importFile.addEventListener("change", importPlan);
render();
setInterval(() => {
  updateEventStatus();
  updateAgendaClock();
  if (view === "agenda" && $("remaining").checked && !dialog.open && !$("list").contains(document.activeElement)) renderList();
}, 30000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  updateEventStatus();
  updateAgendaClock();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").then(() => navigator.serviceWorker.ready).then(() => {
    $("offline-status").textContent = "Розклад готовий до перегляду офлайн на цьому пристрої.";
  }).catch(() => {
    $("offline-status").textContent = "Офлайн-режим недоступний у цьому браузері.";
  });
}
