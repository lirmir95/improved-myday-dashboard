(() => {
  "use strict";

  const DAY_KEY = "myday_v5";
  const PROJECT_KEY = "my_project_dashboard_v1";
  const HEALTH_KEY = "still_health_v2";
  const SETTINGS_KEY = "still_day_settings_v2";
  const API_OVERRIDE_KEY = "myday_notion_api_base_v1";

  const today = () => new Date().toISOString().slice(0, 10);
  const currentMonth = () => today().slice(0, 7);
  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
  const num = (value) => Number(String(value ?? "").replace(/,/g, "")) || 0;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const format = (value, digits = 0) => Number(value || 0).toLocaleString("ko-KR", {
    maximumFractionDigits: digits
  });
  const dateLabel = (date) => new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short"
  }).format(new Date(`${date}T12:00:00`));
  const monthLabel = (month) => `${month.slice(0, 4)} / ${month.slice(5, 7)}`;

  function load(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value && typeof value === "object" ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    setStatus("Saved locally");
  }

  const seedExercises = [
    { id: uid(), name: "Back Squat", muscleGroup: "Legs", equipment: "Barbell", instructions: "복압을 유지하고 무릎과 발끝 방향을 맞춥니다." },
    { id: uid(), name: "Bench Press", muscleGroup: "Chest", equipment: "Barbell", instructions: "견갑을 고정하고 가슴 중앙으로 바를 내립니다." },
    { id: uid(), name: "Deadlift", muscleGroup: "Back", equipment: "Barbell", instructions: "바를 몸 가까이 유지하며 바닥을 밀어냅니다." },
    { id: uid(), name: "Pull-up", muscleGroup: "Back", equipment: "Bodyweight", instructions: "반동 없이 가슴을 바 방향으로 당깁니다." }
  ];

  const state = {
    route: location.hash.replace("#", "") || "dashboard",
    selectedDate: today(),
    selectedMonth: currentMonth(),
    trainingTab: "workout",
    dayRecords: load(DAY_KEY, {}),
    projectMonths: load(PROJECT_KEY, {}),
    health: load(HEALTH_KEY, {
      exercises: seedExercises,
      routines: [{ id: uid(), name: "Foundation 3-Day", days: ["Push", "Pull", "Legs"], schedule: ["월", "수", "금"] }],
      workouts: [],
      measurements: [],
      goals: [],
      prs: []
    }),
    settings: load(SETTINGS_KEY, {
      accent: "#1557ff",
      heroMetric: "volume"
    }),
    syncTimer: null,
    syncState: "checking"
  };

  state.health.exercises ||= seedExercises;
  state.health.routines ||= [];
  state.health.workouts ||= [];
  state.health.measurements ||= [];
  state.health.goals ||= [];
  state.health.prs ||= [];

  const main = document.getElementById("app-main");
  const syncEl = document.getElementById("sync-state");
  const statusEl = document.getElementById("status-message");
  const toastEl = document.getElementById("toast");

  function blankDay() {
    return {
      waterCount: 0,
      mood: "",
      sleep: "",
      energy: "",
      steps: "",
      meals: { breakfast: "", lunch: "", dinner: "" },
      tasks: [],
      notes: "",
      gratitude: "",
      summary: "",
      updatedAt: ""
    };
  }

  function getDay(date = state.selectedDate) {
    const raw = state.dayRecords[date] || {};
    const normalized = {
      ...blankDay(),
      ...raw,
      meals: { ...blankDay().meals, ...(raw.meals || {}) },
      tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
      waterCount: num(raw.waterCount ?? raw.water)
    };
    state.dayRecords[date] = normalized;
    return normalized;
  }

  function blankProjectMonth(month) {
    return { month, focus: "", note: "", projects: [], generatedSummary: "" };
  }

  function getProjectMonth(month = state.selectedMonth) {
    const raw = state.projectMonths[month] || blankProjectMonth(month);
    raw.month = month;
    raw.projects = Array.isArray(raw.projects) ? raw.projects : [];
    raw.projects.forEach((project) => {
      project.id ||= uid();
      project.name ||= project.title || "";
      project.status ||= "Active";
      project.category ||= "#personal";
      project.steps = Array.isArray(project.steps) ? project.steps : [];
      project.steps.forEach((step) => {
        step.id ||= uid();
        step.text ||= "";
        step.done = Boolean(step.done);
      });
    });
    state.projectMonths[month] = raw;
    return raw;
  }

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => toastEl.classList.remove("show"), 2400);
  }

  function apiBase() {
    return String(localStorage.getItem(API_OVERRIDE_KEY)
      || window.MYDAY_NOTION_SYNC?.apiBase
      || "").replace(/\/+$/, "");
  }

  function setSyncState(value, label) {
    state.syncState = value;
    syncEl.dataset.state = value;
    syncEl.textContent = label;
  }

  async function api(path, payload) {
    if (!apiBase()) throw new Error("Worker URL이 설정되지 않았습니다.");
    setSyncState("saving", "Saving to Notion");
    const response = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    setSyncState("ready", "Notion ready");
    return result;
  }

  async function checkSync() {
    if (!apiBase()) {
      setSyncState("error", "Local only");
      return false;
    }
    try {
      const response = await fetch(`${apiBase()}/health`);
      if (!response.ok) throw new Error();
      setSyncState("ready", "Notion ready");
      return true;
    } catch {
      setSyncState("error", "Notion offline");
      return false;
    }
  }

  function healthSnapshot(date) {
    const workout = state.health.workouts.find((item) => item.date === date) || null;
    const measurement = [...state.health.measurements]
      .filter((item) => item.date <= date)
      .sort((a, b) => b.date.localeCompare(a.date))[0] || null;
    return { workout, measurement, goals: state.health.goals };
  }

  function syncDay(date = state.selectedDate, immediate = false) {
    clearTimeout(state.syncTimer);
    const run = () => api("/v1/day/upsert", {
      date,
      record: { ...getDay(date), health: healthSnapshot(date) }
    }).then(() => setStatus("Saved to Notion")).catch((error) => {
      setSyncState("error", "Sync failed");
      setStatus(`Notion sync failed · ${error.message}`);
    });
    if (immediate) return run();
    state.syncTimer = setTimeout(run, 900);
  }

  function syncProject(month = state.selectedMonth, immediate = false) {
    clearTimeout(state.syncTimer);
    const run = () => api("/v1/project/month/upsert", {
      month,
      record: getProjectMonth(month)
    }).then(() => setStatus("Project saved to Notion")).catch((error) => {
      setSyncState("error", "Sync failed");
      setStatus(`Notion sync failed · ${error.message}`);
    });
    if (immediate) return run();
    state.syncTimer = setTimeout(run, 900);
  }

  function saveDay(sync = true) {
    const day = getDay();
    day.updatedAt = new Date().toISOString();
    save(DAY_KEY, state.dayRecords);
    if (sync) syncDay();
    updateSidebar();
  }

  function saveHealth(sync = true) {
    save(HEALTH_KEY, state.health);
    if (sync) syncDay();
    updateSidebar();
  }

  function saveProjects(sync = true) {
    save(PROJECT_KEY, state.projectMonths);
    if (sync) syncProject();
    updateSidebar();
  }

  function projectProgress(project) {
    if (!project.steps.length) return project.status === "Done" ? 100 : num(project.progress);
    return Math.round(project.steps.filter((step) => step.done).length / project.steps.length * 100);
  }

  function weekDates(reference = state.selectedDate) {
    const date = new Date(`${reference}T12:00:00`);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return Array.from({ length: 7 }, (_, index) => {
      const cursor = new Date(date);
      cursor.setDate(date.getDate() + index);
      return cursor.toISOString().slice(0, 10);
    });
  }

  function workoutVolume(workout) {
    return (workout?.exercises || []).reduce((sum, item) =>
      sum + (item.sets || []).reduce((setSum, set) => setSum + num(set.weight) * num(set.reps), 0), 0);
  }

  function weeklyVolume() {
    const dates = new Set(weekDates());
    return state.health.workouts.filter((workout) => dates.has(workout.date))
      .reduce((sum, workout) => sum + workoutVolume(workout), 0);
  }

  function streak() {
    const active = new Set([
      ...Object.keys(state.dayRecords).filter((key) => {
        const day = state.dayRecords[key] || {};
        return day.updatedAt || num(day.waterCount) || day.notes || day.summary;
      }),
      ...state.health.workouts.map((workout) => workout.date)
    ]);
    let total = 0;
    const cursor = new Date(`${today()}T12:00:00`);
    while (active.has(cursor.toISOString().slice(0, 10))) {
      total += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return total;
  }

  function currentWeight() {
    return [...state.health.measurements].sort((a, b) => b.date.localeCompare(a.date))[0]?.weight || 0;
  }

  function dayCompletion(day = getDay()) {
    const checks = [
      num(day.waterCount) >= 6,
      Boolean(day.mood),
      Boolean(day.sleep),
      Boolean(day.meals.breakfast || day.meals.lunch || day.meals.dinner),
      day.tasks.length > 0 && day.tasks.every((task) => task.done),
      Boolean(day.notes)
    ];
    return Math.round(checks.filter(Boolean).length / checks.length * 100);
  }

  function recentPRs() {
    return [...state.health.prs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  }

  function updateSidebar() {
    const day = getDay();
    const activeProjects = getProjectMonth().projects.filter((project) => project.status !== "Done").length;
    document.getElementById("side-summary").innerHTML = `
      <small>Today</small>
      <dl>
        <dt>Day complete</dt><dd>${dayCompletion(day)}%</dd>
        <dt>Water</dt><dd>${num(day.waterCount)}/8</dd>
        <dt>Streak</dt><dd>${streak()} days</dd>
        <dt>Active projects</dt><dd>${activeProjects}</dd>
      </dl>`;
  }

  function navTemplate() {
    document.querySelectorAll("[data-route]").forEach((link) => {
      link.classList.toggle("active", link.dataset.route === state.route);
    });
    document.getElementById("active-date-label").textContent =
      state.route === "project" ? monthLabel(state.selectedMonth) : dateLabel(state.selectedDate);
  }

  function dashboardTemplate() {
    const day = getDay();
    const workout = state.health.workouts.find((item) => item.date === state.selectedDate);
    const volume = weeklyVolume();
    const prs = recentPRs();
    const projects = getProjectMonth().projects;
    const doneProjects = projects.filter((project) => projectProgress(project) === 100).length;
    const heroValue = state.settings.heroMetric === "streak" ? `${streak()} DAYS` : `${format(volume)} KG`;
    const heroLabel = state.settings.heroMetric === "streak" ? "Current streak" : "This week's volume";
    const dashboardRows = [
      ["Next focus", day.tasks.find((task) => !task.done)?.text || "오늘의 첫 할 일을 추가하세요", `${day.tasks.filter((task) => task.done).length}/${day.tasks.length}`],
      ["Health check", `${day.sleep || "—"} sleep · energy ${day.energy || "—"}`, `${day.waterCount}/8 water`],
      ["Workout", workout ? `${workout.name || "Free workout"} · ${workout.exercises.length} exercises` : "오늘 운동 기록이 없습니다", workout ? `${format(workoutVolume(workout))} kg` : "OPEN TRAINING"],
      ["Projects", `${projects.length} projects · ${doneProjects} completed`, `${projects.length ? Math.round(projects.reduce((sum, item) => sum + projectProgress(item), 0) / projects.length) : 0}%`],
      ["Recent PR", prs[0] ? `${prs[0].exerciseName} · ${prs[0].metric}` : "아직 기록된 PR이 없습니다", prs[0] ? `${prs[0].value} · ${prs[0].date}` : "START LOGGING"]
    ];
    return `
      <p class="page-kicker">01 / Dashboard · ${esc(state.selectedDate)}</p>
      <div class="page-title-row">
        <h1 class="page-title">Your day,<br><em>clearly</em> arranged.</h1>
        <div class="hero-stat"><span>${heroLabel}</span><strong>${heroValue}</strong><small>↑ 기록이 쌓일수록 더 정확해집니다</small></div>
      </div>
      <div class="metric-strip">
        <div class="metric"><span>Day complete</span><strong>${dayCompletion(day)}%</strong></div>
        <div class="metric"><span>Sleep</span><strong>${esc(day.sleep || "—")}${day.sleep ? " H" : ""}</strong></div>
        <div class="metric"><span>Current weight</span><strong>${currentWeight() ? `${format(currentWeight(), 1)} KG` : "—"}</strong></div>
        <div class="metric accent"><span>Active projects</span><strong>${projects.filter((item) => item.status !== "Done").length}</strong></div>
      </div>
      <div class="dashboard-grid">
        <section class="section">
          <div class="section-head"><h2>Today / Index</h2><button class="text-button" data-route-jump="day">Open my day ↗</button></div>
          <ol class="index-list">
            ${dashboardRows.map((row, index) => `
              <li class="index-row">
                <span class="num">${String(index + 1).padStart(2, "0")}</span>
                <div><strong>${esc(row[0])}</strong><p>${esc(row[1])}</p></div>
                <span class="meta">${esc(row[2])}</span>
              </li>`).join("")}
          </ol>
        </section>
        <aside class="comment-panel">
          <header><span>Today / Converted diary</span><span>${esc(state.selectedDate)}</span></header>
          <div class="comment-text">${day.summary ? esc(day.summary) : "오늘의 기록을 입력한 뒤 CONVERT를 누르면 하루 정리본이 이곳에 생성됩니다."}</div>
          <footer>
            <span>생활·건강·할 일·운동 데이터를 기준으로 자동 생성<br>생성 결과는 Notion에 날짜별 백업</span>
            <button class="invert-button" data-action="convert-day">CONVERT ↗</button>
          </footer>
        </aside>
      </div>`;
  }

  function dayTemplate() {
    const day = getDay();
    return `
      <p class="page-kicker">02 / My Day · ${esc(state.selectedDate)}</p>
      <div class="page-title-row">
        <h1 class="page-title">Live the day.<br><em>Keep</em> the record.</h1>
        <div class="hero-stat"><span>Daily completion</span><strong>${dayCompletion(day)}%</strong><small>Autosave + Notion backup</small></div>
      </div>

      <section class="form-section">
        <div class="form-row">
          <div class="form-label"><small>01 / HYDRATION</small><strong>물 섭취</strong></div>
          <div class="water-control">
            ${Array.from({ length: 8 }, (_, index) => `<button class="water-cup ${index < day.waterCount ? "active" : ""}" data-action="set-water" data-value="${index + 1}">${index + 1}</button>`).join("")}
          </div>
        </div>
        <div class="form-row">
          <div class="form-label"><small>02 / RECOVERY</small><strong>수면과 에너지</strong></div>
          <div class="field-grid three">
            <label class="field">수면 시간<input type="number" min="0" max="24" step=".5" data-day-field="sleep" value="${esc(day.sleep)}" placeholder="7.5"></label>
            <label class="field">에너지 1–10<input type="number" min="1" max="10" data-day-field="energy" value="${esc(day.energy)}" placeholder="7"></label>
            <label class="field">걸음 수<input type="number" min="0" data-day-field="steps" value="${esc(day.steps)}" placeholder="8000"></label>
          </div>
        </div>
        <div class="form-row">
          <div class="form-label"><small>03 / MOOD</small><strong>오늘의 기분</strong></div>
          <div class="choice-row">
            ${["최고", "좋음", "보통", "피곤", "스트레스"].map((mood) => `<button class="choice ${day.mood === mood ? "active" : ""}" data-action="set-mood" data-value="${mood}">${mood}</button>`).join("")}
          </div>
        </div>
        <div class="form-row">
          <div class="form-label"><small>04 / MEALS</small><strong>식사 기록</strong></div>
          <div class="field-grid three">
            <label class="field">아침<input data-meal-field="breakfast" value="${esc(day.meals.breakfast)}" placeholder="메뉴 또는 식사 메모"></label>
            <label class="field">점심<input data-meal-field="lunch" value="${esc(day.meals.lunch)}" placeholder="메뉴 또는 식사 메모"></label>
            <label class="field">저녁<input data-meal-field="dinner" value="${esc(day.meals.dinner)}" placeholder="메뉴 또는 식사 메모"></label>
          </div>
        </div>
        <div class="form-row">
          <div class="form-label"><small>05 / TASKS</small><strong>오늘 할 일</strong></div>
          <div>
            ${day.tasks.length ? day.tasks.map((task, index) => `
              <div class="task-row ${task.done ? "done" : ""}">
                <input type="checkbox" data-task-done="${index}" ${task.done ? "checked" : ""}>
                <input type="text" data-task-text="${index}" value="${esc(task.text)}" placeholder="할 일">
                <button class="icon-button" data-action="delete-task" data-index="${index}" aria-label="삭제">×</button>
              </div>`).join("") : `<div class="empty-state">오늘 할 일을 추가해 보세요.</div>`}
            <button class="text-button" data-action="add-task">+ ADD TASK</button>
          </div>
        </div>
        <div class="form-row">
          <div class="form-label"><small>06 / NOTES</small><strong>메모와 감사</strong></div>
          <div class="field-grid">
            <label class="field">오늘의 메모<textarea data-day-field="notes" placeholder="있었던 일, 떠오른 생각, 잊지 말 것">${esc(day.notes)}</textarea></label>
            <label class="field">감사한 일<textarea data-day-field="gratitude" placeholder="오늘 감사했던 한 가지">${esc(day.gratitude)}</textarea></label>
          </div>
        </div>
      </section>
      <div class="dashboard-grid">
        <section class="section">
          <div class="section-head"><h2>Daily review</h2><button class="text-button" data-action="convert-day">Convert now ↗</button></div>
          <div class="empty-state">${day.summary ? esc(day.summary) : "CONVERT를 누르면 오늘의 모든 기록을 자연스러운 하루 정리본으로 변환합니다."}</div>
        </section>
        <aside class="comment-panel">
          <header><span>Day archive</span><span>${esc(state.selectedDate)}</span></header>
          <div class="comment-text">${day.summary ? esc(day.summary) : "아직 생성된 정리본이 없습니다."}</div>
          <footer><span>날짜별 Notion 자동 백업</span><button class="invert-button" data-action="convert-day">CONVERT ↗</button></footer>
        </aside>
      </div>`;
  }

  function exerciseName(id) {
    return state.health.exercises.find((exercise) => exercise.id === id)?.name || "Unknown";
  }

  function workoutForDate(create = false) {
    let workout = state.health.workouts.find((item) => item.date === state.selectedDate);
    if (!workout && create) {
      workout = { id: uid(), date: state.selectedDate, name: "Free Workout", duration: "", notes: "", exercises: [] };
      state.health.workouts.push(workout);
      saveHealth();
    }
    return workout;
  }

  function bestBefore(exerciseId, workoutId, setId) {
    let maxWeight = 0;
    let maxReps = 0;
    let best1RM = 0;
    state.health.workouts.forEach((workout) => {
      (workout.exercises || []).filter((item) => item.exerciseId === exerciseId).forEach((item) => {
        (item.sets || []).forEach((set) => {
          if (workout.id === workoutId && set.id === setId) return;
          const weight = num(set.weight);
          const reps = num(set.reps);
          maxWeight = Math.max(maxWeight, weight);
          maxReps = Math.max(maxReps, reps);
          best1RM = Math.max(best1RM, weight * (1 + reps / 30));
        });
      });
    });
    return { maxWeight, maxReps, best1RM };
  }

  function evaluatePR(workout, exerciseEntry, set) {
    const before = bestBefore(exerciseEntry.exerciseId, workout.id, set.id);
    const weight = num(set.weight);
    const reps = num(set.reps);
    if (!weight || !reps) return "";
    const oneRM = weight * (1 + reps / 30);
    if (weight > before.maxWeight) return "MAX WEIGHT PR";
    if (oneRM > before.best1RM) return "EST. 1RM PR";
    if (reps > before.maxReps) return "MAX REPS PR";
    return "";
  }

  function refreshPRs() {
    const found = [];
    const ordered = [...state.health.workouts].sort((a, b) => a.date.localeCompare(b.date));
    const history = new Map();
    ordered.forEach((workout) => {
      (workout.exercises || []).forEach((entry) => {
        const best = history.get(entry.exerciseId) || { weight: 0, reps: 0, oneRM: 0 };
        (entry.sets || []).forEach((set) => {
          const weight = num(set.weight);
          const reps = num(set.reps);
          const oneRM = weight * (1 + reps / 30);
          let metric = "";
          let value = 0;
          if (weight > best.weight) { metric = "Max weight"; value = `${weight} kg`; }
          else if (oneRM > best.oneRM) { metric = "Est. 1RM"; value = `${oneRM.toFixed(1)} kg`; }
          else if (reps > best.reps) { metric = "Max reps"; value = `${reps} reps`; }
          if (metric && weight && reps) found.push({
            id: `${workout.id}:${set.id}`,
            exerciseId: entry.exerciseId,
            exerciseName: exerciseName(entry.exerciseId),
            metric, value, date: workout.date
          });
          best.weight = Math.max(best.weight, weight);
          best.reps = Math.max(best.reps, reps);
          best.oneRM = Math.max(best.oneRM, oneRM);
          history.set(entry.exerciseId, best);
        });
      });
    });
    state.health.prs = found;
  }

  function workoutTabTemplate() {
    const workout = workoutForDate();
    if (!workout) return `
      <div class="empty-state">오늘 시작한 운동이 없습니다. 루틴과 관계없이 자유 운동으로 바로 시작할 수 있습니다.</div>
      <button class="primary-button" data-action="start-workout">START TODAY'S WORKOUT</button>`;
    return `
      <div class="field-grid three">
        <label class="field">Workout name<input data-workout-field="name" value="${esc(workout.name)}"></label>
        <label class="field">Duration (min)<input type="number" data-workout-field="duration" value="${esc(workout.duration)}"></label>
        <label class="field">Exercise
          <select id="workout-exercise-select">
            ${state.health.exercises.map((exercise) => `<option value="${exercise.id}">${esc(exercise.name)}</option>`).join("")}
          </select>
        </label>
      </div>
      <button class="text-button" data-action="add-workout-exercise">+ ADD EXERCISE</button>
      <div>
        ${(workout.exercises || []).map((entry, exerciseIndex) => `
          <article class="workout-exercise">
            <header>
              <span>${String(exerciseIndex + 1).padStart(2, "0")}</span>
              <h3>${esc(exerciseName(entry.exerciseId))}</h3>
              <button class="icon-button" data-action="delete-workout-exercise" data-index="${exerciseIndex}">×</button>
            </header>
            <div>
              ${(entry.sets || []).map((set, setIndex) => {
                const flag = evaluatePR(workout, entry, set);
                return `<div class="set-row">
                  <span class="num">S${String(setIndex + 1).padStart(2, "0")}</span>
                  <input type="number" inputmode="decimal" data-set-field="weight" data-exercise-index="${exerciseIndex}" data-set-index="${setIndex}" value="${esc(set.weight)}" placeholder="kg">
                  <input type="number" inputmode="numeric" data-set-field="reps" data-exercise-index="${exerciseIndex}" data-set-index="${setIndex}" value="${esc(set.reps)}" placeholder="reps">
                  <input type="number" inputmode="decimal" min="1" max="10" step=".5" data-set-field="rpe" data-exercise-index="${exerciseIndex}" data-set-index="${setIndex}" value="${esc(set.rpe)}" placeholder="RPE">
                  <span class="pr-flag">${flag}</span>
                  <button class="icon-button" data-action="delete-set" data-exercise-index="${exerciseIndex}" data-set-index="${setIndex}">×</button>
                </div>`;
              }).join("")}
              <button class="text-button" data-action="add-set" data-index="${exerciseIndex}">+ ADD SET</button>
            </div>
          </article>`).join("")}
      </div>
      <label class="field">Workout notes<textarea data-workout-field="notes">${esc(workout.notes)}</textarea></label>`;
  }

  function libraryTabTemplate() {
    return `
      <div class="field-grid three">
        <label class="field">Exercise name<input id="new-exercise-name" placeholder="Romanian Deadlift"></label>
        <label class="field">Muscle group<input id="new-exercise-muscle" placeholder="Hamstrings"></label>
        <label class="field">Equipment<input id="new-exercise-equipment" placeholder="Barbell"></label>
      </div>
      <button class="text-button" data-action="add-exercise">+ ADD TO LIBRARY</button>
      <ol class="index-list">
        ${[...state.health.exercises].sort((a, b) => a.name.localeCompare(b.name)).map((exercise, index) => `
          <li class="index-row">
            <span class="num">${String(index + 1).padStart(2, "0")}</span>
            <div><strong>${esc(exercise.name)}</strong><p>${esc(exercise.instructions || "운동 지침을 추가하세요.")}</p></div>
            <span class="meta">${esc(exercise.muscleGroup)}<br>${esc(exercise.equipment)}</span>
          </li>`).join("")}
      </ol>`;
  }

  function routinesTabTemplate() {
    return `
      <div class="field-grid">
        <label class="field">Routine name<input id="new-routine-name" placeholder="Upper / Lower"></label>
        <label class="field">Weekly schedule<input id="new-routine-schedule" placeholder="월, 화, 목, 토"></label>
      </div>
      <button class="text-button" data-action="add-routine">+ ADD ROUTINE</button>
      <ol class="index-list">
        ${state.health.routines.map((routine, index) => `
          <li class="index-row">
            <span class="num">${String(index + 1).padStart(2, "0")}</span>
            <div><strong>${esc(routine.name)}</strong><p>${esc((routine.days || []).join(" / ") || "Freeform routine")}</p></div>
            <span class="meta">${esc((routine.schedule || []).join(" · "))}</span>
          </li>`).join("") || `<li class="empty-state">등록된 루틴이 없습니다.</li>`}
      </ol>`;
  }

  function trainingTemplate() {
    return `
      <p class="page-kicker">03 / Training · ${esc(state.selectedDate)}</p>
      <div class="page-title-row">
        <h1 class="page-title">Train.<br><em>Measure.</em> Improve.</h1>
        <div class="hero-stat"><span>This week's volume</span><strong>${format(weeklyVolume())} KG</strong><small>${recentPRs().length} recent personal records</small></div>
      </div>
      <nav class="subnav">
        ${[["workout", "Log workout"], ["library", "Exercise library"], ["routines", "Routines"]].map(([key, label]) =>
          `<button class="${state.trainingTab === key ? "active" : ""}" data-action="training-tab" data-value="${key}">${label}</button>`).join("")}
      </nav>
      <section>${state.trainingTab === "workout" ? workoutTabTemplate() : state.trainingTab === "library" ? libraryTabTemplate() : routinesTabTemplate()}</section>`;
  }

  function trendSvg(values, target = null) {
    if (!values.length) return `<div class="empty-state">추이를 표시할 데이터가 없습니다.</div>`;
    const numbers = values.map(num);
    const min = Math.min(...numbers, target ? num(target) : Infinity);
    const max = Math.max(...numbers, target ? num(target) : -Infinity);
    const range = max - min || 1;
    const points = numbers.map((value, index) => {
      const x = numbers.length === 1 ? 50 : index / (numbers.length - 1) * 100;
      const y = 100 - ((value - min) / range * 80 + 10);
      return `${x},${y}`;
    }).join(" ");
    const targetY = target ? 100 - ((num(target) - min) / range * 80 + 10) : null;
    return `<svg class="trend" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="측정 추이">
      ${targetY !== null ? `<line class="target" x1="0" x2="100" y1="${targetY}" y2="${targetY}"/>` : ""}
      <polyline points="${points}"/>
      ${numbers.map((value, index) => {
        const [x, y] = points.split(" ")[index].split(",");
        return `<circle cx="${x}" cy="${y}" r="1.6"><title>${value}</title></circle>`;
      }).join("")}
    </svg>`;
  }

  function bodyTemplate() {
    const measurements = [...state.health.measurements].sort((a, b) => a.date.localeCompare(b.date));
    const latest = measurements.at(-1);
    const previous = measurements.at(-2);
    const change = latest && previous ? num(latest.weight) - num(previous.weight) : 0;
    const weightGoal = state.health.goals.find((goal) => goal.metricType === "BodyWeight");
    return `
      <p class="page-kicker">04 / Body & Goals</p>
      <div class="page-title-row">
        <h1 class="page-title">Body data,<br><em>without</em> the noise.</h1>
        <div class="hero-stat"><span>Current weight</span><strong>${latest ? `${format(latest.weight, 1)} KG` : "—"}</strong><small>${latest && previous ? `${change >= 0 ? "↑" : "↓"} ${Math.abs(change).toFixed(1)} kg since last entry` : "첫 측정값을 입력하세요"}</small></div>
      </div>
      <div class="dashboard-grid">
        <section class="section">
          <div class="section-head"><h2>Weight / Trend</h2><span class="page-kicker">${measurements.length} measurements</span></div>
          ${trendSvg(measurements.map((item) => item.weight), weightGoal?.targetValue)}
          <div class="field-grid three">
            <label class="field">Date<input type="date" id="measurement-date" value="${today()}"></label>
            <label class="field">Weight kg<input type="number" step=".1" id="measurement-weight"></label>
            <label class="field">Body fat %<input type="number" step=".1" id="measurement-fat"></label>
          </div>
          <button class="text-button" data-action="add-measurement">+ ADD MEASUREMENT</button>
        </section>
        <aside class="comment-panel">
          <header><span>Health / Comment</span><span>${latest?.date || "—"}</span></header>
          <div class="comment-text">${latest ? `현재 체중은 ${latest.weight}kg${latest.bodyFat ? `, 체지방률은 ${latest.bodyFat}%` : ""}입니다. ${weightGoal ? `목표 ${weightGoal.targetValue}kg까지 ${Math.abs(num(latest.weight) - num(weightGoal.targetValue)).toFixed(1)}kg 남았습니다.` : "목표 체중을 설정하면 진행 상황을 계산합니다."}` : "측정값을 기록하면 변화와 목표 진행률을 보여줍니다."}</div>
          <footer><span>단순 기록용 · 의료 조언 아님</span></footer>
        </aside>
      </div>
      <section class="section">
        <div class="section-head"><h2>Goals / Index</h2><button class="text-button" data-action="add-goal">+ ADD GOAL</button></div>
        <div class="field-grid three" id="goal-new-fields">
          <label class="field">Metric
            <select id="goal-type"><option value="BodyWeight">Body weight</option><option value="LiftNumber">Lift number</option><option value="Frequency">Workout frequency</option><option value="Custom">Custom</option></select>
          </label>
          <label class="field">Target value<input type="number" step=".1" id="goal-target"></label>
          <label class="field">Target date<input type="date" id="goal-date"></label>
        </div>
        <ol class="index-list">
          ${state.health.goals.map((goal, index) => {
            const current = goal.metricType === "BodyWeight" ? num(latest?.weight) : num(goal.currentValue);
            const progress = goal.metricType === "BodyWeight" && current
              ? clamp(100 - Math.abs(current - num(goal.targetValue)) / Math.max(current, num(goal.targetValue)) * 100, 0, 100)
              : clamp(current / Math.max(num(goal.targetValue), 1) * 100, 0, 100);
            return `<li class="index-row">
              <span class="num">${String(index + 1).padStart(2, "0")}</span>
              <div><strong>${esc(goal.metricType)}</strong><div class="progress-line"><i style="width:${progress}%"></i></div></div>
              <span class="meta">${format(current, 1)} / ${format(goal.targetValue, 1)}<br>${Math.round(progress)}% · ${esc(goal.targetDate || "No date")}</span>
            </li>`;
          }).join("") || `<li class="empty-state">목표를 추가하면 현재 값과 목표의 차이를 추적합니다.</li>`}
        </ol>
      </section>`;
  }

  function projectTemplate() {
    const month = getProjectMonth();
    const average = month.projects.length
      ? Math.round(month.projects.reduce((sum, project) => sum + projectProgress(project), 0) / month.projects.length)
      : 0;
    return `
      <p class="page-kicker">05 / My Project · ${esc(state.selectedMonth)}</p>
      <div class="page-title-row">
        <h1 class="page-title">Make progress.<br><em>Keep</em> the proof.</h1>
        <div class="hero-stat"><span>Monthly progress</span><strong>${average}%</strong><small>${month.projects.filter((project) => project.status === "Done").length} projects completed</small></div>
      </div>
      <section class="form-section">
        <div class="form-row">
          <div class="form-label"><small>01 / DIRECTION</small><strong>이번 달의 방향</strong></div>
          <div class="field-grid">
            <label class="field">Monthly focus<input data-project-month-field="focus" value="${esc(month.focus)}" placeholder="이달에 가장 중요한 한 가지"></label>
            <label class="field">Month note<input data-project-month-field="note" value="${esc(month.note)}" placeholder="기억할 기준 또는 제약"></label>
          </div>
        </div>
      </section>
      <section class="section">
        <div class="section-head"><h2>Projects / Index</h2><button class="text-button" data-action="add-project">+ ADD PROJECT</button></div>
        <div>
          ${month.projects.map((project, projectIndex) => `
            <article class="project-row">
              <div class="project-head">
                <span class="num">${String(projectIndex + 1).padStart(2, "0")}</span>
                <input data-project-name="${projectIndex}" value="${esc(project.name)}" placeholder="Project name">
                <select data-project-status="${projectIndex}">
                  ${["Idea", "Active", "Blocked", "Done"].map((status) => `<option ${project.status === status ? "selected" : ""}>${status}</option>`).join("")}
                </select>
                <span class="project-percent">${projectProgress(project)}%</span>
                <button class="icon-button" data-action="delete-project" data-index="${projectIndex}">×</button>
              </div>
              <div class="project-detail">
                <div class="project-progress"><div class="progress-line"><i style="width:${projectProgress(project)}%"></i></div><span class="meta">${projectProgress(project)}%</span></div>
                ${project.steps.map((step, stepIndex) => `
                  <div class="task-row ${step.done ? "done" : ""}">
                    <input type="checkbox" data-project-step-done="${projectIndex}:${stepIndex}" ${step.done ? "checked" : ""}>
                    <input data-project-step-text="${projectIndex}:${stepIndex}" value="${esc(step.text)}" placeholder="Next action">
                    <button class="icon-button" data-action="delete-project-step" data-project-index="${projectIndex}" data-step-index="${stepIndex}">×</button>
                  </div>`).join("")}
                <button class="text-button" data-action="add-project-step" data-index="${projectIndex}">+ ADD NEXT ACTION</button>
              </div>
            </article>`).join("") || `<div class="empty-state">첫 프로젝트를 추가하세요.</div>`}
        </div>
      </section>
      <div class="dashboard-grid">
        <section class="section">
          <div class="section-head"><h2>Monthly review</h2><button class="text-button" data-action="convert-project">Convert now ↗</button></div>
          <div class="empty-state">${month.generatedSummary ? esc(month.generatedSummary) : "CONVERT를 누르면 프로젝트 진행률, 완료 작업, 다음 행동을 월간 정리본으로 변환합니다."}</div>
        </section>
        <aside class="comment-panel">
          <header><span>Project / Converted review</span><span>${esc(state.selectedMonth)}</span></header>
          <div class="comment-text">${month.generatedSummary ? esc(month.generatedSummary) : "아직 생성된 프로젝트 정리본이 없습니다."}</div>
          <footer><span>프로젝트 데이터를 기준으로 자동 생성<br>Notion 월별 백업</span><button class="invert-button" data-action="convert-project">CONVERT ↗</button></footer>
        </aside>
      </div>`;
  }

  function settingsTemplate() {
    const colors = ["#1557ff", "#ff4d2e", "#00a676", "#b144ff", "#111111", "#d69d00"];
    return `
      <p class="page-kicker">06 / Settings</p>
      <div class="page-title-row">
        <h1 class="page-title">Make it<br><em>yours.</em></h1>
        <div class="hero-stat"><span>Sync status</span><strong>${state.syncState === "ready" ? "READY" : "CHECK"}</strong><small>${esc(apiBase() || "Worker URL not set")}</small></div>
      </div>
      <section class="form-section">
        <div class="form-row">
          <div class="form-label"><small>01 / ACCENT</small><strong>강조 색상</strong></div>
          <div>
            <div class="settings-swatches">
              ${colors.map((color) => `<button class="swatch ${state.settings.accent === color ? "active" : ""}" style="--swatch:${color}" data-action="set-accent" data-value="${color}" aria-label="${color}"></button>`).join("")}
              <input type="color" id="custom-accent" value="${esc(state.settings.accent)}" aria-label="사용자 지정 강조 색상">
            </div>
          </div>
        </div>
        <div class="form-row">
          <div class="form-label"><small>02 / HERO</small><strong>대시보드 대표 수치</strong></div>
          <div class="choice-row">
            <button class="choice ${state.settings.heroMetric === "volume" ? "active" : ""}" data-action="set-hero" data-value="volume">Weekly volume</button>
            <button class="choice ${state.settings.heroMetric === "streak" ? "active" : ""}" data-action="set-hero" data-value="streak">Current streak</button>
          </div>
        </div>
        <div class="form-row">
          <div class="form-label"><small>03 / NOTION</small><strong>자동 백업</strong></div>
          <div>
            <label class="field">Cloudflare Worker URL<input id="worker-url" value="${esc(apiBase())}" placeholder="https://your-worker.workers.dev"></label>
            <button class="text-button" data-action="test-sync">TEST CONNECTION ↗</button>
          </div>
        </div>
        <div class="form-row">
          <div class="form-label"><small>04 / DATA</small><strong>로컬 데이터</strong></div>
          <div>
            <button class="text-button" data-action="export-data">EXPORT JSON ↗</button>
            <p class="empty-state">브라우저 로컬 저장과 Notion 백업을 함께 사용합니다. Notion 토큰은 브라우저에 저장되지 않습니다.</p>
          </div>
        </div>
      </section>`;
  }

  function render() {
    const routes = {
      dashboard: dashboardTemplate,
      day: dayTemplate,
      training: trainingTemplate,
      body: bodyTemplate,
      project: projectTemplate,
      settings: settingsTemplate
    };
    if (!routes[state.route]) state.route = "dashboard";
    main.innerHTML = routes[state.route]();
    navTemplate();
    updateSidebar();
    main.focus({ preventScroll: true });
  }

  function generateDaySummary() {
    const day = getDay();
    const workout = workoutForDate();
    const completed = day.tasks.filter((task) => task.done);
    const pending = day.tasks.filter((task) => !task.done);
    const mealCount = Object.values(day.meals).filter(Boolean).length;
    const parts = [];
    parts.push(`${dateLabel(state.selectedDate)}의 기록입니다.`);
    if (day.mood || day.energy) parts.push(`기분은 ${day.mood || "기록 없음"}${day.energy ? `, 에너지는 10점 중 ${day.energy}점` : ""}이었습니다.`);
    if (day.sleep || day.waterCount) parts.push(`${day.sleep ? `${day.sleep}시간 수면을 취했고` : "수면 시간은 기록하지 않았고"}, 물은 ${day.waterCount}잔 마셨습니다.`);
    if (mealCount) parts.push(`${mealCount}번의 식사를 기록했습니다.`);
    if (completed.length) parts.push(`${completed.map((task) => task.text).filter(Boolean).join(", ")}을(를) 마쳤습니다.`);
    if (pending.length) parts.push(`남은 일은 ${pending.map((task) => task.text).filter(Boolean).join(", ")}입니다.`);
    if (workout) parts.push(`${workout.name} 운동에서 ${workout.exercises.length}개 종목, 총 ${format(workoutVolume(workout))}kg의 볼륨을 기록했습니다.`);
    if (day.notes) parts.push(`오늘의 메모: ${day.notes}`);
    if (day.gratitude) parts.push(`감사한 일: ${day.gratitude}`);
    if (parts.length === 1) parts.push("아직 입력된 기록이 적습니다. 작은 기록 하나부터 남겨보세요.");
    return parts.join(" ");
  }

  function generateProjectSummary() {
    const month = getProjectMonth();
    const total = month.projects.length;
    const done = month.projects.filter((project) => project.status === "Done");
    const active = month.projects.filter((project) => project.status === "Active");
    const blocked = month.projects.filter((project) => project.status === "Blocked");
    const next = month.projects.flatMap((project) =>
      project.steps.filter((step) => !step.done && step.text).slice(0, 1).map((step) => `${project.name}: ${step.text}`)
    );
    const average = total ? Math.round(month.projects.reduce((sum, project) => sum + projectProgress(project), 0) / total) : 0;
    const parts = [`${monthLabel(state.selectedMonth)} 프로젝트 정리입니다.`];
    if (month.focus) parts.push(`이번 달의 핵심 방향은 “${month.focus}”입니다.`);
    parts.push(`전체 ${total}개 프로젝트의 평균 진행률은 ${average}%입니다.`);
    if (done.length) parts.push(`${done.map((project) => project.name).filter(Boolean).join(", ")}을(를) 완료했습니다.`);
    if (active.length) parts.push(`${active.length}개 프로젝트가 진행 중입니다.`);
    if (blocked.length) parts.push(`${blocked.map((project) => project.name).filter(Boolean).join(", ")}은(는) 점검이 필요합니다.`);
    if (next.length) parts.push(`다음 행동은 ${next.join(" / ")}입니다.`);
    if (month.note) parts.push(`메모: ${month.note}`);
    return parts.join(" ");
  }

  async function convertDay() {
    const summary = generateDaySummary();
    const day = getDay();
    day.summary = summary;
    saveDay(false);
    render();
    toast("하루 정리본을 생성했습니다.");
    try {
      await syncDay(state.selectedDate, true);
      await api("/v1/convert/upsert", {
        date: state.selectedDate,
        type: "Daily Diary",
        content: day.summary,
        dayRecord: { ...day, health: healthSnapshot(state.selectedDate) }
      });
      setStatus("Converted diary backed up to Notion");
    } catch (error) {
      setStatus(`Diary created locally · Notion ${error.message}`);
    }
  }

  async function convertProject() {
    const month = getProjectMonth();
    month.generatedSummary = generateProjectSummary();
    saveProjects(false);
    render();
    toast("프로젝트 정리본을 생성했습니다.");
    try {
      await syncProject(state.selectedMonth, true);
      await api("/v1/convert/upsert", {
        date: state.selectedDate,
        type: "Project Monthly Review",
        content: month.generatedSummary
      });
      setStatus("Project review backed up to Notion");
    } catch (error) {
      setStatus(`Review created locally · Notion ${error.message}`);
    }
  }

  function shiftDate(direction) {
    if (state.route === "project") {
      const [year, month] = state.selectedMonth.split("-").map(Number);
      const cursor = new Date(year, month - 1 + direction, 1);
      state.selectedMonth = cursor.toISOString().slice(0, 7);
    } else {
      const cursor = new Date(`${state.selectedDate}T12:00:00`);
      cursor.setDate(cursor.getDate() + direction);
      state.selectedDate = cursor.toISOString().slice(0, 10);
    }
    render();
  }

  function routeTo(route) {
    state.route = route;
    location.hash = route;
    document.body.classList.remove("menu-open");
    render();
  }

  document.addEventListener("click", async (event) => {
    const actionEl = event.target.closest("[data-action]");
    const routeJump = event.target.closest("[data-route-jump]");
    if (routeJump) return routeTo(routeJump.dataset.routeJump);
    if (!actionEl) return;
    const action = actionEl.dataset.action;

    if (action === "previous-date") return shiftDate(-1);
    if (action === "next-date") return shiftDate(1);
    if (action === "quick-add" || action === "focus-search") return document.getElementById("quick-dialog").showModal();
    if (action === "close-quick") return document.getElementById("quick-dialog").close();
    if (action === "convert-day") return convertDay();
    if (action === "convert-project") return convertProject();
    if (action === "set-water") {
      getDay().waterCount = num(actionEl.dataset.value);
      saveDay();
      return render();
    }
    if (action === "set-mood") {
      getDay().mood = actionEl.dataset.value;
      saveDay();
      return render();
    }
    if (action === "add-task") {
      getDay().tasks.push({ id: uid(), text: "", done: false });
      saveDay();
      return render();
    }
    if (action === "delete-task") {
      getDay().tasks.splice(num(actionEl.dataset.index), 1);
      saveDay();
      return render();
    }
    if (action === "training-tab") {
      state.trainingTab = actionEl.dataset.value;
      return render();
    }
    if (action === "start-workout") {
      workoutForDate(true);
      return render();
    }
    if (action === "add-workout-exercise") {
      const workout = workoutForDate(true);
      const id = document.getElementById("workout-exercise-select").value;
      if (!workout.exercises.some((item) => item.exerciseId === id)) {
        workout.exercises.push({ id: uid(), exerciseId: id, sets: [{ id: uid(), weight: "", reps: "", rpe: "" }] });
        saveHealth();
      }
      return render();
    }
    if (action === "delete-workout-exercise") {
      workoutForDate().exercises.splice(num(actionEl.dataset.index), 1);
      refreshPRs(); saveHealth(); return render();
    }
    if (action === "add-set") {
      workoutForDate().exercises[num(actionEl.dataset.index)].sets.push({ id: uid(), weight: "", reps: "", rpe: "" });
      saveHealth(); return render();
    }
    if (action === "delete-set") {
      workoutForDate().exercises[num(actionEl.dataset.exerciseIndex)].sets.splice(num(actionEl.dataset.setIndex), 1);
      refreshPRs(); saveHealth(); return render();
    }
    if (action === "add-exercise") {
      const name = document.getElementById("new-exercise-name").value.trim();
      if (!name) return toast("운동 이름을 입력하세요.");
      state.health.exercises.push({
        id: uid(), name,
        muscleGroup: document.getElementById("new-exercise-muscle").value.trim(),
        equipment: document.getElementById("new-exercise-equipment").value.trim(),
        instructions: ""
      });
      saveHealth(false); return render();
    }
    if (action === "add-routine") {
      const name = document.getElementById("new-routine-name").value.trim();
      if (!name) return toast("루틴 이름을 입력하세요.");
      state.health.routines.push({
        id: uid(), name, days: [],
        schedule: document.getElementById("new-routine-schedule").value.split(",").map((item) => item.trim()).filter(Boolean)
      });
      saveHealth(false); return render();
    }
    if (action === "add-measurement") {
      const weight = document.getElementById("measurement-weight").value;
      if (!weight) return toast("체중을 입력하세요.");
      state.health.measurements.push({
        id: uid(),
        date: document.getElementById("measurement-date").value || today(),
        weight: num(weight),
        bodyFat: num(document.getElementById("measurement-fat").value) || ""
      });
      saveHealth(); return render();
    }
    if (action === "add-goal") {
      const target = document.getElementById("goal-target").value;
      if (!target) return toast("목표값을 입력하세요.");
      state.health.goals.push({
        id: uid(),
        metricType: document.getElementById("goal-type").value,
        targetValue: num(target),
        targetDate: document.getElementById("goal-date").value,
        currentValue: 0
      });
      saveHealth(); return render();
    }
    if (action === "add-project") {
      getProjectMonth().projects.push({
        id: uid(), name: "", status: "Active", category: "#personal",
        steps: [{ id: uid(), text: "", done: false }]
      });
      saveProjects(); return render();
    }
    if (action === "delete-project") {
      getProjectMonth().projects.splice(num(actionEl.dataset.index), 1);
      saveProjects(); return render();
    }
    if (action === "add-project-step") {
      getProjectMonth().projects[num(actionEl.dataset.index)].steps.push({ id: uid(), text: "", done: false });
      saveProjects(); return render();
    }
    if (action === "delete-project-step") {
      getProjectMonth().projects[num(actionEl.dataset.projectIndex)].steps.splice(num(actionEl.dataset.stepIndex), 1);
      saveProjects(); return render();
    }
    if (action === "set-accent") {
      state.settings.accent = actionEl.dataset.value;
      document.documentElement.style.setProperty("--accent", state.settings.accent);
      save(SETTINGS_KEY, state.settings);
      return render();
    }
    if (action === "set-hero") {
      state.settings.heroMetric = actionEl.dataset.value;
      save(SETTINGS_KEY, state.settings);
      return render();
    }
    if (action === "test-sync") {
      const input = document.getElementById("worker-url");
      localStorage.setItem(API_OVERRIDE_KEY, input.value.trim().replace(/\/+$/, ""));
      const ready = await checkSync();
      toast(ready ? "Notion 연결이 정상입니다." : "연결을 확인할 수 없습니다.");
      return render();
    }
    if (action === "export-data") {
      const blob = new Blob([JSON.stringify({
        exportedAt: new Date().toISOString(),
        dayRecords: state.dayRecords,
        projectMonths: state.projectMonths,
        health: state.health,
        settings: state.settings
      }, null, 2)], { type: "application/json" });
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = `still-day-backup-${today()}.json`;
      anchor.click();
      URL.revokeObjectURL(anchor.href);
    }
  });

  main.addEventListener("input", (event) => {
    const target = event.target;
    const day = getDay();
    if (target.dataset.dayField) {
      day[target.dataset.dayField] = target.value;
      saveDay();
    }
    if (target.dataset.mealField) {
      day.meals[target.dataset.mealField] = target.value;
      saveDay();
    }
    if (target.dataset.taskText !== undefined) {
      day.tasks[num(target.dataset.taskText)].text = target.value;
      saveDay();
    }
    if (target.dataset.workoutField) {
      workoutForDate(true)[target.dataset.workoutField] = target.value;
      saveHealth();
    }
    if (target.dataset.setField) {
      const entry = workoutForDate(true).exercises[num(target.dataset.exerciseIndex)];
      entry.sets[num(target.dataset.setIndex)][target.dataset.setField] = target.value;
      refreshPRs();
      saveHealth();
      const flag = evaluatePR(workoutForDate(), entry, entry.sets[num(target.dataset.setIndex)]);
      target.closest(".set-row").querySelector(".pr-flag").textContent = flag;
    }
    if (target.dataset.projectMonthField) {
      getProjectMonth()[target.dataset.projectMonthField] = target.value;
      saveProjects();
    }
    if (target.dataset.projectName !== undefined) {
      getProjectMonth().projects[num(target.dataset.projectName)].name = target.value;
      saveProjects();
    }
    if (target.dataset.projectStepText) {
      const [projectIndex, stepIndex] = target.dataset.projectStepText.split(":").map(Number);
      getProjectMonth().projects[projectIndex].steps[stepIndex].text = target.value;
      saveProjects();
    }
  });

  main.addEventListener("change", (event) => {
    const target = event.target;
    if (target.dataset.taskDone !== undefined) {
      getDay().tasks[num(target.dataset.taskDone)].done = target.checked;
      saveDay(); render();
    }
    if (target.dataset.projectStatus !== undefined) {
      getProjectMonth().projects[num(target.dataset.projectStatus)].status = target.value;
      saveProjects(); render();
    }
    if (target.dataset.projectStepDone) {
      const [projectIndex, stepIndex] = target.dataset.projectStepDone.split(":").map(Number);
      getProjectMonth().projects[projectIndex].steps[stepIndex].done = target.checked;
      saveProjects(); render();
    }
    if (target.id === "custom-accent") {
      state.settings.accent = target.value;
      document.documentElement.style.setProperty("--accent", target.value);
      save(SETTINGS_KEY, state.settings);
      render();
    }
  });

  document.getElementById("quick-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const content = String(data.get("content") || "").trim();
    if (!content) return;
    const type = data.get("type");
    if (type === "task") getDay().tasks.push({ id: uid(), text: content, done: false });
    if (type === "note") getDay().notes = [getDay().notes, content].filter(Boolean).join("\n");
    if (type === "meal") getDay().meals.dinner = content;
    if (type === "project") getProjectMonth().projects.push({ id: uid(), name: content, status: "Active", category: "#personal", steps: [] });
    if (type === "project") saveProjects(); else saveDay();
    event.currentTarget.reset();
    document.getElementById("quick-dialog").close();
    toast("기록을 추가했습니다.");
    render();
  });

  document.querySelectorAll("[data-route]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      routeTo(link.dataset.route);
    });
  });
  document.getElementById("mobile-menu").addEventListener("click", () => document.body.classList.toggle("menu-open"));
  document.getElementById("mobile-scrim").addEventListener("click", () => document.body.classList.remove("menu-open"));
  window.addEventListener("hashchange", () => {
    state.route = location.hash.replace("#", "") || "dashboard";
    render();
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      document.getElementById("quick-dialog").showModal();
    }
  });

  document.documentElement.style.setProperty("--accent", state.settings.accent);
  refreshPRs();
  render();
  checkSync();
})();
