# LEARNINGS.md — Ambient Noise (v2)

Reverse-chronological lessons. Each entry: what happened, the root cause, and the
rule so it isn't relearned. The factory-level `~/.omp/agent/AGENTS.md` holds the
general version; this file is Ambient-specific.

## 2026-09-06 — Initial port (v1 monorepo → v2 flat app)

**Observed.** v2 was created by porting the winning UNIT-02 surface out of a v1
pnpm monorepo (`repo/` with `apps/web` + `packages/shared` + `packages/ui`). The
git repository root of v1 was actually the parent `ambient-noise-app/` directory,
with the monorepo nested at `repo/` and ~114 tracked files (product docs,
screenshots, `ux-design/` images) around it.

**Learned / rules.**

1. **A single screen with a lazy Web-Audio engine needs no packages.** v1's
   `@ambient/shared` and `@ambient/ui` existed for the mobile app and a legacy
   SaaS player. The UNIT-02 home surface needed only ~6 type/const definitions
   plus `DEFAULT_EQ_BANDS`. v2 vendors them in one file
   (`src/lib/shared/audio-types.ts`), zero workspace deps. When porting, check
   what a surface *actually imports*, not what the package exports.
2. **Legacy-only symbols can be stubbed, not carried.** `getHeadphoneProfileById`
   was reachable only from the deleted legacy Player, never the UNIT-02 page, but
   `AudioEngine` still imported it. v2 keeps a stub returning `undefined` rather
   than vendoring a 5-profile JSON dataset. Trim to what runs.
3. **Byte-exact copies beat transcription.** Ported verbatim files
   (`page.tsx`, `AudioEngine.ts`, `eq-chain.ts`, `noise-fallback.ts`, worklets,
   `globals.css`) were copied with `cp`, never retyped. Only import lines were
   rewritten (via a precise `perl` substitution, not hand-edits, because the v2
   dir is outside the agent workspace so `edit` can't target it). Retyping a
   ~680-line component guarantees drift.
4. **Tailwind v4 has no `tailwind.config`** — design tokens live in the
   `@theme {}` block of `globals.css`. Don't add a config file or autoprefixer.
5. **EQ band centers are a classic label/reality mismatch.** The engine seeds its
   8 bands at legacy ISO centers (31 Hz–16 kHz); the UI labels them 63 Hz–8 kHz.
   The fix is to pass an explicit `frequency` with every `setEQBand`, never to
   trust engine defaults. (See AGENTS.md.)
6. **Autoplay policy is absolute.** `AudioContext.initialize()` must run only
   inside a user-gesture handler (the play button), never in a mount effect.
7. **Typecheck first run is slow** (cold `tsc` ~2 min on this box). Budget for it;
   don't treat a timeout as a failure — re-run with a longer window and capture
   output to a file rather than tailing a piped stream.
