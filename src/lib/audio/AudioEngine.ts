/**
 * AudioEngine — implements IAudioEngine from @ambient/shared.
 * Manages the full Web Audio API graph:
 *   [NoiseSource] → [CrossfadeGain] → [LowCut hp] → [HighCut lp] → [EQChain] → [HeadphoneEQ] → [MasterGain] → [Destination]
 * The LowCut (highpass) and HighCut (lowpass) filters are optional: when off
 * they sit at transparent defaults (20 Hz / 20 kHz) and do not affect the signal.
 *
 * On iOS, MasterGain routes through MediaStreamDestinationNode → <audio> element
 * instead of audioContext.destination, because iOS suspends Web Audio API when
 * the screen locks but keeps HTML5 <audio> alive.
 *
 * Supports three noise types (white/pink/brown) via AudioWorklet with
 * ScriptProcessorNode fallback.
 *
 * W2.A1–A5, W2.B1–B2, W2.C1–C2
 */

import type {
  IAudioEngine,
  NoiseColor,
  AudioEngineState,
  EQBandConfig,
} from '../shared/audio-types'
import { DEFAULT_EQ_BANDS, getHeadphoneProfileById } from '../shared/audio-types'
import { createEQChain, type EQChain } from './eq-chain'
import { supportsAudioWorklet, createFallbackNoiseNode } from './noise-fallback'

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

const CROSSFADE_DURATION = 0.5 // seconds — W2.A5
const WORKLET_PATHS: Record<NoiseColor, string> = {
  white: '/worklets/white-noise-processor.js',
  pink: '/worklets/pink-noise-processor.js',
  brown: '/worklets/brown-noise-processor.js',
}
const WORKLET_NAMES: Record<NoiseColor, string> = {
  white: 'white-noise-processor',
  pink: 'pink-noise-processor',
  brown: 'brown-noise-processor',
}
const LS_VOLUME_KEY = 'ambient_master_volume'

type NoiseNode = AudioWorkletNode | ScriptProcessorNode

export class AudioEngine implements IAudioEngine {
  private _ctx: AudioContext | null = null
  private _masterGain: GainNode | null = null
  private _eqChain: EQChain | null = null
  private _headphoneChain: EQChain | null = null
  private _lowCutFilter: BiquadFilterNode | null = null
  private _highCutFilter: BiquadFilterNode | null = null
  private _lowCutHz: number | null = null
  private _highCutHz: number | null = null

  // One source node + crossfade gain node per noise color
  private _sourceNodes: Partial<Record<NoiseColor, NoiseNode>> = {}
  private _crossfadeGains: Partial<Record<NoiseColor, GainNode>> = {}
  private _loadedWorklets = new Set<NoiseColor>()

  private _state: AudioEngineState = {
    isPlaying: false,
    noiseColor: 'brown',
    masterVolume: this._loadVolume(),
    activeHeadphoneProfileId: null,
  }

  private _stateListeners: Array<(state: AudioEngineState) => void> = []
  private _activeColor: NoiseColor = 'brown'
  private _useWorklets = false
  private _iosAudioEl: HTMLAudioElement | null = null
  private _visibilityHandler: (() => void) | null = null

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this._ctx) return

    this._ctx = new AudioContext()

    // W2.C1 — Master volume GainNode
    this._masterGain = this._ctx.createGain()
    this._masterGain.gain.value = this._state.masterVolume

    // W2.B1 — EQ chain (user EQ)
    this._eqChain = createEQChain(this._ctx)

    // W3.C5 — Headphone EQ offset chain (second 8-band chain, flat by default)
    this._headphoneChain = createEQChain(this._ctx)
    this._headphoneChain.reset() // ensure flat (0 dB gain on all bands)

    // Optional cut filters (transparent when off): Crossfade → LowCut → HighCut → EQ
    this._lowCutFilter = this._ctx.createBiquadFilter()
    this._lowCutFilter.type = 'highpass'
    this._lowCutFilter.frequency.value = 20
    this._lowCutFilter.Q.value = 0.707
    this._highCutFilter = this._ctx.createBiquadFilter()
    this._highCutFilter.type = 'lowpass'
    this._highCutFilter.frequency.value = 20000
    this._highCutFilter.Q.value = 0.707
    this._lowCutFilter.connect(this._highCutFilter)
    this._highCutFilter.connect(this._eqChain.input)
    this._eqChain.output.connect(this._headphoneChain.input)
    this._headphoneChain.output.connect(this._masterGain)

    // On iOS, Web Audio is suspended when the screen locks. Route through a
    // MediaStreamDestinationNode → <audio> element so iOS keeps audio alive.
    // The element must be appended to the DOM — iOS won't keep detached elements alive.
    if (isIOS()) {
      const mediaStreamDest = this._ctx.createMediaStreamDestination()
      this._masterGain.connect(mediaStreamDest)
      const audioEl = document.createElement('audio')
      audioEl.srcObject = mediaStreamDest.stream
      audioEl.setAttribute('playsinline', '')
      audioEl.style.cssText =
        'position:absolute;width:0;height:0;opacity:0;pointer-events:none;'
      document.body.appendChild(audioEl)
      this._iosAudioEl = audioEl
    } else {
      this._masterGain.connect(this._ctx.destination)
    }

    // Resume AudioContext when the page becomes visible again after being hidden
    // (screen lock/unlock, tab switch). Works on both iOS and Android.
    this._visibilityHandler = () => {
      if (document.visibilityState === 'visible' && this._state.isPlaying) {
        void this._ctx?.resume()
        if (this._iosAudioEl?.paused) {
          void this._iosAudioEl.play().catch(() => {})
        }
      }
    }
    document.addEventListener('visibilitychange', this._visibilityHandler)

    this._useWorklets = supportsAudioWorklet(this._ctx)

    // Create crossfade gain nodes for all three colors
    for (const color of ['white', 'pink', 'brown'] as NoiseColor[]) {
      const gain = this._ctx.createGain()
      gain.gain.value = 0
      gain.connect(this._lowCutFilter!)
      this._crossfadeGains[color] = gain
    }

    // Load and create the initial noise source
    await this._activateColor(this._activeColor, true)

    // Re-apply cut frequencies set before initialize()
    if (this._lowCutHz !== null) this.setLowCut(this._lowCutHz)
    if (this._highCutHz !== null) this.setHighCut(this._highCutHz)
  }

  async resume(): Promise<void> {
    await this._ctx?.resume()
  }

  async suspend(): Promise<void> {
    await this._ctx?.suspend()
  }

  dispose(): void {
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler)
      this._visibilityHandler = null
    }
    this._eqChain?.dispose()
    this._headphoneChain?.dispose()
    for (const node of Object.values(this._sourceNodes)) {
      node?.disconnect()
    }
    for (const gain of Object.values(this._crossfadeGains)) {
      gain?.disconnect()
    }
    this._masterGain?.disconnect()
    this._lowCutFilter?.disconnect()
    this._highCutFilter?.disconnect()
    if (this._iosAudioEl) {
      this._iosAudioEl.pause()
      this._iosAudioEl.srcObject = null
      this._iosAudioEl.remove()
      this._iosAudioEl = null
    }
    this._ctx?.close()
    this._ctx = null
    this._masterGain = null
    this._eqChain = null
    this._headphoneChain = null
    this._lowCutFilter = null
    this._highCutFilter = null
    this._sourceNodes = {}
    this._crossfadeGains = {}
  }

  // ── Noise ────────────────────────────────────────────────────────────────

  setNoiseColor(color: NoiseColor): void {
    if (color === this._activeColor) return
    void this._crossfadeTo(color)
  }

  getNoiseColor(): NoiseColor {
    return this._activeColor
  }

  // ── Cut filters ──────────────────────────────────────────────────────────

  /** Enable/disable low cut (highpass). hz cutoff or null to bypass. */
  setLowCut(hz: number | null): void {
    this._lowCutHz = hz !== null && hz > 0 ? hz : null
    if (this._lowCutFilter && this._ctx) {
      const target = this._lowCutHz ?? 20
      this._lowCutFilter.frequency.setValueAtTime(target, this._ctx.currentTime)
    }
  }

  /** Enable/disable high cut (lowpass). hz cutoff or null to bypass. */
  setHighCut(hz: number | null): void {
    this._highCutHz = hz !== null && hz > 0 ? hz : null
    if (this._highCutFilter && this._ctx) {
      const target = this._highCutHz ?? 20000
      this._highCutFilter.frequency.setValueAtTime(
        target,
        this._ctx.currentTime,
      )
    }
  }

  // ── EQ ───────────────────────────────────────────────────────────────────

  setEQBand(index: number, params: Partial<EQBandConfig>): void {
    this._eqChain?.setBand(index, params)
  }

  getEQBands(): EQBandConfig[] {
    return this._eqChain?.getBands() ?? DEFAULT_EQ_BANDS.map((b) => ({ ...b }))
  }

  resetEQ(): void {
    this._eqChain?.reset()
  }

  // ── Volume ───────────────────────────────────────────────────────────────

  setMasterVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume))
    this._state = { ...this._state, masterVolume: clamped }
    if (this._masterGain && this._ctx) {
      // W2.C1 — use exponentialRamp to avoid clicks
      const now = this._ctx.currentTime
      const target = Math.max(0.0001, clamped) // exponential ramp needs > 0
      this._masterGain.gain.cancelScheduledValues(now)
      this._masterGain.gain.setValueAtTime(this._masterGain.gain.value, now)
      this._masterGain.gain.exponentialRampToValueAtTime(target, now + 0.05)
    }
    // Persist
    try {
      localStorage.setItem(LS_VOLUME_KEY, String(clamped))
    } catch {
      /* ignore */
    }
    this._notify()
  }

  getMasterVolume(): number {
    return this._state.masterVolume
  }

  // ── Playback ─────────────────────────────────────────────────────────────

  async play(): Promise<void> {
    if (!this._ctx) await this.initialize()

    // W2.C2 — handle browser autoplay policy
    if (this._ctx!.state === 'suspended') {
      await this._ctx!.resume()
    }

    // On iOS, start/resume the <audio> element that carries the MediaStream output.
    // Must be called from a user gesture (same call stack as play()).
    if (this._iosAudioEl) {
      try {
        await this._iosAudioEl.play()
      } catch {
        /* ignore */
      }
    }

    this._state = { ...this._state, isPlaying: true }
    this._notify()
  }

  pause(): void {
    void this._ctx?.suspend()
    this._state = { ...this._state, isPlaying: false }
    this._notify()
  }

  isPlaying(): boolean {
    return this._state.isPlaying
  }

  // ── Headphone profiles ────────────────────────────────────────────────────

  setHeadphoneProfile(profileId: string | null): void {
    this._state = { ...this._state, activeHeadphoneProfileId: profileId }
    if (this._headphoneChain) {
      if (profileId === null) {
        // Reset to flat — bypass headphone correction
        this._headphoneChain.reset()
      } else {
        const profile = getHeadphoneProfileById(profileId)
        if (profile) {
          profile.eqOffsets.forEach((band) => {
            this._headphoneChain!.setBand(band.index, band)
          })
        } else {
          this._headphoneChain.reset()
        }
      }
    }
    this._notify()
  }

  getActiveHeadphoneProfileId(): string | null {
    return this._state.activeHeadphoneProfileId
  }

  // ── Visualization ─────────────────────────────────────────────────────────

  getFrequencyResponse(frequencies: Float32Array): {
    magResponse: Float32Array
    phaseResponse: Float32Array
  } {
    if (!this._eqChain) {
      return {
        magResponse: new Float32Array(frequencies.length).fill(1),
        phaseResponse: new Float32Array(frequencies.length).fill(0),
      }
    }
    return this._eqChain.getFrequencyResponse(frequencies)
  }

  /** W3.C6 — Get headphone EQ offset frequency response for canvas overlay */
  getHeadphoneFrequencyResponse(frequencies: Float32Array): {
    magResponse: Float32Array
    phaseResponse: Float32Array
  } {
    if (
      !this._headphoneChain ||
      this._state.activeHeadphoneProfileId === null
    ) {
      return {
        magResponse: new Float32Array(frequencies.length).fill(1),
        phaseResponse: new Float32Array(frequencies.length).fill(0),
      }
    }
    return this._headphoneChain.getFrequencyResponse(frequencies)
  }

  // ── State ─────────────────────────────────────────────────────────────────

  getState(): AudioEngineState {
    return { ...this._state }
  }

  onStateChange(callback: (state: AudioEngineState) => void): () => void {
    this._stateListeners.push(callback)
    return () => {
      this._stateListeners = this._stateListeners.filter((l) => l !== callback)
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _loadVolume(): number {
    try {
      const stored = localStorage.getItem(LS_VOLUME_KEY)
      if (stored) {
        const val = parseFloat(stored)
        if (!isNaN(val)) return Math.max(0, Math.min(1, val))
      }
    } catch {
      /* ignore */
    }
    return 0.7 // default
  }

  private _notify(): void {
    const state = this.getState()
    for (const listener of this._stateListeners) {
      listener(state)
    }
  }

  /**
   * Activate a noise color — load worklet if needed, create source node, connect to crossfade gain.
   */
  private async _activateColor(
    color: NoiseColor,
    immediate = false,
  ): Promise<void> {
    const ctx = this._ctx!
    const gain = this._crossfadeGains[color]!

    // Already running
    if (this._sourceNodes[color]) {
      if (immediate) gain.gain.setValueAtTime(1, ctx.currentTime)
      return
    }

    let node: NoiseNode

    if (this._useWorklets && !this._loadedWorklets.has(color)) {
      try {
        await ctx.audioWorklet.addModule(WORKLET_PATHS[color])
        this._loadedWorklets.add(color)
      } catch (err) {
        console.warn(
          `AudioWorklet load failed for ${color}, using fallback:`,
          err,
        )
        this._useWorklets = false
      }
    }

    if (this._useWorklets && this._loadedWorklets.has(color)) {
      node = new AudioWorkletNode(ctx, WORKLET_NAMES[color])
    } else {
      node = createFallbackNoiseNode(ctx, color)
    }

    node.connect(gain)
    this._sourceNodes[color] = node

    if (immediate) {
      gain.gain.setValueAtTime(1, ctx.currentTime)
    }
  }

  /**
   * W2.A5 — Crossfade between noise types using 500ms GainNode ramps (no clicks).
   */
  private async _crossfadeTo(newColor: NoiseColor): Promise<void> {
    const ctx = this._ctx!
    const oldColor = this._activeColor
    const now = ctx.currentTime
    const end = now + CROSSFADE_DURATION

    // Ensure the new source is ready before crossfading
    await this._activateColor(newColor)

    const oldGain = this._crossfadeGains[oldColor]
    const newGain = this._crossfadeGains[newColor]

    if (oldGain) {
      oldGain.gain.setValueAtTime(oldGain.gain.value, now)
      oldGain.gain.linearRampToValueAtTime(0, end)
    }

    if (newGain) {
      newGain.gain.setValueAtTime(newGain.gain.value, now)
      newGain.gain.linearRampToValueAtTime(1, end)
    }

    this._activeColor = newColor
    this._state = { ...this._state, noiseColor: newColor }
    this._notify()
  }
}

// Singleton instance
let _engineInstance: AudioEngine | null = null

export function getAudioEngine(): AudioEngine {
  if (!_engineInstance) {
    _engineInstance = new AudioEngine()
  }
  return _engineInstance
}
