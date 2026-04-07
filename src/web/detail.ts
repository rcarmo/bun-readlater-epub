import type { ItemDetailRecord } from "../types";

function renderActionForms(detail: ItemDetailRecord, token: string) {
  const { item } = detail;
  const actions: string[] = [];
  if (item.status === "failed") {
    actions.push(`
      <form method="POST" action="/items/${encodeURIComponent(item.id)}/retry" class="inline-form">
        <input type="hidden" name="token" value="${escapeHtml(token)}" />
        <button type="submit">Retry</button>
      </form>
    `);
  }
  if (["saved", "duplicate", "failed"].includes(item.status)) {
    actions.push(`
      <form method="POST" action="/items/${encodeURIComponent(item.id)}/refetch" class="inline-form">
        <input type="hidden" name="token" value="${escapeHtml(token)}" />
        <button type="submit">Refetch</button>
      </form>
    `);
  }
  return actions.length ? `<div class="actions">${actions.join("")}</div>` : "";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function renderValue(value: string | number | boolean | null) {
  if (value === null) return '<span class="muted">—</span>';
  if (typeof value === "boolean") return value ? "true" : "false";
  return escapeHtml(String(value));
}

export function renderItemDetailPage(detail: ItemDetailRecord, token: string) {
  const { item, attempts } = detail;
  const rows = [
    ["ID", `<code>${escapeHtml(item.id)}</code>`],
    ["Status", escapeHtml(item.status)],
    ["Submitted URL", renderValue(item.submittedUrl)],
    ["Canonical URL", renderValue(item.canonicalUrl)],
    ["Title", renderValue(item.title)],
    ["Author", renderValue(item.author)],
    ["Source domain", renderValue(item.sourceDomain)],
    ["Source URL", renderValue(item.sourceUrl)],
    ["Calibre book ID", renderValue(item.calibreBookId)],
    ["Calibre path", renderValue(item.calibreBookPath)],
    ["Fallback URL", renderValue(item.fallbackUrl)],
    ["Duplicate of", renderValue(item.duplicateOfItemId)],
    ["Content hash", renderValue(item.contentHash)],
    ["Unread", renderValue(item.unread)],
    ["Queued", renderValue(item.queued)],
    ["Refetch count", renderValue(item.refetchCount)],
    ["Created", escapeHtml(formatDate(item.createdAt))],
    ["Updated", escapeHtml(formatDate(item.updatedAt))],
    ["Attempted", escapeHtml(formatDate(item.lastAttemptedAt))],
    ["Saved", escapeHtml(formatDate(item.lastSavedAt))],
    ["Refetched", escapeHtml(formatDate(item.lastRefetchedAt))],
    ["Last error", item.lastError ? `<pre>${escapeHtml(item.lastError)}</pre>` : '<span class="muted">—</span>'],
  ];

  const attemptRows = attempts.map((attempt) => `
    <tr>
      <td><code>${escapeHtml(attempt.id)}</code></td>
      <td>${escapeHtml(attempt.attemptKind)}</td>
      <td>${escapeHtml(attempt.status)}</td>
      <td>${escapeHtml(formatDate(attempt.startedAt))}</td>
      <td>${escapeHtml(formatDate(attempt.finishedAt))}</td>
      <td>${attempt.message ? `<pre>${escapeHtml(attempt.message)}</pre>` : '<span class="muted">—</span>'}</td>
    </tr>
  `).join("\n");

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Item detail</title>
      <style>
        body { font-family: system-ui, sans-serif; margin: 2rem; color: #222; }
        table { border-collapse: collapse; width: 100%; table-layout: auto; }
        td, th { border: 1px solid #ccc; padding: 0.55rem; vertical-align: top; text-align: left; word-break: break-word; overflow-wrap: anywhere; }
        th { background: #f6f6f6; }
        code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        code { white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; }
        pre { white-space: pre-wrap; margin: 0; word-break: break-word; overflow-wrap: anywhere; }
        .muted { color: #666; }
        .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin: 1rem 0; }
        .inline-form { display: inline; }
        button { border: 1px solid #bbb; border-radius: 0.35rem; background: #f6f6f6; padding: 0.45rem 0.8rem; cursor: pointer; }
      </style>
    </head>
    <body>
      <p><a href="/items">← Back to queue</a></p>
      <h1>Item detail</h1>
      ${renderActionForms(detail, token)}
      <table>
        <tbody>
          ${rows.map(([label, value]) => `<tr><th style="width: 14rem">${label}</th><td>${value}</td></tr>`).join("\n")}
        </tbody>
      </table>
      <h2>Attempts</h2>
      <table>
        <thead>
          <tr><th>ID</th><th>Kind</th><th>Status</th><th>Started</th><th>Finished</th><th>Message</th></tr>
        </thead>
        <tbody>${attemptRows || '<tr><td colspan="6"><span class="muted">No attempts yet</span></td></tr>'}</tbody>
      </table>
      <p class="muted">JSON: <a href="/items/${encodeURIComponent(item.id)}?format=json">/items/${escapeHtml(item.id)}?format=json</a></p>
    </body>
  </html>`;
}

export function renderSaveAckPage(result: { id: string; status: string; message: string }, itemsUrl: string, itemUrl: string) {
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Saved to Read Later</title>
      <style>
        body { font-family: system-ui, sans-serif; margin: 2rem; color: #222; max-width: 42rem; }
        .card { border: 1px solid #ddd; border-radius: 0.75rem; padding: 1rem 1.2rem; background: #fafafa; }
        .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 1rem; }
        .button { display: inline-block; padding: 0.7rem 1rem; border-radius: 0.5rem; background: #2457c5; color: white; text-decoration: none; }
        .button.secondary { background: #666; }
        code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .muted { color: #666; }
      </style>
    </head>
    <body>
      <h1>Saved to Read Later</h1>
      <div class="card">
        <p><strong>Status:</strong> ${escapeHtml(result.status)}</p>
        <p><strong>Message:</strong> ${escapeHtml(result.message)}</p>
        <p><strong>Item ID:</strong> <code>${escapeHtml(result.id)}</code></p>
      </div>
      <div class="actions">
        <a class="button" href="${escapeHtml(itemUrl)}">Open item</a>
        <a class="button secondary" href="${escapeHtml(itemsUrl)}">Open queue</a>
      </div>
      <p class="muted">You can close this tab after the background job has been queued.</p>
    </body>
  </html>`;
}
