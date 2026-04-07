import type { ItemRecord } from "../types";

function renderActionForms(item: ItemRecord, token: string) {
  const actions: string[] = [];
  if (item.status === "failed") {
    actions.push(`
      <form method="POST" action="/items/${encodeURIComponent(item.id)}/retry" class="inline-form">
        <input type="hidden" name="token" value="${escapeAttr(token)}" />
        <button type="submit">Retry</button>
      </form>
    `);
  }
  if (["saved", "duplicate", "failed"].includes(item.status)) {
    actions.push(`
      <form method="POST" action="/items/${encodeURIComponent(item.id)}/refetch" class="inline-form">
        <input type="hidden" name="token" value="${escapeAttr(token)}" />
        <button type="submit">Refetch</button>
      </form>
    `);
  }
  return actions.length ? `<div class="actions">${actions.join("")}</div>` : "";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function renderMetaList(item: ItemRecord) {
  const bits = [
    item.author ? `Author: ${escapeHtml(item.author)}` : null,
    item.sourceDomain ? `Source: ${escapeHtml(item.sourceDomain)}` : null,
    item.calibreBookId ? `Calibre ID: ${item.calibreBookId}` : null,
    item.duplicateOfItemId ? `Duplicate of: <code>${escapeHtml(item.duplicateOfItemId)}</code>` : null,
    item.refetchCount > 0 ? `Refetches: ${item.refetchCount}` : null,
  ].filter(Boolean);

  if (bits.length === 0) return "<span class=\"muted\">—</span>";
  return `<ul>${bits.map((bit) => `<li>${bit}</li>`).join("")}</ul>`;
}

function renderUrlBlock(item: ItemRecord) {
  const rows = [
    ["Submitted", item.submittedUrl],
    ["Canonical", item.canonicalUrl],
    ["Fallback", item.fallbackUrl],
    ["Stored", item.calibreBookPath],
  ].filter(([, value]) => Boolean(value));

  return rows.map(([label, value]) => `
    <div><strong>${label}:</strong> ${renderLinkish(value!)}</div>
  `).join("");
}

function renderLinkish(value: string) {
  if (/^https?:\/\//.test(value)) {
    return `<a href="${escapeAttr(value)}">${escapeHtml(value)}</a>`;
  }
  return `<code>${escapeHtml(value)}</code>`;
}

function renderTimestampBlock(item: ItemRecord) {
  return `
    <ul>
      <li>Created: ${escapeHtml(formatDate(item.createdAt))}</li>
      <li>Updated: ${escapeHtml(formatDate(item.updatedAt))}</li>
      <li>Attempted: ${escapeHtml(formatDate(item.lastAttemptedAt))}</li>
      <li>Saved: ${escapeHtml(formatDate(item.lastSavedAt))}</li>
      <li>Refetched: ${escapeHtml(formatDate(item.lastRefetchedAt))}</li>
    </ul>
  `;
}

export function renderItemsPage(items: ItemRecord[], token: string) {
  const rows = items.map((item) => `
    <tr>
      <td>
        <strong class="status status-${escapeAttr(item.status)}">${escapeHtml(item.status)}</strong>
        ${item.queued ? '<div class="muted">queued</div>' : ""}
      </td>
      <td>
        <div><strong><a href="/items/${encodeURIComponent(item.id)}">${escapeHtml(item.title ?? item.submittedUrl)}</a></strong></div>
        <div class="muted"><code>${escapeHtml(item.id)}</code></div>
        ${renderMetaList(item)}
        ${renderActionForms(item, token)}
      </td>
      <td>${renderUrlBlock(item)}</td>
      <td>${renderTimestampBlock(item)}</td>
      <td>${item.lastError ? `<pre>${escapeHtml(item.lastError)}</pre>` : '<span class="muted">—</span>'}</td>
    </tr>
  `).join("\n");

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Read-later queue</title>
      <style>
        body { font-family: system-ui, sans-serif; margin: 2rem; color: #222; }
        table { border-collapse: collapse; width: 100%; table-layout: fixed; }
        td, th { border: 1px solid #ccc; padding: 0.6rem; vertical-align: top; text-align: left; }
        th { background: #f6f6f6; }
        code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        pre { white-space: pre-wrap; margin: 0; }
        ul { margin: 0.35rem 0 0 1.2rem; padding: 0; }
        .muted { color: #666; font-size: 0.92em; }
        .status { text-transform: uppercase; letter-spacing: 0.04em; font-size: 0.85em; }
        .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem; }
        .inline-form { display: inline; }
        button { border: 1px solid #bbb; border-radius: 0.35rem; background: #f6f6f6; padding: 0.3rem 0.65rem; cursor: pointer; }
        .status-saved { color: #0a6; }
        .status-failed { color: #b00; }
        .status-duplicate { color: #955f00; }
        .status-fetching, .status-building, .status-queued, .status-fallback { color: #2457c5; }
      </style>
    </head>
    <body>
      <h1>Read-later queue</h1>
      <p><a href="/bookmarklet">Install bookmarklet</a></p>
      <p class="muted">${items.length} item(s)</p>
      <table>
        <thead>
          <tr>
            <th style="width: 9rem">Status</th>
            <th style="width: 20rem">Item</th>
            <th>URLs / storage</th>
            <th style="width: 16rem">Timestamps</th>
            <th style="width: 18rem">Error</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </body>
  </html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: string) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

export function renderBookmarkletPage(baseUrl: string, token: string) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/save`;
  const itemsUrl = `${baseUrl.replace(/\/$/, "")}/items`;
  const bookmarklet = `javascript:(()=>{const f=document.createElement('form');f.method='POST';f.action=${JSON.stringify(endpoint)};f.target='_blank';const add=(n,v)=>{const i=document.createElement('input');i.type='hidden';i.name=n;i.value=v;f.appendChild(i);};add('url',location.href);add('token',${JSON.stringify(token)});document.body.appendChild(f);f.submit();f.remove();setTimeout(()=>window.open(${JSON.stringify(itemsUrl)},'_blank'),300);})();`;

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Install bookmarklet</title>
      <style>
        body { font-family: system-ui, sans-serif; margin: 2rem; color: #222; max-width: 60rem; }
        code, textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        textarea { width: 100%; min-height: 12rem; }
        .bookmarklet { display: inline-block; padding: 0.7rem 1rem; background: #2457c5; color: white; text-decoration: none; border-radius: 0.4rem; }
        .muted { color: #666; }
      </style>
    </head>
    <body>
      <h1>Install bookmarklet</h1>
      <p>Drag this link to your bookmarks bar:</p>
      <p><a class="bookmarklet" href="${escapeAttr(bookmarklet)}">Save to Read Later</a></p>
      <p class="muted">Base URL: <code>${escapeHtml(baseUrl)}</code></p>
      <p class="muted">It posts the current page URL to <code>/save</code> using a normal browser form submit, opens an acknowledgement page, and then opens the queue page.</p>
      <h2>Bookmarklet code</h2>
      <textarea readonly>${escapeHtml(bookmarklet)}</textarea>
      <p><a href="/items">Back to queue</a></p>
    </body>
  </html>`;
}
