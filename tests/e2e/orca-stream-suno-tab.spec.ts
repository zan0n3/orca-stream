import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'

function silentWav(seconds: number): Buffer {
  const sampleRate = 8000
  const data = Buffer.alloc(sampleRate * seconds)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate, 28)
  header.writeUInt16LE(1, 32)
  header.writeUInt16LE(8, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data.fill(128)])
}

test('Orca Stream panel shows Chat and Suno tabs; a Suno song previews locally', async ({
  electronApp,
  orcaPage
}) => {
  const music = await electronApp.evaluate(({ app }) => app.getPath('music'))
  const folder = path.join(music, 'Suno')
  mkdirSync(folder, { recursive: true })
  writeFileSync(path.join(folder, 'Test Song (0f3c2a1b).wav'), silentWav(2))

  await orcaPage.evaluate(async () => {
    const state = window.__store?.getState()
    await state?.updateSettings({ experimentalTwitchChat: true })
    state?.setRightSidebarOpen(true)
    state?.setRightSidebarTab('twitch-chat')
  })

  await expect(orcaPage.getByRole('tab', { name: 'Chat', exact: true })).toBeVisible()
  await expect(orcaPage.getByRole('button', { name: 'Go live', exact: true })).toBeVisible()
  await expect(orcaPage.getByRole('button', { name: 'Blur', exact: true })).toBeVisible()

  // Why keyboard and dispatched clicks: hidden test windows never paint, so Playwright's click waits forever for a stable box.
  await orcaPage.getByRole('tab', { name: 'Chat', exact: true }).focus()
  await orcaPage.keyboard.press('ArrowRight')
  await expect(orcaPage.getByRole('textbox', { name: 'Song idea', exact: true })).toBeVisible()
  await expect(orcaPage.getByRole('button', { name: 'Write lyrics', exact: true })).toBeDisabled()
  await expect(orcaPage.getByText('Test Song', { exact: true })).toBeVisible()
  await expect(orcaPage.getByRole('button', { name: 'Send to stream', exact: true })).toBeEnabled()

  await orcaPage
    .getByRole('button', { name: 'Preview (only you hear it)', exact: true })
    .dispatchEvent('click')
  const audio = orcaPage.locator('audio')
  await expect(audio).toHaveAttribute('src', /^blob:/)
  await orcaPage.getByRole('button', { name: 'Close preview', exact: true }).dispatchEvent('click')
  await expect(audio).toHaveCount(0)
})
