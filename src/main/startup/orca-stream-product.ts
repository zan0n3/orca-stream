/** Packaged Orca Stream identity; mirrored in config/electron-builder-orca-stream.config.cjs. */
export const ORCA_STREAM_PRODUCT_NAME = 'Orca Stream'
export const ORCA_STREAM_APP_ID = 'com.orca-stream.app'

let packagedOrcaStream = false

/** Run before app.setName: getName() still reads the packaged productName then. */
export function detectPackagedOrcaStream(app: { isPackaged: boolean; getName(): string }): void {
  packagedOrcaStream = app.isPackaged && app.getName() === ORCA_STREAM_PRODUCT_NAME
}

/**
 * True only in an installed Orca Stream build, which keeps its own name, AUMID and local data
 * root, and never takes stock Orca's release updates (they would replace it with stock Orca).
 */
export function isPackagedOrcaStream(): boolean {
  return packagedOrcaStream
}
