'use client'

/**
 * Variant 2-improved — "Terminal / UNIT 02" evolved.
 * Preserves the instrument-panel identity: hard 1px rules, square controls,
 * zero radius, uppercase JetBrains Mono, STANDBY/RUNNING lamp, segmented
 * meter, h-dvh viewport fit, eight vertical faders.
 *
 * Improvements over /var/2:
 *  - Interactive preset navigator (wrap-around, chevrons desktop/mobile)
 *  - Live dB readouts under each fader (+/-, neutral at vertical center)
 *  - Continuous 0 dB neutral rule across the EQ strip
 *  - Correct octave band set 63 Hz .. 8 kHz
 *  - LOW CUT / HIGH CUT filter row above the footer
 *  - Noise buttons highlight in warm 70s retro colors (cream/salmon/burnt orange)
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioEngine } from '@/lib/audio/AudioEngine'
import type { NoiseColor } from '@/lib/shared/audio-types'

const NOISES = ['WHITE', 'PINK', 'BROWN'] as const
type Noise = (typeof NOISES)[number]

/** Proper 8-band octave centers: 63 Hz .. 8 kHz */
const BANDS = ['63', '125', '250', '500', '1K', '2K', '4K', '8K'] as const

/** Engine band centers matching the UI labels (engine bands are 1-indexed) */
const BAND_HZ = [63, 125, 250, 500, 1000, 2000, 4000, 8000] as const

/** UI noise labels -> engine NoiseColor */
const NOISE_MAP: Record<Noise, NoiseColor> = {
  WHITE: 'white',
  PINK: 'pink',
  BROWN: 'brown',
}

/** 70s retro highlight fills per noise color; WHITE doubles as the ivory ON fill */
const NOISE_FILL: Record<Noise, string> = {
  WHITE: '#F9FFD0',
  PINK: '#F00E68',
  BROWN: '#F14F2B',
}

/** Fader domain: 0..100, neutral 0 dB at 50. Full scale = +/-12 dB. */
const FADER_NEUTRAL = 50
const FADER_SCALE_DB = 12

type Preset = {
  name: string
  noise: Noise
  eq: number[] // 8 fader positions, 0..100 (50 = 0 dB)
  filters: {
    lowCut: boolean
    lowCutFreq: number
    highCut: boolean
    highCutFreq: number
  }
}

const PRESETS: Preset[] = [
  {
    name: 'Evening Drift',
    noise: 'PINK',
    eq: [64, 58, 52, 48, 50, 54, 58, 55],
    filters: {
      lowCut: false,
      lowCutFreq: 30,
      highCut: true,
      highCutFreq: 12000,
    },
  },
  {
    name: 'Rain On Tin',
    noise: 'BROWN',
    eq: [70, 64, 54, 48, 44, 46, 50, 52],
    filters: {
      lowCut: true,
      lowCutFreq: 40,
      highCut: false,
      highCutFreq: 16000,
    },
  },
  {
    name: 'Deep Space Hum',
    noise: 'BROWN',
    eq: [74, 68, 58, 50, 44, 42, 44, 46],
    filters: {
      lowCut: false,
      lowCutFreq: 25,
      highCut: true,
      highCutFreq: 9000,
    },
  },
  {
    name: 'Airy Meadow',
    noise: 'WHITE',
    eq: [44, 46, 48, 50, 52, 56, 62, 66],
    filters: {
      lowCut: true,
      lowCutFreq: 60,
      highCut: false,
      highCutFreq: 18000,
    },
  },
  {
    name: 'Night Harbour',
    noise: 'PINK',
    eq: [58, 56, 52, 50, 50, 48, 50, 54],
    filters: {
      lowCut: true,
      lowCutFreq: 35,
      highCut: true,
      highCutFreq: 14000,
    },
  },
]

function dbFromFader(value: number): number {
  return ((value - FADER_NEUTRAL) / FADER_NEUTRAL) * FADER_SCALE_DB
}

function formatDb(value: number): string {
  const db = dbFromFader(value)
  const sign = db > 0 ? '+' : db < 0 ? '-' : ' '
  return `${sign}${Math.abs(db).toFixed(1)}`
}

function Cell({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={`border border-border ${className}`}>{children}</div>
}

function ChevronButton({
  dir,
  onClick,
  label,
}: {
  dir: 'up' | 'down' | 'left' | 'right'
  onClick: () => void
  label: string
}) {
  const d =
    dir === 'up'
      ? 'M4 15l8-8 8 8'
      : dir === 'down'
        ? 'M4 9l8 8 8-8'
        : dir === 'left'
          ? 'M15 4l-8 8 8 8'
          : 'M9 4l8 8-8 8'
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-6 w-6 items-center justify-center border border-border text-foreground transition-colors hover:bg-surface"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3 w-3 fill-none stroke-current stroke-2"
        aria-hidden
      >
        <path d={d} strokeLinecap="square" />
      </svg>
    </button>
  )
}

/**
 * Preset name title. Every preset name scrolls right-to-left as a seamless
 * marquee (duplicated text, translateX -50%): it shows the name at rest for a
 * short moment, then starts sliding. Pauses on hover.
 */
function PresetTitle({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  const probeRef = useRef<HTMLSpanElement | null>(null)
  const [rolling, setRolling] = useState(false)

  // Every preset name slides, so just restart the roll clock on change.
  useEffect(() => {
    setRolling(false)
    const t = window.setTimeout(() => setRolling(true), 1800)
    return () => window.clearTimeout(t)
  }, [name, className])

  // Measure a single copy of the name for a proportional scroll speed.
  const textW =
    probeRef.current?.offsetWidth ?? Math.max(60, name.length * 12)
  const duration = `${Math.max(5, Math.round(textW / 40))}s`

  return (
    <h1
      className={`group relative min-w-0 flex-1 overflow-hidden text-xl font-bold uppercase tracking-tight md:w-[12.5ch] md:flex-none md:text-2xl ${className ?? ''}`}
    >
      {/* Hidden single-copy probe — used only for width measurement. */}
      <span
        ref={probeRef}
        aria-hidden
        className="invisible absolute left-0 top-0 whitespace-nowrap"
      >
        {name}
      </span>
      {rolling ? (
        <span
          className="preset-marquee group-hover:[animation-play-state:paused]"
          style={{ animationDuration: duration }}
        >
          <span>{name}</span>
          <span aria-hidden>{name}</span>
        </span>
      ) : (
        <span className="block overflow-hidden whitespace-nowrap text-ellipsis">
          {name}
        </span>
      )}
    </h1>
  )
}

export default function Var2ImprovedPage() {
  const [playing, setPlaying] = useState(false)
  const [presetIndex, setPresetIndex] = useState(0)
  const [noise, setNoise] = useState<Noise>(PRESETS[0].noise)
  const [eq, setEq] = useState<number[]>(PRESETS[0].eq)
  const [volume, setVolume] = useState(60)
  const [stereo, setStereo] = useState(true)
  const [lowCut, setLowCut] = useState(PRESETS[0].filters.lowCut)
  const [lowCutFreq, setLowCutFreq] = useState(PRESETS[0].filters.lowCutFreq)
  const [highCut, setHighCut] = useState(PRESETS[0].filters.highCut)
  const [highCutFreq, setHighCutFreq] = useState(PRESETS[0].filters.highCutFreq)
  const [eqOpen, setEqOpen] = useState(true)
  const preset = PRESETS[presetIndex]

  // ── Audio engine wiring (lazy; initialize only on user gesture) ──────────
  const engineRef = useRef<AudioEngine | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const [, setEngineReady] = useState(false)

  // Dynamic import is intentional: the engine bundle is lazy-loaded and
  // initialize() must only run inside a user-gesture handler (autoplay policy).
  const ensureEngine = useCallback(async (): Promise<AudioEngine | null> => {
    if (engineRef.current) return engineRef.current
    try {
      const engine = (await import('@/lib/audio/AudioEngine')).getAudioEngine()
      engineRef.current = engine
      unsubscribeRef.current = engine.onStateChange((s) =>
        setPlaying(s.isPlaying),
      )
      setEngineReady(true)
      return engine
    } catch (err) {
      console.error('[var/2-improved] failed to load audio engine', err)
      return null
    }
  }, [])

  useEffect(() => {
    return () => {
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
    }
  }, [])

  /** Push the full UI state (noise, EQ, cuts, volume) to the engine */
  const pushStateToEngine = useCallback(
    (
      engine: AudioEngine,
      s: {
        noise: Noise
        eq: number[]
        lowCut: boolean
        lowCutFreq: number
        highCut: boolean
        highCutFreq: number
        volume: number
      },
    ) => {
      engine.setNoiseColor(NOISE_MAP[s.noise])
      s.eq.forEach((v, i) =>
        engine.setEQBand(i + 1, {
          frequency: BAND_HZ[i],
          gain: dbFromFader(v),
        }),
      )
      engine.setLowCut(s.lowCut ? s.lowCutFreq : null)
      engine.setHighCut(s.highCut ? s.highCutFreq : null)
      engine.setMasterVolume(s.volume / 100)
    },
    [],
  )

  const toggleStereo = (next: boolean) => {
    setStereo(next)
    engineRef.current?.setStereo(next)
  }

  const togglePlay = async () => {
    try {
      const engine = await ensureEngine()
      if (!engine) return
      if (!engine.isPlaying()) {
        await engine.initialize()
        engine.setStereo(stereo)
        pushStateToEngine(engine, {
          noise,
          eq,
          lowCut,
          lowCutFreq,
          highCut,
          highCutFreq,
          volume,
        })
        await engine.play()
      } else {
        engine.pause()
      }
    } catch (err) {
      console.error('[var/2-improved] transport error', err)
    }
  }

  const applyPreset = (p: Preset) => {
    setNoise(p.noise)
    setEq(p.eq)
    setLowCut(p.filters.lowCut)
    setLowCutFreq(p.filters.lowCutFreq)
    setHighCut(p.filters.highCut)
    setHighCutFreq(p.filters.highCutFreq)
    const engine = engineRef.current
    if (engine) {
      engine.setNoiseColor(NOISE_MAP[p.noise])
      p.eq.forEach((v, i) =>
        engine.setEQBand(i + 1, {
          frequency: BAND_HZ[i],
          gain: dbFromFader(v),
        }),
      )
      engine.setLowCut(p.filters.lowCut ? p.filters.lowCutFreq : null)
      engine.setHighCut(p.filters.highCut ? p.filters.highCutFreq : null)
    }
  }

  const cyclePreset = (delta: 1 | -1) => {
    const next = (presetIndex + delta + PRESETS.length) % PRESETS.length
    setPresetIndex(next)
    applyPreset(PRESETS[next])
  }

  return (
    <main
      className="h-dvh overflow-hidden bg-background font-mono text-foreground"
      style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
    >
      <div className="mx-auto flex h-dvh max-w-2xl flex-col border-x border-border">
        {/* status bar */}
        <Cell className="flex shrink-0 items-center justify-between px-4 py-2 text-[10px] uppercase tracking-widest text-foreground-muted md:px-5 md:text-[11px]">
          <span>AMBIENT NOISE — UNIT 02</span>
          <span className="flex items-center gap-3">
            <button
              onClick={() => toggleStereo(!stereo)}
              aria-label="Toggle stereo mode"
              aria-pressed={stereo}
              className={`w-14 border px-1.5 py-0.5 text-center text-[10px] uppercase tracking-widest transition-colors md:text-[11px] ${
                stereo
                  ? 'border-border text-foreground'
                  : 'border-border text-foreground-muted hover:text-foreground'
              }`}
            >
              {stereo ? 'STEREO' : 'MONO'}
            </button>
            <span className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2"
              style={{
                background: playing
                  ? 'var(--color-vu-green)'
                  : 'var(--color-foreground-muted)',
              }}
            />
            {playing ? 'RUNNING' : 'STANDBY'}
            </span>
          </span>
        </Cell>

        {/* preset header with navigator */}
        <Cell className="shrink-0 px-4 py-3 md:px-5 md:py-4">
          <div className="flex flex-col gap-1">
            {/* caption line — sits above the name on every breakpoint */}
            <p className="pl-8 text-[10px] uppercase tracking-widest text-foreground-muted md:pl-9">
              PRESET / {String(presetIndex + 1).padStart(2, '0')}
            </p>

            {/* single nav row — chevrons, name and noise selector share one axis */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 md:flex-none md:gap-3">
                <ChevronButton
                  dir="left"
                  onClick={() => cyclePreset(-1)}
                  label="Previous preset"
                />
                <PresetTitle name={preset.name} />
                <ChevronButton
                  dir="right"
                  onClick={() => cyclePreset(1)}
                  label="Next preset"
                />
              </div>

              {/* noise selector — 70s retro highlight colors */}
              <div className="flex shrink-0 border border-border">
                {NOISES.map((n) => {
                  const selected = noise === n
                  return (
                    <button
                      key={n}
                      onClick={() => {
                        setNoise(n)
                        engineRef.current?.setNoiseColor(NOISE_MAP[n])
                      }}
                      aria-pressed={selected}
                      className="px-2.5 py-1.5 text-[10px] uppercase tracking-widest transition-colors md:px-3 md:text-[11px]"
                      style={
                        selected
                          ? { background: NOISE_FILL[n], color: '#000000' }
                          : { color: 'var(--color-foreground-muted)' }
                      }
                    >
                      {n}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </Cell>

        {/* transport row: play + volume */}
        <div className="grid shrink-0 grid-cols-[auto_1fr] gap-px bg-border">
          <button
            onClick={() => void togglePlay()}
            aria-label={playing ? 'Pause' : 'Play'}
            className="flex h-24 w-24 items-center justify-center bg-background transition-colors hover:bg-surface md:h-32 md:w-32"
          >
            {playing ? (
              <span className="flex gap-2.5 md:gap-3">
                <span className="h-9 w-3 bg-foreground md:h-11" />
                <span className="h-9 w-3 bg-foreground md:h-11" />
              </span>
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="h-10 w-10 fill-foreground md:h-12 md:w-12"
                aria-hidden
              >
                <path d="M6 4v16l14-8-14-8Z" />
              </svg>
            )}
          </button>
          <Cell className="flex flex-col justify-between gap-2 p-3 md:gap-3 md:p-4">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-foreground-muted md:text-[11px]">
              <span>VOLUME</span>
              <span className="tabular-nums text-foreground">
                {String(volume).padStart(3, '0')}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => {
                const v = Number(e.target.value)
                setVolume(v)
                engineRef.current?.setMasterVolume(v / 100)
              }}
              aria-label="Volume"
              className="h-1 w-full cursor-pointer appearance-none bg-foreground/20 outline-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:rounded-none"
              style={{
                background: `linear-gradient(to right, var(--color-foreground) ${volume}%, hsl(var(--foreground) / 0.2) ${volume}%)`,
              }}
            />
            {/* segmented volume meter */}
            <div className="flex gap-1" aria-hidden>
              {Array.from({ length: 20 }, (_, i) => (
                <span
                  key={i}
                  className="h-1.5 flex-1"
                  style={{
                    background:
                      i < Math.round((volume / 100) * 20)
                        ? 'var(--color-foreground)'
                        : 'hsl(var(--foreground) / 0.1)',
                  }}
                />
              ))}
            </div>
          </Cell>
        </div>

        {/* EQ strip — eight vertical band faders with dB readouts + neutral rule */}
        <Cell
          className={`flex min-h-0 flex-col ${
            eqOpen ? 'max-h-[360px] flex-1 md:max-h-[460px]' : 'shrink-0'
          }`}
        >
          {/* EQ header with collapse toggle */}
          <div className="flex shrink-0 items-center justify-between border-b border-border px-2.5 py-1.5 md:px-5 md:py-2">
            <span className="text-[9px] uppercase tracking-widest text-foreground-muted md:text-[10px]">
              EQ / 8 BAND OCTAVE
            </span>
            <button
              onClick={() => setEqOpen((v) => !v)}
              aria-expanded={eqOpen}
              aria-label={eqOpen ? 'Collapse equalizer' : 'Expand equalizer'}
              className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-foreground-muted transition-colors hover:text-foreground md:text-[10px]"
            >
              {eqOpen ? 'COLLAPSE' : 'EXPAND'}
              <svg
                viewBox="0 0 24 24"
                className={`h-2.5 w-2.5 fill-none stroke-current stroke-2 transition-transform ${
                  eqOpen ? '' : 'rotate-180'
                }`}
                aria-hidden
              >
                <path d="M4 9l8 8 8-8" strokeLinecap="square" />
              </svg>
            </button>
          </div>
          {eqOpen && (
            <>
              {/* band labels */}
              <div className="grid shrink-0 grid-cols-8 gap-px bg-border">
                {BANDS.map((band) => (
                  <div
                    key={band}
                    className="bg-background px-0.5 py-1.5 text-center text-[9px] uppercase tracking-widest text-foreground-muted md:py-2 md:text-[11px]"
                  >
                    {band}
                  </div>
                ))}
              </div>

              {/* fader region — boost above the rule, cut below */}
              <div className="relative grid min-h-0 flex-1 grid-cols-8 gap-px bg-border">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-px bg-foreground-muted"
                />
                {BANDS.map((band, i) => {
                  return (
                    <div
                      key={band}
                      className="relative flex min-h-0 flex-col items-center justify-center bg-background"
                    >
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={eq[i]}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          setEq((prev) =>
                            prev.map((val, j) => (j === i ? v : val)),
                          )
                          engineRef.current?.setEQBand(i + 1, {
                            frequency: BAND_HZ[i],
                            gain: dbFromFader(v),
                          })
                        }}
                        aria-label={`${band} hertz band equalizer`}
                        className="eq-fader"
                        style={{ '--v': `${eq[i]}%` } as React.CSSProperties}
                      />
                    </div>
                  )
                })}
              </div>

              {/* dB readouts */}
              <div className="grid shrink-0 grid-cols-8 gap-px border-t border-border bg-border">
                {BANDS.map((band, i) => (
                  <div
                    key={band}
                    className="bg-background px-0.5 py-1.5 text-center text-[9px] font-bold tabular-nums md:text-[10px]"
                    style={{
                      color:
                        eq[i] === FADER_NEUTRAL
                          ? 'var(--color-foreground-muted)'
                          : 'var(--color-foreground)',
                    }}
                  >
                    {formatDb(eq[i])}
                  </div>
                ))}
              </div>

              {/* filter row: LOW CUT / HIGH CUT with frequency sliders */}
              <div className="grid shrink-0 grid-cols-2 gap-px border-t border-border bg-border">
                {(
                  [
                    {
                      label: 'LOW CUT',
                      on: lowCut,
                      toggle: () => {
                        const next = !lowCut
                        setLowCut(next)
                        engineRef.current?.setLowCut(next ? lowCutFreq : null)
                      },
                      freq: lowCutFreq,
                      setFreq: setLowCutFreq,
                      min: 20,
                      max: 120,
                      step: 1,
                      format: (hz: number) => `${hz} HZ`,
                    },
                    {
                      label: 'HIGH CUT',
                      on: highCut,
                      toggle: () => {
                        const next = !highCut
                        setHighCut(next)
                        engineRef.current?.setHighCut(next ? highCutFreq : null)
                      },
                      freq: highCutFreq,
                      setFreq: setHighCutFreq,
                      min: 4000,
                      max: 20000,
                      step: 100,
                      format: (hz: number) =>
                        hz >= 1000
                          ? `${Math.round(hz / 1000)}K HZ`
                          : `${hz} HZ`,
                    },
                  ] as const
                ).map((f) => (
                  <Cell key={f.label} className="flex flex-col bg-background">
                    <button
                      onClick={f.toggle}
                      aria-pressed={f.on}
                      className="flex items-center justify-between gap-1 px-2.5 py-1.5 text-left text-[9px] uppercase tracking-widest transition-colors md:px-4 md:text-[11px]"
                      style={
                        f.on
                          ? {
                              background: NOISE_FILL.WHITE,
                              color: '#17140f',
                            }
                          : { color: 'var(--color-foreground-muted)' }
                      }
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2 w-2"
                          style={{
                            background: f.on
                              ? 'var(--color-vu-green)'
                              : 'var(--color-foreground-muted)',
                          }}
                        />
                        {f.label}
                      </span>
                      <span
                        className="tabular-nums whitespace-nowrap"
                        style={
                          f.on
                            ? undefined
                            : { color: 'var(--color-foreground)' }
                        }
                      >
                        {f.format(f.freq)} {f.on ? 'ON' : 'OFF'}
                      </span>
                    </button>
                    <div className="flex items-center gap-2 border-t border-border px-2.5 py-1 md:px-4 md:py-1.5">
                      <input
                        type="range"
                        min={f.min}
                        max={f.max}
                        step={f.step}
                        value={f.freq}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          f.setFreq(v)
                          engineRef.current?.[
                            f.label === 'LOW CUT' ? 'setLowCut' : 'setHighCut'
                          ](f.on ? v : null)
                        }}
                        aria-label={`${f.label} cutoff frequency`}
                        className="h-1 w-full min-w-0 cursor-pointer appearance-none outline-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:bg-foreground"
                        style={{
                          background: `linear-gradient(to right, var(--color-foreground) ${
                            ((f.freq - f.min) / (f.max - f.min)) * 100
                          }%, hsl(var(--foreground) / 0.2) ${
                            ((f.freq - f.min) / (f.max - f.min)) * 100
                          }%)`,
                        }}
                      />
                      <span className="shrink-0 text-[8px] tabular-nums text-foreground-muted md:text-[9px]">
                        {f.format(f.freq)}
                      </span>
                    </div>
                  </Cell>
                ))}
              </div>
            </>
          )}
        </Cell>

        {/* footer */}
        <Cell className="flex shrink-0 items-center justify-between px-4 py-2 text-[10px] uppercase tracking-widest text-foreground-muted md:px-5 md:text-[11px]">
          <span>SLEEP TIMER: --:--</span>
          <span className="hidden sm:inline">NO FEEDBACK · NO PERSISTENCE</span>
          <span className="sm:hidden">--:--</span>
        </Cell>
      </div>

      <style>{`
        .preset-marquee {
          display: inline-flex;
          white-space: nowrap;
          will-change: transform;
          animation-name: preset-marquee;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        .preset-marquee > span {
          padding-right: 6ch;
        }
        @keyframes preset-marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .eq-fader {
          -webkit-appearance: none;
          appearance: none;
          writing-mode: vertical-lr;
          direction: rtl;
          width: 12px;
          height: 92%;
          background: transparent;
          cursor: pointer;
          outline: none;
        }
        .eq-fader::-webkit-slider-runnable-track {
          width: 3px;
          background: linear-gradient(
            to top,
            var(--color-foreground) var(--v),
            hsl(var(--foreground) / 0.1) var(--v)
          );
        }
        .eq-fader::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 8px;
          margin-left: -4.5px;
          background: var(--color-foreground);
          border: none;
          border-radius: 0;
        }
      `}</style>
    </main>
  )
}
