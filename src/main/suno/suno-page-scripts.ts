// Scripts run inside the suno.com/create page of an Orca browser tab. Plain strings, not
// serialized functions, so bundler helpers can never leak into the page.
// Why DOM clicks with pointer events: Suno's menus open on pointerdown, not on click alone.

const PAGE_HELPERS = String.raw`
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (find, timeoutMs, what) => {
    for (let waited = 0; waited <= timeoutMs; waited += 250) {
      const found = find()
      if (found) return found
      await sleep(250)
    }
    throw new Error('Suno page: ' + what + ' did not appear.')
  }
  const press = (element) => {
    for (const type of ['pointerover', 'pointerenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
    }
  }
  const byText = (selector, text, root = document) =>
    [...root.querySelectorAll(selector)].find((el) => el.innerText.trim() === text)
  const setValue = (element, value) => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const clipRow = (id) => {
    const link = document.querySelector('a[href="/song/' + id + '"]')
    let row = link
    while (row && row.querySelectorAll('[aria-label="More options"]').length !== 1) row = row.parentElement
    return row
  }
  const clipIds = () => [...new Set([...document.querySelectorAll('a[href^="/song/"]')].map((a) => a.getAttribute('href').slice(6)))]
`

/** Fills Advanced mode and presses Create; resolves to the clip ids that existed before. */
export function fillAndCreateScript(draft: {
  title: string
  style: string
  lyrics: string
}): string {
  return String.raw`(async () => {
    ${PAGE_HELPERS}
    const draft = ${JSON.stringify(draft)}
    const editor = () => document.querySelector('[aria-label="Lyrics editor"]')
    await waitFor(() => byText('[role=tab]', 'Advanced'), 20000, 'the Advanced tab')
    const advanced = byText('[role=tab]', 'Advanced')
    if (advanced.getAttribute('aria-selected') !== 'true') {
      press(advanced)
    }
    await waitFor(editor, 10000, 'the lyrics editor')
    const clear = document.querySelector('[aria-label="Clear all form inputs"]')
    if (clear && !clear.disabled) {
      press(clear)
      const confirm = await waitFor(() => byText('[role=alertdialog] button', 'Confirm'), 5000, 'the clear-form confirmation')
      press(confirm)
      await waitFor(() => editor() && editor().innerText.trim() === '', 5000, 'an empty lyrics editor')
    }
    const lyrics = editor()
    lyrics.focus()
    const data = new DataTransfer()
    data.setData('text/plain', draft.lyrics)
    lyrics.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    let form = lyrics
    while (form && !(form.querySelector('textarea[maxlength="1000"]') && form.querySelector('input[placeholder^="Song Title"]'))) {
      form = form.parentElement
    }
    if (!form) throw new Error('Suno page: the style and title fields were not found.')
    setValue(form.querySelector('textarea[maxlength="1000"]'), draft.style)
    setValue(form.querySelector('input[placeholder^="Song Title"]'), draft.title)
    const before = clipIds()
    const create = await waitFor(() => {
      const button = document.querySelector('[aria-label="Create song"]')
      return button && !button.disabled ? button : null
    }, 10000, 'an enabled Create button')
    press(create)
    return before
  })()`
}

/** Lists clips on the page as { id, title, duration } (duration is "" until generated). */
export const LIST_CLIPS_SCRIPT = String.raw`(() => {
  ${PAGE_HELPERS}
  return clipIds().slice(0, 40).map((id) => {
    const row = clipRow(id)
    const link = document.querySelector('a[href="/song/' + id + '"]')
    const duration = row ? ([...row.querySelectorAll('*')].map((el) => el.childElementCount === 0 ? el.textContent.trim() : '').find((text) => /^\d{1,2}:\d{2}$/.test(text)) ?? '') : ''
    return { id, title: (link?.innerText ?? '').trim(), duration }
  })
})()`

export function togglePlayScript(id: string): string {
  return String.raw`(async () => {
    ${PAGE_HELPERS}
    const row = clipRow(${JSON.stringify(id)})
    if (!row) throw new Error('Suno page: that song is not in the list.')
    const play = row.querySelector('[aria-label^="Play "], [aria-label^="Pause "]')
    if (!play) throw new Error('Suno page: no play button for that song yet.')
    press(play)
    return true
  })()`
}

/** Opens More options → Download → MP3; resolves to the Unlock & Download button's centre (or null).
 * Why main clicks it: Suno ignores synthetic clicks on that button and only downloads on trusted input. */
export function downloadMp3Script(id: string): string {
  return String.raw`(async () => {
    ${PAGE_HELPERS}
    const row = clipRow(${JSON.stringify(id)})
    if (!row) throw new Error('Suno page: that song is not in the list.')
    press(row.querySelector('[aria-label="More options"]'))
    press(await waitFor(() => byText('[role=menuitem]', 'Download'), 5000, 'the Download menu item'))
    const dialog = () => document.querySelector('[role=dialog]')
    press(await waitFor(() => dialog() && byText('button', 'MP3', dialog()), 5000, 'the MP3 option'))
    const unlock = await waitFor(() => {
      const button = dialog() && byText('button', 'Unlock & Download', dialog())
      return button && !button.disabled ? button : null
    }, 15000, 'an enabled Unlock & Download button').catch(() => null)
    if (!unlock) return null
    unlock.scrollIntoView({ block: 'center' })
    await sleep(150)
    const rect = unlock.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`
}
