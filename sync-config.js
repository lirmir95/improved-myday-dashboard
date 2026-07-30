/*
 * Public runtime configuration.
 * Never place a Notion token in this file.
 * Set apiBase to the deployed Worker URL, or enter it in the in-app sync panel.
 */
window.MYDAY_NOTION_SYNC = Object.assign({
  apiBase: "",
  autoSync: true
}, window.MYDAY_NOTION_SYNC || {});
