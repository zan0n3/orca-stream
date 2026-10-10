import { writeFile } from 'node:fs/promises'

// Why: an external supervisor (orca-stream's launcher) restarts on crash, but electron-vite
// exits 0 even when Electron dies by signal, so a committed quit leaves this marker instead.
export function writeSupervisedCleanExitMarker(): void {
  const markerPath = process.env.ORCA_CLEAN_EXIT_MARKER
  if (!markerPath) {
    return
  }
  void writeFile(markerPath, `${process.pid}\n`).catch(() => {})
}
