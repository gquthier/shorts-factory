# Your own outlier research

The public repository starts empty. It includes the ranking/capture tool and methodology, not the author's research corpus, downloaded Reels, transcripts, screenshots or account list.

Connect Apify in **Démarrer**. The token is checked and saved in the macOS Keychain; connecting it does not start a paid collection. Create `watch-config.json` in the active data directory:

```json
{"accounts": {"example_creator": 40}}
```

Replace `example_creator` with actual public accounts you want to research. Use 20–500 latest Reels per account. For the CLI the data directory defaults to `./data`. For the packaged Electron app it is `~/Library/Application Support/Shorts Factory`; set `SHORTS_DATA` to that location when running the tool manually.

```bash
python3 tools/outlier_watch.py --refresh --capture
```

Collection incurs Apify charges. The tool reserves a per-run cap before polling and keeps a $10/month monitoring ledger in `research/04-hooks-fr/watch-budget.json` under the active data directory. A stopped run is resumed rather than charged again. Without `--refresh`, it only ranks existing local data. No scheduler is installed automatically in the public edition.

Capture requires ffmpeg/ffprobe, whisper-cli and the local model. To enable OCR:

```bash
mkdir -p data/research/04-hooks-fr/bin
swiftc tools/outlier_ocr.swift -o data/research/04-hooks-fr/bin/ocr
```

The baseline is at least 12 **other** same-account Reels within ±60 publication days, aged 3–365 days, excluding pinned/declared partnerships. Missing views and zero medians produce no ratio. Examine normal-performing controls alongside the outliers. Public views do not establish organic reach, retention, conversion or hook causality.

`watch.json` supplies at most five automatically transcribed/OCR opening observations to the hook writer, explicitly marked as unverified. It does not rewrite the creator's voice or the playbook. Reviewed observations may be curated in `prompt-evidence.json`; keep all research in the ignored data directory. Imported outlier tables for the UI live in `research/03-outliers/outliers.json` or `research/04-hooks-fr/outliers.json` under that directory.
