# Notion sync setup

The app keeps local-first behavior and sends only **MY DAY**, **MY PROJECT**, and
**CONVERT** data to Notion through a Cloudflare Worker. The Notion token never
reaches the browser.

## Created Notion data sources

| Purpose | Data source ID |
| --- | --- |
| Daily records | `1b336425-b49c-49ac-a07c-e1dc198f15f4` |
| Monthly project records | `f69965e6-096a-481f-b3f1-169956aaf87a` |
| Individual projects | `7e70f2f8-f29a-407c-a7fa-46dd30f4285b` |
| Converted date archive | `a7652cd5-45e4-4a6f-9f3c-e37587682cdc` |

Workspace page:
<https://app.notion.com/p/3ad6dc41031e811287efd8cc3df34e5b>

## One-time deployment

1. Create a Notion internal integration with read, insert, and update content
   capabilities.
2. Open the workspace page above and add the integration as a connection. The
   four child databases inherit the access.
3. From `worker/`, run `npm install`.
4. Store the secret with `npx wrangler secret put NOTION_TOKEN`.
5. Deploy with `npm run deploy`.
6. Enter the resulting `https://...workers.dev` URL in either in-app **NOTION
   SYNC** panel and press **TEST**.

Do not put `NOTION_TOKEN` in `sync-config.js`, GitHub Actions variables, or
browser storage.

## Sync behavior

- SAVE upserts one daily page using `myday:YYYY-MM-DD`.
- Project changes are debounced and upsert one monthly page plus its projects.
- CONVERT first saves the current day and then upserts one archive entry using
  `convert:Daily Diary:YYYY-MM-DD`.
- Repeating SAVE or CONVERT for the same date updates the existing Notion page.
- Offline writes stay in a browser queue and retry when the network returns.
