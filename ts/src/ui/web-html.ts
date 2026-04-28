export interface DashboardHtmlOptions {
  projectLabel: string;
  maxConcurrent: number;
}

/**
 * Self-contained dashboard HTML. Uses fetch + EventSource to consume
 * /api/v1/state and /api/v1/stream — no build step, no framework.
 *
 * The client-side JS uses DOM APIs (createElement / textContent) rather than
 * innerHTML for dynamic content, so untrusted issue titles cannot inject
 * markup into the page.
 */
export function renderDashboardHtml(opts: DashboardHtmlOptions): string {
  const escaped = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Symphony — ${escaped(opts.projectLabel)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: #0d1117;
    --panel: #161b22;
    --fg: #c9d1d9;
    --muted: #8b949e;
    --accent: #d29922;
    --accent2: #58a6ff;
    --good: #3fb950;
    --bad: #f85149;
    --warn: #d29922;
  }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font: 13px/1.4 ui-monospace, "JetBrains Mono", "Menlo", monospace;
    padding: 24px;
  }
  h1 { font-size: 14px; letter-spacing: 0.1em; margin: 0 0 16px 0; color: var(--fg); }
  .header { margin-bottom: 24px; }
  .header div { padding: 2px 0; }
  .header b { color: var(--fg); }
  .header span { color: var(--accent); }
  .section-label { color: var(--muted); margin: 16px 0 6px 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 4px 12px 4px 0; font-weight: 400; vertical-align: top; }
  th { color: var(--muted); border-bottom: 1px solid #30363d; padding-bottom: 6px; }
  td.id { width: 22ch; }
  td.stage { width: 14ch; }
  td.age { width: 14ch; color: var(--muted); }
  td.tokens { width: 12ch; text-align: right; padding-right: 24px; }
  td.session { width: 16ch; color: var(--muted); }
  td.event { color: var(--muted); }
  .stage-running { color: var(--good); }
  .stage-starting { color: var(--accent2); }
  .stage-failed { color: var(--bad); }
  .stage-stopped { color: var(--warn); }
  .stage-completed { color: var(--fg); }
  .errors { margin-top: 24px; }
  .errors div { color: var(--bad); padding: 2px 0; }
  .empty { color: var(--muted); padding: 8px 0; }
</style>
</head>
<body>
<h1>SYMPHONY STATUS</h1>
<div class="header" id="header">
  <div><b>Agents:</b> <span id="agents">—</span></div>
  <div><b>Throughput:</b> <span id="throughput">—</span></div>
  <div><b>Runtime:</b> <span id="runtime">—</span></div>
  <div><b>Tokens:</b> <span id="tokens">—</span></div>
  <div><b>Project:</b> <span id="project">${escaped(opts.projectLabel)}</span></div>
  <div><b>Next refresh:</b> <span id="next-refresh">—</span></div>
</div>

<div class="section-label">─ Running</div>
<table id="runs-table">
  <thead><tr>
    <th>ID</th><th>STAGE</th><th>AGE/TURN</th><th>TOKENS</th><th>SESSION</th><th>EVENT</th>
  </tr></thead>
  <tbody id="runs-body"></tbody>
</table>

<div class="section-label" id="errors-label" hidden>─ Recent errors</div>
<div class="errors" id="errors"></div>

<script>
const fmtNum = (n) => Number(n).toLocaleString("en-US");

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

function buildCell(text, className) {
  const td = document.createElement("td");
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function buildRunRow(r) {
  const tr = document.createElement("tr");
  tr.appendChild(buildCell(r.identifier ?? "", "id"));
  tr.appendChild(buildCell(r.stage ?? "", "stage stage-" + r.stage));
  tr.appendChild(buildCell((r.ageFormatted ?? "") + " / " + r.turnNumber, "age"));
  tr.appendChild(buildCell(fmtNum(r.tokens.total ?? 0), "tokens"));
  tr.appendChild(buildCell(r.sessionShort ?? "—", "session"));
  tr.appendChild(buildCell(r.lastEventSummary ?? "—", "event"));
  return tr;
}

function buildEmptyRow() {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = 6;
  td.className = "empty";
  td.textContent = "No active runs";
  tr.appendChild(td);
  return tr;
}

function applyState(s) {
  setText("agents", s.agentsActive + "/" + s.agentsMax);
  setText("throughput", fmtNum(s.throughputTps) + " tps");
  setText("runtime", s.runtimeFormatted);
  setText(
    "tokens",
    "in " + fmtNum(s.totalTokens.input) +
    " | out " + fmtNum(s.totalTokens.output) +
    " | total " + fmtNum(s.totalTokens.total),
  );
  setText("next-refresh", Math.round(s.nextRefreshMs / 1000) + "s");
  setText("project", s.projectLabel);

  const body = document.getElementById("runs-body");
  while (body.firstChild) body.removeChild(body.firstChild);
  if (!s.runs || s.runs.length === 0) {
    body.appendChild(buildEmptyRow());
  } else {
    for (const r of s.runs) body.appendChild(buildRunRow(r));
  }

  const errorsLabel = document.getElementById("errors-label");
  const errors = document.getElementById("errors");
  while (errors.firstChild) errors.removeChild(errors.firstChild);
  if (s.recentErrors && s.recentErrors.length > 0) {
    errorsLabel.hidden = false;
    for (const err of s.recentErrors.slice(-5)) {
      const div = document.createElement("div");
      div.textContent = err;
      errors.appendChild(div);
    }
  } else {
    errorsLabel.hidden = true;
  }
}

const es = new EventSource("/api/v1/stream");
es.addEventListener("state", (e) => {
  try { applyState(JSON.parse(e.data)); } catch (err) { /* ignore */ }
});
es.addEventListener("error", () => {
  // EventSource auto-reconnects; nothing to do here.
});
</script>
</body>
</html>`;
}
