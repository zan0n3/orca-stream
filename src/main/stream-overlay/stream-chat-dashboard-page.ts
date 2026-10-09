import { TWITCH_CHAT_MAX_MESSAGE_LENGTH } from '../../shared/twitch-chat-types'

// Why a separate page: this is the streamer's own chat window (reader=1), not an OBS graphic.
const STYLES = `
:root {
  color-scheme: dark;
  --bg: #0e0e10; --panel: #18181b; --raised: #1f1f23; --line: #2f2f35;
  --text: #efeff1; --muted: #adadb8; --accent: #a970ff; --live: #eb0400; --error: #f87171;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); }
body { font: 500 17px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; display: flex; flex-direction: column; overflow: hidden; }
header { display: flex; align-items: center; gap: 16px; padding: 12px 18px; background: var(--panel); border-bottom: 1px solid var(--line); min-width: 0; }
.badge { flex: none; font: 700 13px/1 system-ui, sans-serif; letter-spacing: 0.06em; padding: 5px 8px; border-radius: 4px; background: var(--raised); color: var(--muted); }
.badge.live { background: var(--live); color: #fff; }
.heading { min-width: 0; flex: 1; }
.heading-top { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
#channel { font-weight: 700; font-size: 20px; }
#uptime, #connection, #category { color: var(--muted); font-size: 14px; }
#title { color: var(--muted); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#layout { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 320px; }
#chat-col { position: relative; display: flex; flex-direction: column; min-height: 0; min-width: 0; }
#messages { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 18px; }
.msg { padding: 3px 0; overflow-wrap: anywhere; }
.msg .name { font-weight: 700; }
.msg.action .text { font-style: italic; }
.empty { color: var(--muted); text-align: center; padding-top: 24px; font-size: 15px; }
#jump { position: absolute; left: 50%; bottom: 84px; transform: translateX(-50%); font: inherit; font-size: 14px; color: var(--text); background: var(--raised); border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; cursor: pointer; }
#jump[hidden] { display: none; }
#composer { padding: 10px 18px 14px; border-top: 1px solid var(--line); background: var(--panel); display: flex; flex-direction: column; gap: 4px; }
#composer input { font: inherit; color: var(--text); background: var(--raised); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; outline: none; }
#composer input:focus { border-color: var(--accent); }
#composer input:disabled { opacity: 0.6; }
#composer-status { font-size: 13px; color: var(--error); }
#composer-status:empty { display: none; }
aside { border-left: 1px solid var(--line); background: var(--panel); display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--line); border-bottom: 1px solid var(--line); }
.tile { background: var(--panel); padding: 12px 14px; }
.tile-value { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
.tile-label { color: var(--muted); font-size: 13px; }
.tile.viewers .tile-value { color: var(--accent); }
.section { padding: 12px 14px 4px; display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
#agents { padding: 0 14px 8px; display: flex; flex-direction: column; gap: 6px; font-size: 15px; }
.agent { display: flex; align-items: center; gap: 8px; min-width: 0; }
.agent .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: #94a3b8; }
.state-working .dot { background: #4ade80; animation: pulse 1.4s ease-in-out infinite; }
.state-blocked .dot, .state-waiting .dot { background: #fbbf24; }
.meta { color: var(--muted); }
#chatters { flex: 1; min-height: 0; overflow-y: auto; margin: 0; padding: 0 14px 12px; list-style: none; font-size: 15px; }
#chatters li { padding: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.note { color: var(--muted); font-size: 14px; padding: 0 14px 10px; }
.note:empty { display: none; }
@keyframes pulse { 50% { opacity: 0.35; } }
@media (max-width: 760px) {
  #layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  aside { order: -1; border-left: 0; border-bottom: 1px solid var(--line); max-height: 40vh; }
  .tiles { grid-template-columns: repeat(4, 1fr); }
}
`

const SCRIPT = `
(() => {
  const $ = (id) => document.getElementById(id)
  const el = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  const number = (value) => (value === null || value === undefined ? '–' : Number(value).toLocaleString())
  const duration = (since) => {
    const total = Math.max(0, Math.floor((Date.now() - since) / 1000))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    return h > 0 ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + 'm ' + String(s).padStart(2, '0') + 's'
  }
  // Why: Twitch lets viewers pick near-black name colors that vanish on a dark background.
  const readable = (hex) => {
    if (!hex) return '#bf94ff'
    const n = parseInt(hex.slice(1), 16)
    const r = n >> 16, g = (n >> 8) & 255, b = n & 255
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    if (luma >= 0.45) return hex
    const mix = (c) => Math.round(c + (255 - c) * 0.5)
    return 'rgb(' + mix(r) + ',' + mix(g) + ',' + mix(b) + ')'
  }

  const messages = $('messages')
  const jump = $('jump')
  let following = true
  const shown = new Map()
  const atBottom = () => messages.scrollHeight - messages.scrollTop - messages.clientHeight <= 24
  const toBottom = () => { messages.scrollTop = messages.scrollHeight }
  messages.addEventListener('scroll', () => { following = atBottom(); jump.hidden = following })
  jump.addEventListener('click', () => { following = true; jump.hidden = true; toBottom() })

  let channel = null
  const connectionText = { connecting: 'Connecting…', reconnecting: 'Reconnecting…', disabled: 'Chat off' }
  const renderChat = (data) => {
    if (data.channel !== channel) {
      channel = data.channel
      messages.replaceChildren()
      shown.clear()
    }
    $('channel').textContent = channel ? channel : 'No channel set'
    $('connection').textContent = connectionText[data.status] || ''
    const keep = new Set(data.messages.map((m) => m.id))
    for (const [id, node] of shown) {
      if (!keep.has(id)) { node.remove(); shown.delete(id) }
    }
    for (const message of data.messages) {
      if (shown.has(message.id)) continue
      const row = el('div', message.isAction ? 'msg action' : 'msg')
      const name = el('span', 'name', message.name)
      name.style.color = readable(message.color)
      row.append(name, el('span', 'text', message.isAction ? ' ' + message.text : ': ' + message.text))
      messages.append(row)
      shown.set(message.id, row)
    }
    const empty = messages.querySelector('.empty')
    if (shown.size === 0 && !empty) messages.append(el('div', 'empty', 'Waiting for messages…'))
    if (shown.size > 0 && empty) empty.remove()
    if (following) toBottom()
  }

  let stats = null
  const renderStats = () => {
    const live = Boolean(stats && stats.live)
    const badge = $('live-badge')
    badge.textContent = live ? 'LIVE' : 'OFFLINE'
    badge.classList.toggle('live', live)
    $('uptime').textContent = live && stats.startedAt ? duration(stats.startedAt) : ''
    $('title').textContent = (stats && stats.title) || ''
    $('category').textContent = (stats && stats.category) || ''
    $('viewers').textContent = live ? number(stats.viewerCount) : '–'
    $('followers').textContent = number(stats && stats.followerCount)
    $('chatter-total').textContent = number(stats && stats.chatterCount)
    $('session').textContent = live && stats.startedAt ? duration(stats.startedAt) : '–'
    const list = $('chatters')
    const note = $('chatters-note')
    if (!stats) {
      note.textContent = 'Sign in to Twitch in Orca settings to see viewers and who is in chat.'
      list.replaceChildren()
      return
    }
    if (!stats.chatters) {
      note.textContent = 'Twitch only shares the chatter list with the broadcaster and moderators.'
      list.replaceChildren()
      return
    }
    note.textContent = stats.chatters.length === 0 ? 'Nobody is in chat yet.' : ''
    const sorted = [...stats.chatters].sort((a, b) => a.localeCompare(b))
    list.replaceChildren(...sorted.map((login) => el('li', '', login)))
  }

  const agentLabel = { working: 'Working', blocked: 'Needs input', waiting: 'Needs input', done: 'Done' }
  const capitalize = (name) => name.charAt(0).toUpperCase() + name.slice(1)
  let agents = []
  const renderAgents = () => {
    const root = $('agents')
    if (agents.length === 0) {
      root.replaceChildren(el('div', 'meta', 'No agents running.'))
      return
    }
    root.replaceChildren(...agents.slice(0, 8).map((agent) => {
      const row = el('div', 'agent state-' + agent.state)
      const label = el('span', 'label')
      label.append(capitalize(agent.agent) + ' · ' + (agentLabel[agent.state] || agent.state))
      if (agent.tool) label.append(el('span', 'meta', ' · ' + agent.tool))
      label.append(el('span', 'meta', ' · ' + duration(agent.since)))
      row.append(el('span', 'dot'), label)
      return row
    }))
  }
  setInterval(() => { renderStats(); renderAgents() }, 1000)

  // Why: only Orca's chat window has this bridge (its preload); a plain browser tab stays read-only.
  const bridge = window.orcaStreamChat
  const form = $('composer')
  const input = $('composer-input')
  const status = $('composer-status')
  let signedIn = false
  let sending = false
  const applyAuth = (auth) => {
    signedIn = Boolean(bridge && auth && auth.state === 'signed-in')
    input.disabled = !signedIn || sending
    input.placeholder = signedIn
      ? 'Chat as ' + auth.login
      : bridge ? 'Sign in to Twitch in Orca settings to chat' : 'Open this from Orca to chat'
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const text = input.value.trim()
    if (!text || sending || !signedIn) return
    sending = true
    input.disabled = true
    status.textContent = ''
    try {
      const result = await bridge.send(text)
      if (result.ok) input.value = ''
      else status.textContent = result.error
    } catch {
      status.textContent = 'Could not send the message.'
    }
    sending = false
    input.disabled = !signedIn
    input.focus()
    following = true
    toBottom()
  })
  applyAuth(null)
  if (bridge) {
    bridge.onAuthChanged(applyAuth)
    bridge.getAuthState().then(applyAuth, () => {})
  }

  const source = new EventSource('/overlay/events' + location.search)
  source.addEventListener('chat', (event) => renderChat(JSON.parse(event.data)))
  source.addEventListener('stats', (event) => { stats = JSON.parse(event.data).stats; renderStats() })
  source.addEventListener('agents', (event) => { agents = JSON.parse(event.data).agents; renderAgents() })
  renderStats()
  renderAgents()
})()
`

export function renderStreamChatDashboardPage(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orca Stream Chat</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <span id="live-badge" class="badge">OFFLINE</span>
  <div class="heading">
    <div class="heading-top"><span id="channel"></span><span id="uptime"></span><span id="category"></span><span id="connection"></span></div>
    <div id="title"></div>
  </div>
</header>
<div id="layout">
  <section id="chat-col">
    <div id="messages" role="log" aria-label="Twitch chat messages"></div>
    <button id="jump" type="button" hidden>Jump to latest</button>
    <form id="composer" autocomplete="off">
      <div id="composer-status" role="alert"></div>
      <input id="composer-input" type="text" maxlength="${TWITCH_CHAT_MAX_MESSAGE_LENGTH}" aria-label="Chat message">
    </form>
  </section>
  <aside>
    <div class="tiles">
      <div class="tile viewers"><div class="tile-value" id="viewers">–</div><div class="tile-label">Viewers</div></div>
      <div class="tile"><div class="tile-value" id="followers">–</div><div class="tile-label">Followers</div></div>
      <div class="tile"><div class="tile-value" id="chatter-total">–</div><div class="tile-label">In chat</div></div>
      <div class="tile"><div class="tile-value" id="session">–</div><div class="tile-label">Live for</div></div>
    </div>
    <div class="section">Agents</div>
    <div id="agents"></div>
    <div class="section">In chat</div>
    <div id="chatters-note" class="note"></div>
    <ul id="chatters"></ul>
  </aside>
</div>
<script src="/overlay/dashboard.js"></script>
</body>
</html>`
}

export const STREAM_CHAT_DASHBOARD_SCRIPT = SCRIPT
