const NOTION_API = "https://api.notion.com/v1";

function corsHeaders(origin, env) {
  const allowed = env.ALLOWED_ORIGIN || "*";
  const value = allowed === "*" || origin === allowed ? origin || "*" : allowed;
  return {
    "Access-Control-Allow-Origin": value,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function json(data, status, origin, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin, env) }
  });
}

function requireEnv(env) {
  const names = [
    "NOTION_TOKEN",
    "DAY_DATA_SOURCE_ID",
    "PROJECT_MONTH_DATA_SOURCE_ID",
    "PROJECT_DATA_SOURCE_ID",
    "CONVERT_DATA_SOURCE_ID"
  ];
  const missing = names.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
}

async function notion(env, path, init = {}) {
  const response = await fetch(NOTION_API + path, {
    ...init,
    headers: {
      "Authorization": `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": env.NOTION_VERSION || "2026-03-11",
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Notion API ${response.status}`);
  return data;
}

function richText(content) {
  return [{ type: "text", text: { content: String(content || "").slice(0, 2000) } }];
}

function title(content) {
  return { title: richText(content) };
}

function text(content) {
  return { rich_text: richText(content) };
}

function date(start) {
  return { date: start ? { start } : null };
}

function select(name) {
  return { select: name ? { name } : null };
}

function number(value) {
  const parsed = Number(value);
  return { number: Number.isFinite(parsed) ? parsed : null };
}

function relation(ids) {
  return { relation: (ids || []).filter(Boolean).map((id) => ({ id })) };
}

async function findBySyncKey(env, dataSourceId, syncKey) {
  const result = await notion(env, `/data_sources/${dataSourceId}/query`, {
    method: "POST",
    body: JSON.stringify({
      page_size: 1,
      filter: { property: "Sync Key", rich_text: { equals: syncKey } }
    })
  });
  return result.results?.[0] || null;
}

async function upsertPage(env, dataSourceId, syncKey, properties) {
  const existing = await findBySyncKey(env, dataSourceId, syncKey);
  if (existing) {
    return notion(env, `/pages/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ properties })
    });
  }
  return notion(env, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      properties
    })
  });
}

function chunks(value, size = 1800) {
  const source = String(value || "");
  const result = [];
  for (let index = 0; index < source.length; index += size) result.push(source.slice(index, index + size));
  return result.length ? result : [""];
}

async function replacePageContent(env, pageId, heading, content, language = "plain text") {
  const children = await notion(env, `/blocks/${pageId}/children?page_size=100`);
  for (const block of children.results || []) {
    await notion(env, `/blocks/${block.id}`, { method: "DELETE" });
  }
  const blocks = [
    { object: "block", type: "heading_2", heading_2: { rich_text: richText(heading) } },
    ...chunks(content).map((part) => ({
      object: "block",
      type: "code",
      code: { language, rich_text: richText(part) }
    }))
  ];
  await notion(env, `/blocks/${pageId}/children`, {
    method: "PATCH",
    body: JSON.stringify({ children: blocks })
  });
}

function dayTotals(record) {
  return (record.finRows || []).reduce((totals, row) => {
    const amount = Number(String(row.amt || "").replace(/,/g, "")) || 0;
    if (row.type === "income") totals.income += amount;
    else if (row.type === "expense") totals.expense += amount;
    return totals;
  }, { income: 0, expense: 0 });
}

function dayMood(record) {
  const values = Object.values(record.hourMoods || {}).flat().filter(Boolean);
  return [...new Set(values)].slice(0, 8).join(", ");
}

function projectProgress(project) {
  const steps = project.steps || [];
  if (!steps.length) return Number(project.progress) || 0;
  return Math.round((steps.filter((step) => step.done).length / steps.length) * 100);
}

function projectStatus(project) {
  if (project.done || project.status === "done" || project.status === "완료") return "Done";
  if (String(project.status || "").toLowerCase().includes("block")) return "Blocked";
  return project.title || project.name ? "Active" : "Idea";
}

async function upsertDay(env, payload) {
  const { date: recordDate, record } = payload;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate || "") || !record) throw new Error("Invalid day payload");
  const syncKey = `myday:${recordDate}`;
  const totals = dayTotals(record);
  const page = await upsertPage(env, env.DAY_DATA_SOURCE_ID, syncKey, {
    "Day": title(recordDate),
    "Record Date": date(recordDate),
    "Sync Key": text(syncKey),
    "Mood": text(dayMood(record)),
    "Water": number(record.waterCount),
    "Rating": number(record.starRating),
    "Income": number(totals.income),
    "Expense": number(totals.expense),
    "Status": select(record.summary ? "Converted" : "Saved"),
    "Source": select("Web App"),
    "Synced At": date(new Date().toISOString())
  });
  await replacePageContent(env, page.id, "Daily record snapshot", JSON.stringify(record, null, 2), "json");
  return page;
}

async function upsertProjectMonth(env, payload) {
  const { month, record } = payload;
  if (!/^\d{4}-\d{2}$/.test(month || "") || !record) throw new Error("Invalid project payload");
  const syncKey = `project-month:${month}`;
  const projects = record.projects || [];
  const progress = projects.length
    ? Math.round(projects.reduce((sum, item) => sum + projectProgress(item), 0) / projects.length)
    : 0;
  const monthPage = await upsertPage(env, env.PROJECT_MONTH_DATA_SOURCE_ID, syncKey, {
    "Month": title(month),
    "Month Date": date(`${month}-01`),
    "Sync Key": text(syncKey),
    "Focus": text(record.focus),
    "Note": text(record.note),
    "Progress": number(progress),
    "Status": select("Active"),
    "Synced At": date(new Date().toISOString())
  });
  await replacePageContent(env, monthPage.id, "Monthly record snapshot", JSON.stringify(record, null, 2), "json");

  for (let index = 0; index < projects.length; index += 1) {
    const project = projects[index];
    const projectId = String(project.id || `${month}-${index + 1}`);
    const projectKey = `project:${month}:${projectId}`;
    await upsertPage(env, env.PROJECT_DATA_SOURCE_ID, projectKey, {
      "Project": title(project.name || project.title || `Project ${index + 1}`),
      "Sync Key": text(projectKey),
      "Project ID": text(projectKey),
      "Month Key": text(month),
      "Category": { multi_select: project.category ? [{ name: String(project.category).replace(/^#/, "") }] : [] },
      "Status": select(projectStatus(project)),
      "Progress": number(projectProgress(project)),
      "Due Date": date(project.hasDue ? project.due : project.dueDate || null),
      "Next Action": text(project.next || (project.steps || []).find((step) => !step.done)?.text || ""),
      "Sort Order": number(index),
      "Synced At": date(new Date().toISOString()),
      "Month Record": relation([monthPage.id])
    });
  }
  return monthPage;
}

async function upsertConvert(env, payload) {
  const { date: recordDate, type = "Daily Diary", content, dayRecord } = payload;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate || "") || !content) throw new Error("Invalid convert payload");
  let dayPage = await findBySyncKey(env, env.DAY_DATA_SOURCE_ID, `myday:${recordDate}`);
  if (!dayPage && dayRecord) dayPage = await upsertDay(env, { date: recordDate, record: dayRecord });
  const syncKey = `convert:${type}:${recordDate}`;
  const page = await upsertPage(env, env.CONVERT_DATA_SOURCE_ID, syncKey, {
    "Archive": title(`${recordDate} · ${type}`),
    "Record Date": date(recordDate),
    "Type": select(type),
    "Sync Key": text(syncKey),
    "Content Preview": text(String(content).slice(0, 500)),
    "Source": select("Web App"),
    "Generated At": date(new Date().toISOString()),
    "Day Record": relation(dayPage ? [dayPage.id] : [])
  });
  await replacePageContent(env, page.id, "Converted output", content);
  return page;
}

async function route(request, env) {
  requireEnv(env);
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return { ok: true, service: "myday-notion-sync", notionVersion: env.NOTION_VERSION || "2026-03-11" };
  }
  if (request.method !== "POST") throw new Error("Method not allowed");
  const body = await request.json();
  if (url.pathname === "/v1/day/upsert") return { ok: true, page: (await upsertDay(env, body)).id };
  if (url.pathname === "/v1/project/month/upsert") return { ok: true, page: (await upsertProjectMonth(env, body)).id };
  if (url.pathname === "/v1/convert/upsert") return { ok: true, page: (await upsertConvert(env, body)).id };
  throw new Error("Not found");
}

export { route, upsertDay, upsertProjectMonth, upsertConvert, findBySyncKey };

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }
    try {
      return json(await route(request, env), 200, origin, env);
    } catch (error) {
      const status = error.message === "Not found" ? 404 : error.message === "Method not allowed" ? 405 : 400;
      return json({ ok: false, error: error.message }, status, origin, env);
    }
  }
};
