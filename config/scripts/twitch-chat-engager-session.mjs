import WebSocket from 'ws'

const TYPING_SCRIPT = `(() => {
  const selectors = '#composer-input, input[aria-label="Chat message"], [data-a-target="chat-input"]';
  const nodes = () => [...document.querySelectorAll(selectors)];
  if (!window.__orcaEngagerTyping) {
    window.__orcaEngagerTyping = { at: 0 };
    const mark = event => {
      if (event.target?.matches?.(selectors) || event.target?.querySelector?.(selectors)) window.__orcaEngagerTyping.at = Date.now();
    };
    for (const type of ['input', 'keydown', 'compositionstart', 'compositionend', 'submit']) document.addEventListener(type, mark, true);
  }
  return { at: window.__orcaEngagerTyping.at, active: nodes().some(node => (node.value || node.textContent || '').trim().length > 0) };
})()`

export class TwitchEngagerSession {
  sequence = 0
  pending = new Map()

  async connect(port) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(5000)
    })
    const targets = await response.json()
    const target = targets.find((item) => item.type === 'node')
    if (!target) {
      throw new Error('The Orca main-process debugger is unavailable.')
    }
    this.socket = new WebSocket(target.webSocketDebuggerUrl, { handshakeTimeout: 5000 })
    await new Promise((resolve, reject) => {
      this.socket.once('open', resolve)
      this.socket.once('error', reject)
    })
    this.socket.on('error', () => {})
    this.socket.on('close', () => {
      for (const request of this.pending.values()) {
        request.reject(new Error('Orca disconnected.'))
      }
      this.pending.clear()
    })
    this.socket.on('message', (raw) => {
      const message = JSON.parse(String(raw))
      const request = this.pending.get(message.id)
      if (!request) {
        return
      }
      this.pending.delete(message.id)
      if (message.error || message.result?.exceptionDetails) {
        request.reject(new Error('Orca bridge failed.'))
      } else {
        request.resolve(message.result.result.value)
      }
    })
  }

  evaluate(expression) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Orca bridge timed out.'))
      }, 5000)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      this.socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true }
        })
      )
    })
  }

  async read() {
    return this.evaluate(`(async () => {
      const e = process.mainModule.require('electron');
      const windows = e.BrowserWindow.getAllWindows();
      const main = windows.find(w => /^https?:\\/\\/localhost(?::\\d+)?\\/?$/.test(w.webContents.getURL()) || w.webContents.getURL().includes('/renderer/index.html'));
      const chat = windows.find(w => w.getTitle() === 'Orca Stream Chat');
      if (!main || !chat) return null;
      const readers = e.webContents.getAllWebContents().filter(w => !w.isDestroyed() && (w.id === main.webContents.id || w.id === chat.webContents.id || /^https:\\/\\/(?:www\\.)?twitch\\.tv\\//.test(w.getURL())));
      const typing = await Promise.all(readers.map(w => w.executeJavaScript(${JSON.stringify(TYPING_SCRIPT)})));
      return { snapshot: await main.webContents.executeJavaScript('window.api.twitchChat.getSnapshot()'), auth: await chat.webContents.executeJavaScript('window.orcaStreamChat.getAuthState()'), typing: { active: typing.some(t => t.active), at: Math.max(0, ...typing.map(t => t.at)) } };
    })()`)
  }

  async send(text, inputAt) {
    return this.evaluate(`(async () => {
      const e = process.mainModule.require('electron');
      const chat = e.BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Orca Stream Chat');
      if (!chat) return { ok: false, error: 'Chat closed' };
      const typing = await Promise.all(e.webContents.getAllWebContents().filter(w => !w.isDestroyed() && (e.BrowserWindow.fromWebContents(w) || /^https:\\/\\/(?:www\\.)?twitch\\.tv\\//.test(w.getURL()))).map(w => w.executeJavaScript(${JSON.stringify(TYPING_SCRIPT)})));
      if (typing.some(t => t.active || t.at > ${inputAt})) return { ok: false, error: 'Human is typing' };
      return chat.webContents.executeJavaScript(${JSON.stringify(`(async () => {
        const typing = ${TYPING_SCRIPT};
        if (typing.active || typing.at > ${inputAt}) return { ok: false, error: 'Human is typing' };
        return window.orcaStreamChat.send(${JSON.stringify(text)});
      })()`)});
    })()`)
  }

  async highlight(prefix, channel) {
    return this.evaluate(`(async () => {
      const e = process.mainModule.require('electron');
      const windows = e.BrowserWindow.getAllWindows();
      const main = windows.find(w => w.getTitle() === 'Orca');
      const chat = windows.find(w => w.getTitle() === 'Orca Stream Chat');
      const color = await main.webContents.executeJavaScript("getComputedStyle(document.documentElement).getPropertyValue('--callout-note').trim()");
      if (!color) throw new Error('The assistant color token is unavailable');
      await chat.webContents.executeJavaScript(${JSON.stringify(`(() => {
        window.__orcaEngagerHighlight?.disconnect();
        let style = document.getElementById('orca-engager-style');
        if (!style) { style = document.createElement('style'); style.id = 'orca-engager-style'; document.head.append(style); }
        const apply = () => {
          for (const row of document.querySelectorAll('.msg')) {
            const name = row.querySelector('.name')?.textContent?.toLowerCase();
            const text = row.querySelector('.text')?.textContent?.replace(/^: /, '');
            row.classList.toggle('assistant', name === ${JSON.stringify(channel)} && text?.startsWith(${JSON.stringify(prefix)}));
          }
        };
        window.__orcaEngagerHighlight = new MutationObserver(apply);
        window.__orcaEngagerHighlight.observe(document.getElementById('messages'), { childList: true });
        apply();
      })()`)});
      await chat.webContents.executeJavaScript('document.getElementById("orca-engager-style").textContent = ' + JSON.stringify(':root { --callout-note: ' + color + '; } .msg.assistant .text { color: var(--callout-note); }'));
    })()`)
  }

  close() {
    this.socket?.close()
  }
}
