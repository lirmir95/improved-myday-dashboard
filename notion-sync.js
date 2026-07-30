(function () {
  "use strict";

  const DAY_KEY = "myday_v5";
  const PROJECT_KEY = "my_project_dashboard_v1";
  const API_KEY = "myday_notion_api_base_v1";
  const QUEUE_KEY = "myday_notion_sync_queue_v1";
  const state = { timer: null, flushing: false };

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || "") || fallback; }
    catch (_) { return fallback; }
  }

  function apiBase() {
    return String(localStorage.getItem(API_KEY) || window.MYDAY_NOTION_SYNC?.apiBase || "")
      .trim()
      .replace(/\/+$/, "");
  }

  function setStatus(next, label) {
    document.querySelectorAll(".notion-sync-pill").forEach((pill) => {
      pill.dataset.state = next;
      pill.textContent = label;
    });
  }

  function currentDayKey() {
    const label = document.getElementById("myday-day-lbl")?.textContent || "";
    const match = label.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (match) return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function currentMonthKey() {
    const label = document.getElementById("project-month-lbl")?.textContent || "";
    const match = label.match(/(\d{4})\D+(\d{1,2})/);
    if (match) return `${match[1]}-${String(match[2]).padStart(2, "0")}`;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function queue(request) {
    const items = readJson(QUEUE_KEY, []);
    const next = items.filter((item) => item.key !== request.key);
    next.push(request);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(next.slice(-100)));
  }

  async function send(path, body, key) {
    const base = apiBase();
    if (!base) {
      setStatus("local", "Local only");
      return { queued: false, localOnly: true };
    }

    setStatus("syncing", "Syncing");
    try {
      const response = await fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
      setStatus("ok", "Notion saved");
      return await response.json();
    } catch (error) {
      queue({ path, body, key, queuedAt: new Date().toISOString() });
      setStatus("error", "Sync queued");
      throw error;
    }
  }

  async function flushQueue() {
    if (state.flushing || !apiBase() || !navigator.onLine) return;
    const items = readJson(QUEUE_KEY, []);
    if (!items.length) return;
    state.flushing = true;
    const failed = [];
    for (const item of items) {
      try {
        const response = await fetch(apiBase() + item.path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.body)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch (_) {
        failed.push(item);
      }
    }
    localStorage.setItem(QUEUE_KEY, JSON.stringify(failed));
    state.flushing = false;
    setStatus(failed.length ? "error" : "ok", failed.length ? "Sync queued" : "Notion saved");
  }

  function syncDay(dateKey) {
    const records = readJson(DAY_KEY, {});
    const record = records[dateKey];
    if (!record) return Promise.resolve({ skipped: true });
    return send("/v1/day/upsert", { date: dateKey, record }, `day:${dateKey}`);
  }

  function syncProject(monthKey) {
    const records = readJson(PROJECT_KEY, {});
    const record = records[monthKey];
    if (!record) return Promise.resolve({ skipped: true });
    return send("/v1/project/month/upsert", { month: monthKey, record }, `project:${monthKey}`);
  }

  function backupConvert(dateKey, content) {
    return send("/v1/convert/upsert", {
      date: dateKey,
      type: "Daily Diary",
      content,
      dayRecord: readJson(DAY_KEY, {})[dateKey] || null
    }, `convert:${dateKey}`);
  }

  function debounceProjectSync() {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      syncProject(currentMonthKey()).catch(() => {});
    }, 900);
  }

  function installHooks() {
    if (typeof window.doSave === "function" && !window.doSave.__notionWrapped) {
      const originalSave = window.doSave;
      const wrappedSave = function () {
        const result = originalSave.apply(this, arguments);
        syncDay(currentDayKey()).catch(() => {});
        return result;
      };
      wrappedSave.__notionWrapped = true;
      window.doSave = wrappedSave;
    }

    if (typeof window.doConvert === "function" && !window.doConvert.__notionWrapped) {
      const originalConvert = window.doConvert;
      const originalSave = window.doSave;
      const wrappedConvert = function () {
        const result = originalConvert.apply(this, arguments);
        if (typeof originalSave === "function") originalSave();
        const dateKey = currentDayKey();
        const content = document.querySelector("#sum-box .sum-txt")?.textContent || "";
        if (content) backupConvert(dateKey, content).catch(() => {});
        return result;
      };
      wrappedConvert.__notionWrapped = true;
      window.doConvert = wrappedConvert;
    }

    window.addEventListener("myproject:changed", debounceProjectSync);
  }

  function mountStatus(rootId) {
    const header = document.querySelector(`#${rootId} .rcpt-hd`);
    if (!header || header.querySelector(".notion-sync-pill")) return;
    const pill = document.createElement("span");
    pill.className = "notion-sync-pill";
    pill.dataset.state = apiBase() ? "syncing" : "local";
    pill.textContent = apiBase() ? "Checking Notion" : "Local only";
    header.appendChild(pill);
  }

  function mountPanel(rootId, statusId) {
    const status = document.querySelector(`#${rootId} #${statusId}`);
    const parent = status?.parentElement;
    if (!parent || parent.querySelector(".notion-sync-panel")) return;
    const panel = document.createElement("div");
    panel.className = "notion-sync-panel";
    panel.innerHTML = `
      <div class="notion-sync-panel__title">NOTION SYNC</div>
      <div class="notion-sync-panel__row">
        <input type="url" aria-label="Notion sync API URL" placeholder="https://your-worker.workers.dev">
        <button type="button">TEST</button>
      </div>
      <div class="notion-sync-panel__help">Notion 토큰은 브라우저에 저장하지 않습니다. 배포한 Worker URL만 입력하세요.</div>`;
    const input = panel.querySelector("input");
    const button = panel.querySelector("button");
    input.value = apiBase();
    input.addEventListener("change", () => {
      localStorage.setItem(API_KEY, input.value.trim().replace(/\/+$/, ""));
      setStatus(input.value.trim() ? "syncing" : "local", input.value.trim() ? "Checking Notion" : "Local only");
    });
    button.addEventListener("click", async () => {
      localStorage.setItem(API_KEY, input.value.trim().replace(/\/+$/, ""));
      if (!apiBase()) return setStatus("local", "Local only");
      setStatus("syncing", "Checking Notion");
      try {
        const response = await fetch(apiBase() + "/health");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setStatus("ok", "Notion ready");
        flushQueue();
      } catch (_) {
        setStatus("error", "Check URL");
      }
    });
    parent.appendChild(panel);
  }

  function init() {
    mountStatus("myday-root");
    mountStatus("project-root");
    mountPanel("myday-root", "backup-status");
    mountPanel("project-root", "project-backup-status");
    installHooks();
    if (apiBase()) {
      fetch(apiBase() + "/health")
        .then((response) => {
          if (!response.ok) throw new Error();
          setStatus("ok", "Notion ready");
          flushQueue();
        })
        .catch(() => setStatus("error", "Check URL"));
    }
  }

  window.addEventListener("online", flushQueue);
  window.addEventListener("load", init);
  window.MyDayNotionSync = { syncDay, syncProject, backupConvert, flushQueue, apiBase };
})();
