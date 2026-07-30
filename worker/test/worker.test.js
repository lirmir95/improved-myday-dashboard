import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const env = {
  NOTION_TOKEN: "test-token",
  NOTION_VERSION: "2026-03-11",
  DAY_DATA_SOURCE_ID: "day-source",
  PROJECT_MONTH_DATA_SOURCE_ID: "month-source",
  PROJECT_DATA_SOURCE_ID: "project-source",
  CONVERT_DATA_SOURCE_ID: "convert-source",
  ALLOWED_ORIGIN: "https://lirmir95.github.io"
};

test("health exposes readiness without leaking secrets", async () => {
  const response = await worker.fetch(new Request("https://worker.test/health", {
    headers: { Origin: "https://lirmir95.github.io" }
  }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://lirmir95.github.io");
  const payload = await response.json();
  assert.deepEqual(payload, {
    ok: true,
    service: "myday-notion-sync",
    notionVersion: "2026-03-11"
  });
  assert.equal(JSON.stringify(payload).includes(env.NOTION_TOKEN), false);
});

test("day upsert uses a deterministic date key and creates a data-source page", async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/data_sources/day-source/query")) return Response.json({ results: [] });
    if (String(url).endsWith("/pages")) return Response.json({ id: "new-page" });
    if (String(url).includes("/blocks/new-page/children")) return Response.json({ results: [] });
    return Response.json({ message: "unexpected call" }, { status: 500 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await worker.fetch(new Request("https://worker.test/v1/day/upsert", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://lirmir95.github.io"
    },
    body: JSON.stringify({
      date: "2026-07-30",
      record: {
        waterCount: 4,
        starRating: 5,
        hourMoods: { 9: ["good"] },
        finRows: [{ type: "expense", amt: "12000" }]
      }
    })
  }), env);

  assert.equal(response.status, 200);
  const queryBody = JSON.parse(calls[0].init.body);
  assert.equal(queryBody.filter.rich_text.equals, "myday:2026-07-30");
  const createBody = JSON.parse(calls[1].init.body);
  assert.equal(createBody.parent.data_source_id, "day-source");
  assert.equal(createBody.properties.Expense.number, 12000);
});
