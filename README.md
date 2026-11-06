<div align="center">

<img src="https://img.shields.io/badge/CREATIVE-SHORT%20VIDEO-9E6EFA?style=flat-square&labelColor=9E6EFA&color=101014" alt="CREATIVE · SHORT VIDEO">

<br><br>

<img src="assets/banner.svg" alt="Shorts Factory — your footage, your voice, your studio" width="100%">

# Shorts Factory

### Your long videos. Your next short-form library.

An open-source Electron studio for turning your own videos into vertical clips.<br>Find the useful moments, write grounded hooks, render, review, publish and learn.<br>Bring your voice. Connect your services. Keep control of the edit.

<br>

[**Download for macOS · Apple Silicon**](https://github.com/gquthier/shorts-factory/releases/latest) · [**Explore the studio**](https://gquthier.github.io/shorts-factory/) · [**Get started**](#start-from-source)

<br>

<a href="https://bizos.cc"><img src="https://img.shields.io/badge/BizOS-build%20autonomous%20companies-0A0A0A?style=for-the-badge&labelColor=0A0A0A" alt="BizOS"></a>

<br><br>

<a href="https://x.com/gauthierthiry"><img src="https://img.shields.io/badge/@gauthierthiry-101014?style=flat-square&logo=x&logoColor=white" alt="X"></a>
<a href="https://youtube.com/@gquthier"><img src="https://img.shields.io/badge/@gquthier-FF0000?style=flat-square&logo=youtube&logoColor=white" alt="YouTube"></a>
<img src="https://img.shields.io/badge/license-MIT-101014?style=flat-square" alt="MIT">
<a href="https://github.com/gquthier/shorts-factory/actions/workflows/test.yml"><img src="https://github.com/gquthier/shorts-factory/actions/workflows/test.yml/badge.svg" alt="Tests"></a>

<br><br>

<sub>6 formats · 9 project skills + 13 upstream skills · word-level captions · review queue · channel analytics</sub>

**English** · [Français](README.fr.md)

</div>

---

## A studio that starts with you

Open **Démarrer**. Connect a provider, describe your audience, and add a few examples of your own writing. Keys are verified before being saved to macOS Keychain. There is no shared account, preloaded creator profile or private research corpus.

<img src="docs/media/start.png" alt="First-run setup with four service connections and a creator profile" width="100%">

| Service | What it does | Required? |
|---|---|---|
| **Anthropic API or Claude CLI** | Extract selection, editing decisions, hooks and ideas | One text-generation option |
| **ElevenLabs** | More precise word timestamps | Optional; local Whisper is the fallback |
| **TryPost** | Publish to connected channels and retrieve metrics | Optional; local export works without it |
| **Apify** | Collect public Reels for your own outlier research | Optional; collection is a separate action |

The software is free; provider usage may cost money. Video editing runs on your Mac. Text, audio or approved media is sent to the service you choose for that task. [Data and security](SECURITY.md).

## From a long recording to a reviewed clip

**Import → Transcribe → Find moments → Cut → Write hooks → Render → Check → Review → Publish → Learn**

- **Own videos in, useful moments out.** Import a file or a video URL you have rights to use. Word timings guide the cuts and captions.
- **Hooks with something behind them.** Each candidate includes a specific viewer question and an exact passage that answers it. A second judgment checks voice, faithfulness, clarity and opening coherence.
- **Review before release.** Inspect the clip, change its hook or format, and rerender. Automatic approval and automatic publishing start off.
- **Learn per channel.** Filter views, impressions, reach and interactions. Compare format/topic medians, correct topic labels and generate ideas from a frozen selection of evidence.
- **A queue that can resume.** SQLite-backed jobs, provider retry handling, quality checks and local exports.

## All six formats, with their skills

<img src="assets/formats.svg" alt="Six generic layout diagrams: split board, black frame, cinema talk, selfie headline, Q&A card and type depth" width="100%">

| Format | Best suited to | Instructions |
|---|---|---|
| **Split board** | Explanation above the speaker; timed visual beats | [Skill](skills/format-split-board/SKILL.md) · [Code](templates/split-board/template.mjs) |
| **Black frame** | Screen recordings and horizontal footage | [Skill](skills/format-black-frame/SKILL.md) · [Code](templates/black-frame/template.mjs) |
| **Cinema talk** | Talking head, restrained captions and punch-ins | [Skill](skills/format-cinema-talk/SKILL.md) · [Code](templates/cinema-talk/template.mjs) |
| **Selfie headline** | One persistent headline over a vertical clip | [Skill](skills/format-selfie-headline/SKILL.md) · [Code](templates/selfie-headline/template.mjs) |
| **Q&A card** | Questions, teaching and interview extracts | [Skill](skills/format-qa-card/SKILL.md) · [Code](templates/qa-card/template.mjs) |
| **Type depth** | Opening words behind the speaker and stacked emphasis | [Skill](skills/format-typo-depth/SKILL.md) · [Code](templates/typo-depth/template.mjs) |

The same brand configuration feeds all formats. Change colors/fonts in [`templates/brand.mjs`](templates/brand.mjs). Screen recordings fall back to a compatible layout instead of being cropped into a face format.

The agent instructions also cover the [pipeline](skills/shorts-pipeline/SKILL.md), [hooks](skills/shorts-hooks/SKILL.md) and [performance loop](skills/shorts-performance/SKILL.md). Ask your coding agent to read the relevant `SKILL.md` in this checkout. The thirteen [upstream video skills](vendor/video-agent-skills/skills) are included with their MIT license; they are optional agent workflows, not all features exposed by this app. [Engine credits and licenses](THIRD_PARTY_NOTICES.md).

## Start from source

**macOS, Node 22.18+, Google Chrome/Chromium and Apple Command Line Tools.** The full rendering and QA pipeline currently depends on Apple Vision. The interface and most editing heuristics are French first; profile languages are configurable, but other languages have not received the same end-to-end validation.

```bash
git clone https://github.com/gquthier/shorts-factory.git
cd shorts-factory
brew install node@22 ffmpeg yt-dlp whisper-cpp
export PATH="$(brew --prefix node@22)/bin:$PATH"
xcode-select --install  # only if the Command Line Tools are missing
npm ci
npm run setup
npm start
```

`npm run setup` installs the bundled rendering engine's dependencies and downloads the local Whisper model (~1.6 GB) if missing. Install Google Chrome or set `CHROME_PATH`. The setup screen lists missing tools. With Claude CLI, install/authenticate it separately using `claude auth login`; with an Anthropic key, the CLI is unnecessary for text generation.

For the browser UI: `npm run serve`, then open `http://127.0.0.1:4783`. CLI tasks: `npm run factory -- status`. Build a distributable application with `npm run app:build`; output is under `dist/` and includes the source/runtime dependencies, with no pointer to your checkout.

### Downloaded app

Download the ZIP from [Releases](https://github.com/gquthier/shorts-factory/releases/latest), unzip and move **Shorts Factory.app** to Applications. You still need the local video tools listed above, Chrome and the Whisper model. The first release is not Apple notarized; macOS may require **System Settings → Privacy & Security → Open Anyway** after the first launch attempt.

### Your data

The packaged app stores its data in `~/Library/Application Support/Shorts Factory`. The source CLI/server defaults to `./data`. Set `SHORTS_DATA` to choose another directory. Keys live in the Keychain account `shorts-factory-open-source`; they are not stored in the profile, SQLite database or browser storage. Back up your data directory separately. Exported videos are in its `exports/` folder.

## Make the next batch better

The Performance screen keeps views, impressions and reach separate; unavailable values stay unknown. Interactions mean likes + comments + shares, with saves shown separately. Findings compare mature clips within the same channel and remain hypotheses, not proof of causality. [Research and optional outlier monitoring](docs/research.md).

## Development

```bash
npm test
python3 -m unittest discover -s test -p '*_test.py'
node --no-warnings tools/render-smoke.ts
```

Tests use isolated data and simulated providers. The render smoke uses generated media and no paid API. See [CONTRIBUTING](CONTRIBUTING.md) for checks and known platform limits. The initial API adapter is verified with contract tests; this is not a claim that every paid provider or creator niche has been tested live.

---

<div align="center">

Built by [Gauthier](https://x.com/gauthierthiry) · [BizOS](https://bizos.cc)<br>
Rendering engine and upstream skills by [Melvyn Malherbe](https://github.com/Melvynx/video-agent-skills).<br>
[MIT](LICENSE) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

</div>
