export type StreamPrivacyState = {
  /** True while OBS shows the blurred screen to viewers. */
  enabled: boolean
  busy: boolean
  /** Last OBS failure, shown next to the toggle. */
  error: string | null
}
