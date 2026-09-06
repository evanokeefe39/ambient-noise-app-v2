/**
 * W2.B1 + W2.B2 — 8-band BiquadFilterNode chain
 * Creates a series of 8 BiquadFilterNodes connected in series.
 * Supports peaking (default), lowshelf, highshelf, and notch filter types per band.
 */
import type { EQBandConfig, FilterType } from '../shared/audio-types'
import { DEFAULT_EQ_BANDS } from '../shared/audio-types'

export interface EQChain {
  /** Input node — connect your source here */
  input: BiquadFilterNode
  /** Output node — connect this to the next stage */
  output: BiquadFilterNode
  /** Update a single band's parameters */
  setBand(index: number, params: Partial<EQBandConfig>): void
  /** Get all current band configs */
  getBands(): EQBandConfig[]
  /** Reset all bands to flat (0 dB gain) */
  reset(): void
  /** Get frequency response across all filters combined */
  getFrequencyResponse(frequencies: Float32Array): {
    magResponse: Float32Array
    phaseResponse: Float32Array
  }
  /** Disconnect and clean up all filter nodes */
  dispose(): void
}

/**
 * Create an 8-band BiquadFilterNode chain connected in series.
 */
export function createEQChain(ctx: AudioContext): EQChain {
  const bands: EQBandConfig[] = DEFAULT_EQ_BANDS.map((b) => ({ ...b }))
  const filters: BiquadFilterNode[] = bands.map((band) => {
    const f = ctx.createBiquadFilter()
    applyBandToFilter(f, band)
    return f
  })

  // Connect filters in series
  for (let i = 0; i < filters.length - 1; i++) {
    filters[i].connect(filters[i + 1])
  }

  function applyBandToFilter(filter: BiquadFilterNode, band: EQBandConfig): void {
    filter.type = band.filterType as BiquadFilterType
    filter.frequency.value = band.frequency
    filter.gain.value = band.gain
    filter.Q.value = band.Q
  }

  return {
    get input() { return filters[0] },
    get output() { return filters[filters.length - 1] },

    setBand(index: number, params: Partial<EQBandConfig>): void {
      const bandIndex = index - 1 // bands are 1-indexed
      if (bandIndex < 0 || bandIndex >= filters.length) return
      const band = bands[bandIndex]
      const updated: EQBandConfig = { ...band, ...params }
      bands[bandIndex] = updated
      applyBandToFilter(filters[bandIndex], updated)
    },

    getBands(): EQBandConfig[] {
      return bands.map((b) => ({ ...b }))
    },

    reset(): void {
      bands.forEach((band, i) => {
        band.gain = 0
        band.Q = 1.0
        band.filterType = 'peaking' as FilterType
        applyBandToFilter(filters[i], band)
      })
    },

    getFrequencyResponse(frequencies: Float32Array): {
      magResponse: Float32Array
      phaseResponse: Float32Array
    } {
      const len = frequencies.length
      const combinedMag = new Float32Array(new ArrayBuffer(len * 4))
      const combinedPhase = new Float32Array(new ArrayBuffer(len * 4))
      const tmpMag = new Float32Array(new ArrayBuffer(len * 4))
      const tmpPhase = new Float32Array(new ArrayBuffer(len * 4))
      combinedMag.fill(1)

      // Ensure frequencies is a concrete Float32Array<ArrayBuffer> for getFrequencyResponse
      const freqBuf = new Float32Array(new ArrayBuffer(len * 4))
      freqBuf.set(frequencies)

      for (const filter of filters) {
        filter.getFrequencyResponse(freqBuf, tmpMag, tmpPhase)
        for (let i = 0; i < len; i++) {
          combinedMag[i] *= tmpMag[i]
          combinedPhase[i] += tmpPhase[i]
        }
      }

      return { magResponse: combinedMag, phaseResponse: combinedPhase }
    },

    dispose(): void {
      for (const filter of filters) {
        filter.disconnect()
      }
    },
  }
}
