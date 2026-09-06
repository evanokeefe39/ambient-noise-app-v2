/**
 * Vendored subset of the v1 @ambient/shared package — the only surface the
 * UNIT-02 player (AudioEngine + page) needs. Kept flat and dependency-free so
 * v2 has no workspace packages.
 *
 * Sources (v1, all read during the port):
 *   packages/shared/src/types/audio.ts
 *   packages/shared/src/types/eq.ts
 *   packages/shared/src/audio/index.ts  (IAudioEngine)
 *   packages/shared/src/presets/index.ts (getHeadphoneProfileById — legacy-only)
 */

// ── Noise / state ────────────────────────────────────────────────────────────

export type NoiseColor = 'white' | 'pink' | 'brown'

export interface AudioEngineState {
  isPlaying: boolean
  noiseColor: NoiseColor
  masterVolume: number
  activeHeadphoneProfileId: string | null
}

// ── EQ ──────────────────────────────────────────────────────────────────────

export type FilterType =
  | 'highpass'
  | 'lowpass'
  | 'peaking'
  | 'highshelf'
  | 'lowshelf'
  | 'notch'

export interface EQBandConfig {
  index: number
  frequency: number
  gain: number
  Q: number
  filterType: FilterType
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export const EQ_FREQUENCY_MIN = 20
export const EQ_FREQUENCY_MAX = 20000
export const EQ_GAIN_MIN = -12
export const EQ_GAIN_MAX = 12
export const EQ_Q_MIN = 0.1
export const EQ_Q_MAX = 18.0
export const EQ_BAND_COUNT = 8

/** Default 8-band frequencies (ISO standard octave centers) — the engine's
 *  initialization seeds its filters from these. The UNIT-02 page overrides the
 *  center frequency on every setEQBand to its own octave set (63 Hz .. 8 kHz),
 *  so these defaults are never what the user hears. */
export const DEFAULT_BAND_FREQUENCIES = [
  31, 62, 125, 250, 500, 1000, 4000, 16000,
] as const

export const DEFAULT_EQ_BANDS: EQBandConfig[] = DEFAULT_BAND_FREQUENCIES.map(
  (freq, i) => ({
    index: i + 1,
    frequency: freq,
    gain: 0,
    Q: 1.0,
    filterType: 'peaking' as FilterType,
  }),
)

export function validateFrequency(hz: number): boolean {
  return hz >= EQ_FREQUENCY_MIN && hz <= EQ_FREQUENCY_MAX
}

export function validateGain(db: number): boolean {
  return db >= EQ_GAIN_MIN && db <= EQ_GAIN_MAX
}

export function validateQ(q: number): boolean {
  return q >= EQ_Q_MIN && q <= EQ_Q_MAX
}

export function validateEQBand(band: EQBandConfig): ValidationResult {
  const errors: string[] = []
  if (band.index < 1 || band.index > EQ_BAND_COUNT) {
    errors.push(`Band index must be between 1 and ${EQ_BAND_COUNT}`)
  }
  if (!validateFrequency(band.frequency)) {
    errors.push(`Frequency must be between ${EQ_FREQUENCY_MIN} and ${EQ_FREQUENCY_MAX} Hz`)
  }
  if (!validateGain(band.gain)) {
    errors.push(`Gain must be between ${EQ_GAIN_MIN} and ${EQ_GAIN_MAX} dB`)
  }
  if (!validateQ(band.Q)) {
    errors.push(`Q must be between ${EQ_Q_MIN} and ${EQ_Q_MAX}`)
  }
  return { valid: errors.length === 0, errors }
}

// ── Headphone profiles ──────────────────────────────────────────────────────
// Legacy-only in v1: setHeadphoneProfile / getHeadphoneProfileById were called
// solely by the old Player.tsx + HeadphoneSelector, which v2 does not port. The
// UNIT-02 player never calls them. AudioEngine still imports this symbol (its
// setHeadphoneProfile branch resets the chain to flat when no profile), so we
// keep a minimal stub rather than vendoring the 5-profile JSON dataset.

export interface HeadphoneProfile {
  id: string
  name: string
  description: string
  eqOffsets: EQBandConfig[]
}

export function getHeadphoneProfileById(_id: string): HeadphoneProfile | undefined {
  return undefined
}

// ── IAudioEngine ────────────────────────────────────────────────────────────

export interface IAudioEngine {
  initialize(): Promise<void>
  resume(): Promise<void>
  suspend(): Promise<void>
  dispose(): void

  setNoiseColor(color: NoiseColor): void
  getNoiseColor(): NoiseColor

  setEQBand(index: number, params: Partial<EQBandConfig>): void
  getEQBands(): EQBandConfig[]
  resetEQ(): void

  setMasterVolume(volume: number): void
  getMasterVolume(): number

  play(): Promise<void>
  pause(): void
  isPlaying(): boolean

  setHeadphoneProfile(profileId: string | null): void
  getActiveHeadphoneProfileId(): string | null

  getFrequencyResponse(frequencies: Float32Array): {
    magResponse: Float32Array
    phaseResponse: Float32Array
  }

  getState(): AudioEngineState
  onStateChange(callback: (state: AudioEngineState) => void): () => void
}
