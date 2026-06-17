# Audio Roadmap

Lightweight planning note for future audio work in tiles.

## Current State

- Tile Builder has display-only waveform strips under video timeline tracks.
- Waveform images are source-owned cached media assets, not composition data.
- The waveform strip is a visual aid only; it does not change render/audio-mix behavior.

## Direction

Future audio editing should follow the same non-destructive composition model as video timeline editing:

- Source media should remain untouched.
- Audio edits should be stored as composition/timeline metadata.
- The same source clip used multiple times may have different audio settings per timeline instance.
- UI should make audio changes visible and reviewable before export.

## Likely First Features

These are expected to be useful before any deep audio-editor architecture is chosen:

- **Loudness normalization / volume matching** — make clips in a composition feel roughly consistent in volume.
- **Per-clip gain** — simple gain adjustment, likely in dB, stored on the clip instance.
- **Mute controls** — mute a clip, tile/track, or maybe selected audio source.
- **Volume automation / envelope points** — Audacity-style line/points over a clip, e.g. low to high volume over time.

A possible future clip-instance shape could be:

```ts
audio?: {
  muted?: boolean;
  gain_db?: number;
  normalize?: boolean;
  volume_points?: Array<{
    time: number; // seconds within this clip instance
    gain_db: number;
  }>;
}
```

This is illustrative, not a committed schema.

## Library / Engine Choice

Do **not** choose a dedicated audio library yet.

Start with the editing model and user workflows. Prefer export-time FFmpeg/filter-graph implementation for simple gain, fades, normalization, mixing, and envelopes until requirements prove that a dedicated audio engine is needed.

A deeper library decision should wait until tiles is actually trying to support Shotcut/Audacity-style editing features and the limitations of FFmpeg-only processing are clear.

## Non-Goals For Now

- No destructive audio edits to source files.
- No dedicated audio engine/library selection.
- No plugin architecture.
- No full DAW/Audacity clone commitment.
