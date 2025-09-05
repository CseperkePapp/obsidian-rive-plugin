# Plugin Status & Next Steps

Date: 2025-09-05
Branch: feature/multi-animations

## Current Core Features
- Multi animation selection & buttons
- State machine input discovery & trigger buttons
- Frontmatter defaults (autoplay, loop, renderer)
- Renderer choice (canvas/webgl/webgl2)
- Layout fit & alignment
- Aspect ratio + intrinsic sizing
- Asset loader (vault-relative / note-relative / remote base)
- Performance pause (visibility + intersection)
- Hotkeys (space toggle, R restart)
- Buffer caching of ArrayBuffers
- Version consistency check for Rive packages
- Load diagnostics (onLoadError overlay, timeout logging, config debug)

## Known Issues / Observations
- Some newly exported .riv files time out: suspected runtime version mismatch with newer format.
- No explicit user feedback when animation/stateMachine names are not found (silent fallback).
- onLoadError overlay is generic (no error detail in UI).
- No command palette hooks for individual state machine inputs.
- Potential improvement: parsed file caching (beyond raw buffer) for performance.

## Immediate Next Actions (Proposed)
1. Add runtime version bump automation script (npm run update-rive) with unified version enforcement (fail build if mismatch).
2. Surface detailed error message (first 120 chars) on overlay with click-to-expand.
3. Provide validation summary listing unknown animations/stateMachines (greyed buttons or warning text).
4. Add commands: "Rive: Fire input <name>" dynamically for last instance.
5. Optional canvas fallback: if webgl/webgl2 init throws, retry with canvas automatically.

## Longer-Term Ideas
- State machine input binding via frontmatter (e.g., riveInputs: { hover: fireName }).
- Snapshot/export utilities (if re-added to roadmap).
- Advanced caching or pooling of Rive runtime instances.
- Performance metrics panel (frame time, paused counts).

## Decision Log
- Removed scrubber/export from short-term roadmap (can revisit after stability).
- MIT license adopted with attribution to original scaffold.
- Diagnostic logging added instead of immediate runtime bump (will reassess next session).

## Open Questions
- Do we want automatic remote fetch of newer runtime on parse failure?
- Should ratio override intrinsic size when both provided? (Currently yes.)

---
_Update this file at session start/end._
