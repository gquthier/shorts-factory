# Third-party notices

Shorts Factory is MIT licensed. Third-party components retain their own licenses.

## Rendering engine and upstream skills

`vendor/video-agent-skills` comes from [Melvynx/video-agent-skills](https://github.com/Melvynx/video-agent-skills), commit `4774fa4f2601baa822fd513387202c26e4587902`, MIT, © 2026 Melvyn Malherbe. Its [license](vendor/video-agent-skills/LICENSE) is included. All thirteen upstream skill entrypoints and their source/reference files are included. Large example galleries are omitted; consult the upstream repository for those demonstrations.

The local addition to `skills/short-editing/engine/lib/runtime.js` supports `bigColor`/`bigColorAll` for the Type depth format. The engine's bundled sound effects and icons remain under the upstream distribution terms. No source videos from a creator's private workspace are included.

## Fonts

Google Fonts families (Poppins, Bricolage Grotesque, Inter Tight, Montserrat, Instrument Serif, Anton, Bowlby One SC, JetBrains Mono, Inter, DM Sans, Archivo Black and Archivo) are distributed with their original SIL Open Font License notices in `assets/font-licenses/<family>/OFL.txt`. Sources: [google/fonts](https://github.com/google/fonts). Geist Pixel is from [vercel/geist-font](https://github.com/vercel/geist-font); its license is in `assets/font-licenses/geist/`.

## Runtime dependencies

Electron: MIT. Zod: MIT. Playwright Core: Apache-2.0. MediaPipe Tasks Vision: Apache-2.0. Dependency packages retain their LICENSE/NOTICE files. FFmpeg, yt-dlp, whisper.cpp and Google Chrome/Chromium are installed separately; their licenses are not replaced by the project's MIT license.

## Template inspiration

The visual layouts were informed by public short-video conventions, including examples by Serge Gatari and Kika Donzinga. The repository contains original template code and generic instructions, not their videos, transcripts, identity or an endorsement. Public illustrations and UI screenshots use synthetic content.
