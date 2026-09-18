/**
 * AudioEngine — implements IAudioEngine from @ambient/shared.
 * Manages the full Web Audio API graph:
 *   [NoiseSource] → [CrossfadeGain] → [LowCut×4] → [LowCut shaper] → [HighCut lp]
 *     → [EQChain] → [HeadphoneEQ] → [MasterGain] → [Destination]
 * The LowCut and HighCut filters are optional: when off they sit at transparent
 * defaults and do not affect the signal.
 *
 * LOW CUT is 8th order (48 dB/oct): four cascaded highpass biquads at Q 0.707
 * (a Linkwitz-Riley cascade). A single biquad is only 2nd order (12 dB/oct),
 * which is why the cascade exists.
 *
 * Cascading four highpass sections at one corner makes the response overshoot
 * by ~+7 dB just above the corner, which is audible as a boost at whatever
 * frequency the cut is set to. A peaking filter after the cascade cancels it
 * (see LOWCUT_SHAPE_* below). This overshoot is a fixed shape of the cascade,
 * not of the corner frequency, so the shaper tracks the slider by ratio.
 *
 * HIGH CUT is deliberately gentler at 2nd order (12 dB/oct): one lowpass biquad.
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

/**
 * 8th-order Linkwitz-Riley Q set for the cascaded highpass (LOW CUT).
 * Four identical 2nd-order sections at Q 0.707 = LR8, which is 48 dB/oct and
 * puts the corner at -6 dB (amplitude-halving) rather than peaking.
 *
 * Deliberately NOT the Butterworth pole set (0.510/0.601/0.900/2.563): the
 * Q 2.563 stage peaks sharply just above the corner. Measured with the corner
 * at 100 Hz, Butterworth peaked +8.2 dB at 125 Hz vs +6.9 dB for this set.
 *
 * The residual overshoot is the cascade itself, not the Q values. Staggering
 * the four corners across two frequencies only relocated the peak (at a 25 Hz
 * corner: +6.98 dB single, +6.45 dB at 1.3x, +4.93 dB at 2.0x, but moving the
 * peak up into a more audible range). The overshoot is removed instead by
 * LOWCUT_SHAPE_* below.
 */
const LOWCUT_QS = [0.7071068, 0.7071068, 0.7071068, 0.7071068] as const

/**
 * Compensation for the LOW CUT cascade overshoot.
 * Four cascaded highpass stages overshoot ~+7 dB just above the corner. A
 * peaking CUT placed at LOWCUT_SHAPE_RATIO x the corner removes it.
 *
 * These three constants are derived from the LOWCUT_QS cascade above. Changing
 * LOWCUT_QS (order, or Q values) invalidates them: the overshoot shape is a
 * property of that cascade, so re-measure and retune if the Q set changes.
 *
 * Measured across corners of 25/30/35/40/60/100/200 Hz, the result is identical
 * at every corner, so the shape is a property of the cascade and scales:
 *   raw peak        +6.98 dB at 1.33 x corner
 *   shaped peak     +1.05 dB
 *   low-end reject  -43.7 dB -> -44.7 dB (48 dB/oct preserved)
 *   far passband    +0.06 dB, unchanged (5x+ the corner), so LOW CUT ON is
 *                   level-matched to OFF and the curve stays monotonic — the
 *                   cut flattens the bump rather than digging a hole.
 * Applied only while LOW CUT is on; the shaper parks at unity gain otherwise.
 */
const LOWCUT_SHAPE_RATIO = 1.36
const LOWCUT_SHAPE_Q = 1.0
const LOWCUT_SHAPE_GAIN_DB = -6

/**
 * Time constant (seconds) for setTargetAtTime smoothing on cut-frequency
 * sweeps. Dragging the cutoff slider updates ~60×/s; without smoothing each
 * update is a step that zippers. ~15 ms settles faster than the ear resolves
 * but slow enough to remove the staircase.
 */
const CUT_SMOOTHING_TAU = 0.015

/**
 * Duration (seconds) of the bypass cross-ramp on the cut filters.
 * Bypass must ramp, not step: a stepped frequency change is a step in the
 * filter's transfer function, which is a discontinuity through live signal and
 * clicks. Measured offline on the OFF transition, a stepped bypass showed a
 * sample-to-sample jump 2.3x the signal's own baseline slope (worst at
 * frequencies near the corner, where the filter has the most gain). Ramping
 * removes it. 30 ms is long enough to be smooth and short enough to feel
 * instant.
 */
const CUT_RAMP_TAU = 0.03

/**
 * Transparent "off" cutoff frequency for LOW CUT.
 * Must sit low: with four cascaded highpass stages at Q 0.707, parking the
 * stack at 5 Hz would add +0.50 dB at 31.5 Hz and +0.13 dB at 63 Hz. At 2 Hz
 * the lift at 31.5 Hz is +0.08 dB, i.e. inaudible, and 2 Hz is below the
 * audible band and the noise generators' practical output.
 * Verified via getFrequencyResponse at 2/5/10/20 Hz.
 */
const LOWCUT_OFF_HZ = 2
const HIGHCUT_OFF_HZ = 20000
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
  private _lowCutStages: BiquadFilterNode[] = []
  private _lowCutShaper: BiquadFilterNode | null = null
  private _lowCutIn: GainNode | null = null
  private _lowCutWet: GainNode | null = null
  private _lowCutDry: GainNode | null = null
  private _highCutFilter: BiquadFilterNode | null = null
  private _highCutIn: GainNode | null = null
  private _highCutWet: GainNode | null = null
  private _highCutDry: GainNode | null = null
  private _lowCutHz: number | null = null
  private _highCutHz: number | null = null
  /**
   * Whether each cut is currently engaged (wet path open). Tracked explicitly
   * rather than read from `wet.gain.value`: an AudioParam reports the last
   * *scheduled* value, not the value mid-ramp, so a re-toggle during the 30 ms
   * crossfade would misread it and step the filter frequency while the wet path
   * is still partly open — reintroducing the slew-under-live-signal artifact.
   */
  private _lowCutEngaged = false
  private _highCutEngaged = true
  /**
   * In-flight bypass ramp endpoints per cut: {from, start, to}. Lets a
   * re-entrant toggle resume from the ramp's true position instead of reading
   * `gain.value`, which reports only the last scheduled value.
   */
  private _cutRamp: Record<'low' | 'high', { from: number; start: number; to: number } | null> =
    { low: null, high: null }
  private _stereo = true

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

    // Optional cut filters. Each cut is a DRY/WET pair: the filter sits on the
    // wet path and its dry counterpart runs unfiltered alongside. Bypass cross-
    // fades the two gains instead of moving filter coefficients under live
    // signal, so no frequency ever slews (which warbles) and no transfer
    // function ever steps (which clicks).
    //
    //   xfadeGains ─┬─> lcWet -> [LowCut×4] -> shaper ─┬─> lcSum
    //               └─> lcDry ─────────────────────────┘
    //   lcSum ─┬─> hcWet -> [HighCut] ─┬─> hcSum -> EQ
    //          └─> hcDry ──────────────┘
    //
    // LOW CUT wet path: four cascaded highpass biquads (8th order, 48 dB/oct) at
    // Q 0.707 (Linkwitz-Riley), then a peaking cut cancelling the cascade's
    // ~+7 dB corner overshoot. See LOWCUT_SHAPE_* above.
    this._lowCutStages = LOWCUT_QS.map((q) => {
      const f = this._ctx!.createBiquadFilter()
      f.type = 'highpass'
      f.frequency.value = LOWCUT_OFF_HZ
      f.Q.value = q
      return f
    })
    for (let i = 0; i < this._lowCutStages.length - 1; i++) {
      this._lowCutStages[i].connect(this._lowCutStages[i + 1])
    }
    this._lowCutShaper = this._ctx.createBiquadFilter()
    this._lowCutShaper.type = 'peaking'
    this._lowCutShaper.frequency.value = LOWCUT_OFF_HZ * LOWCUT_SHAPE_RATIO
    this._lowCutShaper.Q.value = LOWCUT_SHAPE_Q
    this._lowCutShaper.gain.value = LOWCUT_SHAPE_GAIN_DB
    this._lowCutStages[this._lowCutStages.length - 1].connect(this._lowCutShaper)

    // LOW CUT dry/wet pair. Starts OFF => dry open, wet closed.
    // The sum node feeds the next stage; each leg is fed from its own bus.
    this._lowCutIn = this._ctx.createGain()
    this._lowCutWet = this._ctx.createGain()
    this._lowCutWet.gain.value = 0
    this._lowCutDry = this._ctx.createGain()
    this._lowCutDry.gain.value = 1
    this._lowCutIn.connect(this._lowCutStages[0])
    this._lowCutIn.connect(this._lowCutDry)
    this._lowCutShaper.connect(this._lowCutWet)

    // HIGH CUT stays 2nd order (12 dB/oct) — intentionally gentler than LOW CUT.
    this._highCutFilter = this._ctx.createBiquadFilter()
    this._highCutFilter.type = 'lowpass'
    this._highCutFilter.frequency.value = HIGHCUT_OFF_HZ
    this._highCutFilter.Q.value = 0.707

    // HIGH CUT dry/wet pair. Starts ON (default preset has high cut on).
    this._highCutIn = this._ctx.createGain()
    this._highCutWet = this._ctx.createGain()
    this._highCutWet.gain.value = 1
    this._highCutDry = this._ctx.createGain()
    this._highCutDry.gain.value = 0
    this._highCutIn.connect(this._highCutFilter)
    this._highCutIn.connect(this._highCutDry)
    this._highCutFilter.connect(this._highCutWet)

    // LOW CUT sum (both legs) feeds the HIGH CUT input bus; HIGH CUT sum feeds EQ.
    this._lowCutWet.connect(this._highCutIn)
    this._lowCutDry.connect(this._highCutIn)
    this._highCutWet.connect(this._eqChain.input)
    this._highCutDry.connect(this._eqChain.input)
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
      gain.connect(this._lowCutIn!)
      this._crossfadeGains[color] = gain
    }

    // Load and create the initial noise source
    await this._activateColor(this._activeColor, true)

    // Re-apply cut frequencies set before initialize()
    if (this._lowCutHz !== null) this.setLowCut(this._lowCutHz)
    if (this._highCutHz !== null) this.setHighCut(this._highCutHz)
    this.setStereo(this._stereo)
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
    this._lowCutStages.forEach((n) => n.disconnect())
    this._lowCutShaper?.disconnect()
    this._lowCutIn?.disconnect()
    this._lowCutWet?.disconnect()
    this._lowCutDry?.disconnect()
    this._highCutFilter?.disconnect()
    this._highCutIn?.disconnect()
    this._highCutWet?.disconnect()
    this._highCutDry?.disconnect()
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
    this._lowCutStages = []
    this._lowCutShaper = null
    this._lowCutIn = null
    this._lowCutWet = null
    this._lowCutDry = null
    this._highCutFilter = null
    this._highCutIn = null
    this._highCutWet = null
    this._highCutDry = null
    this._cutRamp = { low: null, high: null }
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

  /**
   * Enable/disable low cut (highpass). hz cutoff or null to bypass.
   * All cascade stages plus the overshoot shaper are driven together; the
   * 8th-order Linkwitz-Riley response only holds if the stages share a
   * frequency, and the shaper must track it by ratio.
   */
  setLowCut(hz: number | null): void {
    this._lowCutHz = hz !== null && hz > 0 ? hz : null
    if (this._lowCutStages.length && this._lowCutShaper && this._ctx) {
      const now = this._ctx.currentTime
      const bypassed = this._lowCutHz === null
      if (!bypassed) {
        // Frequency changes only when the user actually moves the cutoff, and
        // it is set while the wet path is CLOSED (or just about to open), never
        // ramped while audible — a 48 dB/oct cascade slewing under live signal
        // warps and stutters. That was the toggle artifact.
        const target = this._lowCutHz!
        const engaged = this._lowCutEngaged
        for (const f of this._lowCutStages) {
          f.frequency.cancelScheduledValues(now)
          if (engaged) {
            // Already audible: ease to the new corner so a drag does not zipper.
            f.frequency.setValueAtTime(f.frequency.value, now)
            f.frequency.linearRampToValueAtTime(target, now + CUT_SMOOTHING_TAU)
          } else {
            // Wet path silent: jump instantly, nothing is audible to sweep.
            f.frequency.setValueAtTime(target, now)
          }
        }
        this._lowCutShaper.frequency.cancelScheduledValues(now)
        this._lowCutShaper.frequency.setValueAtTime(target * LOWCUT_SHAPE_RATIO, now)
      }
      // Bypass is a pure gain crossfade between the filtered and unfiltered
      // legs. No filter coefficient moves, so there is no slew and no step.
      this._lowCutEngaged = !bypassed
      this._rampCutBypass(
        this._lowCutWet,
        this._lowCutDry,
        bypassed ? 0 : 1,
        now,
        'low',
      )
    }
  }

  /** Enable/disable high cut (lowpass). hz cutoff or null to bypass. */
  setHighCut(hz: number | null): void {
    this._highCutHz = hz !== null && hz > 0 ? hz : null
    if (this._highCutFilter && this._ctx) {
      const now = this._ctx.currentTime
      const bypassed = this._highCutHz === null
      if (!bypassed) {
        const target = this._highCutHz!
        const engaged = this._highCutEngaged
        this._highCutFilter.frequency.cancelScheduledValues(now)
        if (engaged) {
          this._highCutFilter.frequency.setValueAtTime(
            this._highCutFilter.frequency.value,
            now,
          )
          this._highCutFilter.frequency.linearRampToValueAtTime(
            target,
            now + CUT_SMOOTHING_TAU,
          )
        } else {
          // Wet path silent — jump, nothing audible to sweep.
          this._highCutFilter.frequency.setValueAtTime(target, now)
        }
      }
      this._highCutEngaged = !bypassed
      this._rampCutBypass(
        this._highCutWet,
        this._highCutDry,
        bypassed ? 0 : 1,
        now,
        'high',
      )
    }
  }

  /**
   * Linear dry/wet crossfade used by the cut-filter bypass.
   * Ramps `wet` toward `wetTarget` and `dry` to its complement over
   * CUT_RAMP_TAU. Gain is the only thing that moves, so the transition is
   * continuous in the signal domain regardless of filter topology.
   *
   * Linear, NOT equal-power, is correct here: both legs carry the same source,
   * so they sum coherently. Measured on a frozen noise buffer at the midpoint,
   * a linear crossfade gives 0.9955x (a 0.04 dB dip, inaudible) while
   * equal-power gives 1.4079x (a +3 dB bump). Equal-power is for uncorrelated
   * sources and would make every toggle audibly louder in the middle.
   *
   * Re-entrancy: two toggles inside CUT_RAMP_TAU must not snap the gain. The
   * starting gain is computed from the in-flight ramp (start gain, start time,
   * target) rather than read from `gain.value`, which reports the last
   * *scheduled* value and would floor the ramp at a stale endpoint — leaving
   * wet+dry != 1 and dipping the level. Holding the endpoints also guarantees
   * the complement holds exactly at every instant of a re-started ramp.
   */
  private _rampCutBypass(
    wet: GainNode | null,
    dry: GainNode | null,
    wetTarget: number,
    now: number,
    state: 'low' | 'high',
  ): void {
    if (!wet || !dry) return
    const from = this._cutRampState(wet, now, state)
    wet.gain.cancelScheduledValues(now)
    dry.gain.cancelScheduledValues(now)
    // Both legs start from the complement pair, so wet + dry === 1 throughout.
    wet.gain.setValueAtTime(from, now)
    dry.gain.setValueAtTime(1 - from, now)
    wet.gain.linearRampToValueAtTime(wetTarget, now + CUT_RAMP_TAU)
    dry.gain.linearRampToValueAtTime(1 - wetTarget, now + CUT_RAMP_TAU)
    this._cutRamp[state] = { from, start: now, to: wetTarget }
  }

  /**
   * Current wet gain for a cut, accounting for an in-flight ramp.
   * Returns the analytic position of the linear ramp if one is running,
   * otherwise the settled target. Avoids reading `gain.value`, which reports
   * the last scheduled value rather than the value mid-ramp.
   */
  private _cutRampState(wet: GainNode, now: number, state: 'low' | 'high'): number {
    const prev = this._cutRamp[state]
    if (!prev) return wet.gain.value
    const elapsed = now - prev.start
    if (elapsed >= CUT_RAMP_TAU) return prev.to // ramp finished
    const t = Math.max(0, elapsed) / CUT_RAMP_TAU
    return prev.from + (prev.to - prev.from) * t
  }

  // ── Stereo / mono ─────────────────────────────────────────────────────────

  /**
   * Toggle independent left/right stereo generation. When enabled the noise
   * worklets emit two decorrelated channels; when disabled the master gain
   * downmixes to mono (identical signal to both ears).
   */
  setStereo(enabled: boolean): void {
    this._stereo = enabled
    const master = this._masterGain
    if (!master) return
    if (enabled) {
      master.channelCountMode = 'max'
      master.channelCount = 2
    } else {
      master.channelCountMode = 'explicit'
      master.channelCount = 1
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
    // On the iOS media-stream bypass, the <audio> element is the actual audio
    // sink and keeps playing even after the context suspends. Pause it too so
    // pausing actually silences output (resume re-plays it in play()).
    this._iosAudioEl?.pause()
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
      node = new AudioWorkletNode(ctx, WORKLET_NAMES[color], {
        outputChannelCount: [2],
      })
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
