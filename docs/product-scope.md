# Ambient Noise (v2) — Product scope & backlog

Adapted and de-stale'd from the v1 SaaS product docs (user-stories, MVP plan,
feature roadmap). v2 is **web-only, personal use, one screen**. Most v1 personas,
monetization, onboarding, and headphone-profile scope no longer applies and is
deliberately dropped.

## Intent

A personal, browser-based noise instrument: generate white/pink/brown noise and
shape it with an 8-band EQ plus low/high cut filters. Sleep better, focus deeper.
Runs locally in the browser, installable as a PWA, hosted free on Vercel.

## What exists (working, verified)

- Play/pause one of three generated noises (white/pink/brown) — infinite,
  non-looping, click-free crossfade between colors.
- 8-band vertical EQ (63 Hz–8 kHz), ±12 dB/band, live dB readouts, neutral 0 dB
  rule, EQ collapse/expand.
- LOW CUT (20–120 Hz) and HIGH CUT (4k–20k) filters with per-preset settings.
- 5 presets (Evening Drift, Rain On Tin, Deep Space Hum, Airy Meadow, Night
  Harbour) — each drives noise color + EQ + cut filters.
- Volume slider + segmented meter.
- STANDBY/RUNNING lamp, pause/resume, no vertical scroll at target viewports.
- PWA: manifest + service worker + generated icons.

## Non-goals (out of scope for v2)

- Mobile/Expo app, iOS/Android native.
- Accounts, backend, sync, persistence of user settings.
- Analytics, consent, onboarding, monetization, ads.
- Headphone profiles, presets library browser, save-as-preset, sleep timer UI,
  export to file, media-session lock-screen controls, light mode.
- Second routes / multi-page.

## User stories (adapted, web-only)

Acceptance criteria are the AGENTS.md invariants + WATCHDOG checks for this repo.

### US-1: Play generated noise
As a user, I want to pick a noise color and hear it, so I have a masking sound.

- Offers exactly white/pink/brown.
- Audio generated locally (Web Audio), not from a file; infinite, no seam.
- Only one color at a time; switching crossfades (500 ms), no clicks.
- Play must be a user gesture (autoplay policy); engine inits on the play button.
- RUNNING lamp reflects engine truth (onStateChange).

### US-2: Pause / resume
As a user, I want to pause and resume, so I can hear conversations/calls.

- Pause → silence + STANDBY; resume → RUNNING.

### US-3: Shape with EQ
As a user, I want to adjust the 8 bands, so the noise fits my space.

- Each fader maps to its labeled octave center (explicit frequency pushed to the
  engine), ±12 dB, 50 = 0 dB; dB readout matches the fader.

### US-4: Apply cut filters
As a user, I want low/high cut, so I remove rumble/hiss.

- LOW CUT highpass 20–120 Hz; HIGH CUT lowpass 4k–20k; on/off + cutoff slider;
  active filter renders off-white `#F9FFD0`.

### US-5: Use presets
As a user, I want presets, so I get a good starting point fast.

- 5 presets; each sets noise color + all 8 EQ bands + cut filters; arrows cycle
  with wrap-around; no layout regressions.

## Forward backlog (only if it earns its place)

- Persist last preset/noise/volume across reloads (localStorage only, no backend).
- Sleep timer with fade-out.
- Keyboard shortcuts (space = play/pause).
- Export current mix to a WAV (OfflineAudioContext).
- More presets or a simple user EQ save (localStorage).

Backlog items must stay local-only and web-only; anything requiring a backend or
a second platform is a deliberate re-scope decision, not an assumption.
