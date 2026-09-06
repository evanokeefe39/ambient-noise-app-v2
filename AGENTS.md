# AGENTS.md — Ambient Noise (v2)

On-first-read reference for an AI assistant dropped into this repo. Read this
before touching code. The harness-level factory instructions live at
`C:/Users/evano/.omp/agent/AGENTS.md` — they govern runtime behavior, planning,
and delivery. This file governs project-specific knowledge: what we're building,
how it's put together, and the gotchas that trip people up.

## What this is

A minimal, web-only ambient-noise instrument for personal use. One screen, one
route (`/`). You shape generated noise (white/pink/brown) with an 8-band EQ plus
LOW CUT / HIGH CUT filters. Deployed free on Vercel, installable as a PWA. No
accounts, no backend, no analytics, no users to support.

**It is v2** of an earlier iOS+web SaaS project (see the V1 reference in
`README.md`). v2 intentionally dropped: the mobile/Expo app, all SaaS/product
features (headphone profiles, presets library, sleep timer UI, sheets,
onboarding, consent, storage/session, PostHog analytics), and the monorepo
workspace packages. Do not reintroduce that scope.

## Stack & layout

- Next.js 15 (App Router), React 19, TypeScript (strict), Tailwind v4, pnpm.
- Flat single app — no workspaces, no `@ambient/*` packages.
- Paths: `@/*` → `./src/*`.

```
src/app/page.tsx              # the entire UNIT-02 player UI (single client component)
src/app/layout.tsx            # fonts (Inter/JetBrains Mono/Space Mono) + PWA metadata + SW reg
src/app/globals.css           # Tailwind v4 @theme design tokens
src/lib/audio/AudioEngine.ts  # Web Audio graph (singleton via getAudioEngine)
src/lib/audio/eq-chain.ts     # 8-band serial Biquad EQ chain
src/lib/audio/noise-fallback.ts # ScriptProcessorNode fallback generators
src/lib/shared/audio-types.ts # vendored types/constants (EQ, NoiseColor, IAudioEngine)
public/worklets/              # AudioWorklet processors (white/pink/brown)
public/{manifest.json, sw.js, icon*.svg/png}  # PWA
```

## The audio engine

`src/lib/audio/AudioEngine.ts` is a singleton (`getAudioEngine()`). Graph:

```
[NoiseSource] → [CrossfadeGain] → [LowCut hp] → [HighCut lp]
  → [EQChain 8-band] → [HeadphoneEQ: always flat] → [MasterGain] → [Destination]
```

- **Noise** is generated locally per color via AudioWorklet with a
  ScriptProcessorNode fallback. Switching colors crossfades over 500 ms (no clicks).
- **LOW CUT (highpass) / HIGH CUT (lowpass)** are Biquad filters inserted before
  the user EQ. When off they sit at transparent defaults (20 Hz / 20 kHz). Driven
  by `setLowCut(hz|null)` / `setHighCut(hz|null)`.
- **8-band EQ**: band centers are seeded from `DEFAULT_EQ_BANDS` (the legacy ISO
  set 31 Hz–16 kHz) but the page overrides the center frequency on every
  `setEQBand(index, { frequency, gain })` to its own octave set
  (63 Hz–8 kHz = `BAND_HZ` in `page.tsx`). Never rely on the engine's default band
  centers to match the UI labels — the UI always pushes an explicit frequency.
- **Autoplay**: `AudioContext` may only be created/resumed inside a user-gesture
  handler. `initialize()` is called lazily on the play button only.
- **iOS lock-screen**: MasterGain routes through a MediaStreamDestination into an
  appended `<audio>` element so audio survives screen lock. Harmless on desktop.
- **Fader math** (`page.tsx`): EQ faders are 0–100 where 50 = 0 dB and full scale
  is ±12 dB (`FADER_NEUTRAL = 50`, `FADER_SCALE_DB = 12`). `dbFromFader(v)`
  converts to dB. Volume slider is 0–100 and maps to the engine's 0–1 master gain
  by dividing by 100.

## Design language — UNIT-02

"Terminal / UNIT 02" brutalist mono instrument panel. Non-negotiables:
JetBrains Mono, hard 1px rules, square/zero-radius controls, uppercase labels,
STANDBY/RUNNING lamp, segmented meter, viewport fit.

- **No vertical page scrollbar** at 360/375/390 × ~667/844 and ~1280×800, with EQ
  both open and collapsed. Guard this against regressions.
- **Design tokens** live in `globals.css` `@theme` (`--color-background`,
  `--color-surface`, `--color-foreground`, `--color-foreground-muted`,
  `--color-border`, `--color-vu-green`, `--font-mono`). Keep them here.
- **Noise fills** (`NOISE_FILL` in `page.tsx`): WHITE `#F9FFD0` (off-white),
  PINK `#F00E68`, BROWN `#F14F2B`. The active LOW/HIGH CUT button ON-fill uses the
  off-white `#F9FFD0` and dark text — it matches the selected WHITE noise button.
- **Label contrast**: selected noise / filter-on labels use pure black `#000000`
  text so they clear WCAG AA on the saturated PINK/BROWN fills. Don't regress to
  near-black or white text there.

## Workflow

- `pnpm dev` → http://localhost:3000. `pnpm typecheck`, `pnpm build`, `pnpm start`.
- Audio must be verified in a real browser (autoplay + actual output), not just
  typechecked. The RUNNING/STANDBY lamp is engine-truth (driven by
  `onStateChange`), so a play that stays STANDBY means the engine threw.
- Vercel deploys on push to `main`; no CI workflow is kept in this repo.
- Keep it lean. Single route, no new state-management or animation libraries
  unless genuinely required.

## Stop boundary

If the user says stop (explicitly, in any form), stop immediately and do not
resume until they explicitly continue.
