import type { StreamOverlayPage } from '../../shared/stream-overlay'

// Why plain HTML/JS strings: OBS loads these in its own browser, outside the renderer bundle.
const STYLES = `
:root { color-scheme: dark; }
html, body { margin: 0; background: transparent; overflow: hidden; }
body {
  font: 600 22px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9), 0 0 6px rgba(0, 0, 0, 0.6);
}
#root { position: fixed; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; gap: 6px; padding: 12px; }
.item { background: rgba(0, 0, 0, 0.45); border-radius: 10px; padding: 6px 12px; overflow-wrap: anywhere; transition: opacity 0.6s; }
.item.faded { opacity: 0; }
.name { font-weight: 800; }
.action { font-style: italic; }
.agents { justify-content: flex-start; }
.agent { display: flex; align-items: center; gap: 10px; }
.dot { width: 12px; height: 12px; border-radius: 50%; flex: none; }
.state-working .dot { background: #4ade80; animation: pulse 1.4s ease-in-out infinite; }
.state-blocked .dot, .state-waiting .dot { background: #fbbf24; }
.state-done .dot { background: #94a3b8; }
.meta { opacity: 0.75; font-weight: 500; }
.offline { opacity: 0.6; font-weight: 500; }
@keyframes pulse { 50% { opacity: 0.35; } }
`

const SCRIPT = `
(() => {
  const params = new URLSearchParams(location.search)
  const page = document.body.dataset.page
  const root = document.getElementById('root')
  const maxItems = Math.max(1, Math.min(50, Number(params.get('max')) || 12))
  const fadeSeconds = Math.max(0, Number(params.get('fade')) || 0)
  const shown = new Map()
  let agents = []

  const el = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  const renderChat = (data) => {
    const keep = new Set(data.messages.slice(-maxItems).map((m) => m.id))
    for (const [id, node] of shown) {
      if (!keep.has(id)) { node.remove(); shown.delete(id) }
    }
    for (const message of data.messages.slice(-maxItems)) {
      if (shown.has(message.id)) continue
      const row = el('div', message.isAction ? 'item action' : 'item')
      const name = el('span', 'name', message.name)
      if (message.color) name.style.color = message.color
      row.append(name, document.createTextNode(message.isAction ? ' ' + message.text : ': ' + message.text))
      root.append(row)
      shown.set(message.id, row)
      if (fadeSeconds > 0) setTimeout(() => row.classList.add('faded'), fadeSeconds * 1000)
    }
  }

  const label = { working: 'Working', blocked: 'Needs input', waiting: 'Needs input', done: 'Done' }
  const title = (name) => name.charAt(0).toUpperCase() + name.slice(1)
  const elapsed = (since) => {
    const s = Math.max(0, Math.floor((Date.now() - since) / 1000))
    return s < 60 ? s + 's' : Math.floor(s / 60) + 'm'
  }
  const renderAgents = () => {
    root.replaceChildren()
    for (const agent of agents.slice(0, maxItems)) {
      const row = el('div', 'item agent state-' + agent.state)
      const text = el('span')
      text.append(el('span', 'name', title(agent.agent)), document.createTextNode(' ' + label[agent.state]))
      if (agent.tool) text.append(el('span', 'meta', ' · ' + agent.tool))
      text.append(el('span', 'meta', ' · ' + elapsed(agent.since)))
      row.append(el('span', 'dot'), text)
      root.append(row)
    }
  }

  const source = new EventSource('/overlay/events' + location.search)
  if (page === 'chat') {
    source.addEventListener('chat', (event) => renderChat(JSON.parse(event.data)))
  } else {
    root.classList.add('agents')
    source.addEventListener('agents', (event) => { agents = JSON.parse(event.data).agents; renderAgents() })
    setInterval(renderAgents, 1000)
  }
})()
`

export function renderStreamOverlayPage(page: StreamOverlayPage): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Orca ${page} overlay</title>
<style>${STYLES}</style>
</head>
<body data-page="${page}">
<div id="root"></div>
<script src="/overlay/overlay.js"></script>
</body>
</html>`
}

export const STREAM_OVERLAY_SCRIPT = SCRIPT
