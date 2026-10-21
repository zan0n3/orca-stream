const release = require('./electron-builder.config.cjs')

// Orca Stream installs beside stock Orca: its own appId (install GUID, AUMID), product name
// (install dir, %APPDATA% userData, shortcuts), image name, and no stock-Orca update feed.
// Keep in sync with src/main/startup/orca-stream-product.ts.
const productName = 'Orca Stream'
const appId = 'com.orca-stream.app'

module.exports = {
  ...release,
  appId,
  productName,
  // Why: app.getName() reads the packaged package.json, which decides userData and the runtime identity.
  extraMetadata: { ...release.extraMetadata, productName },
  win: {
    ...release.win,
    executableName: productName,
    // Why no publisherName: this build is unsigned and takes no updates to verify.
    signtoolOptions: { sign: release.win.signtoolOptions.sign }
  },
  nsis: {
    ...release.nsis,
    artifactName: 'orca-stream-windows-setup.${ext}'
  },
  // Why none: the app never checks for updates (isPackagedOrcaStream); a new installer is the update.
  publish: null
}
