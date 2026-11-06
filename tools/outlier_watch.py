#!/usr/bin/env python3
"""Public Reel monitoring. Credentials stay in Keychain; no posting or messages.
Run --refresh to collect, or no flag to rebuild the local rankings without charges.
"""
import argparse, concurrent.futures, datetime as dt, fcntl, json, math, os, pathlib, statistics, subprocess, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA_ROOT = pathlib.Path(os.environ.get('SHORTS_DATA', ROOT / 'data'))
DATA = DATA_ROOT / 'research/04-hooks-fr'
WATCH_CONFIG = DATA_ROOT / 'watch-config.json'
watch_config = json.loads(WATCH_CONFIG.read_text()) if WATCH_CONFIG.exists() else {}
ACCOUNTS = {h: min(500, max(20, int(n))) for h, n in watch_config.get('accounts', {}).items() if h and all(c.isalnum() or c in '._' for c in h)}
UTC = dt.timezone.utc

def write_json(file, data):
    file.parent.mkdir(parents=True, exist_ok=True)
    temp = file.with_suffix(file.suffix + '.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    temp.replace(file)

def rank_accounts(raw, now):
    ranked, summary = [], []
    for handle, posts in raw.items():
        rows = []
        for p in {p.get('shortCode'): p for p in posts if p.get('shortCode')}.values():
            views = p.get('videoPlayCount')
            if isinstance(views, bool) or not isinstance(views, (int, float)) or not math.isfinite(views) or views < 0:
                continue
            try: age = (now - dt.datetime.fromisoformat(p['timestamp'].replace('Z', '+00:00'))).total_seconds() / 86400
            except (KeyError, ValueError, TypeError): continue
            rows.append(dict(handle=handle, id=p['shortCode'], url=p.get('url'), views=views, likes=p.get('likesCount'), comments=p.get('commentsCount'), date=p['timestamp'], age_days=round(age, 2), pinned=bool(p.get('isPinned')), paid=bool(p.get('paidPartnership')), duration=p.get('videoDuration'), caption=p.get('caption', ''), videoUrl=p.get('videoUrl'), audioUrl=p.get('audioUrl'), collected_at=p.get('_collected_at')))
        eligible = [r for r in rows if 3 <= r['age_days'] <= 365 and not r['pinned'] and not r['paid']]
        for r in rows:
            cohort = [x['views'] for x in eligible if x['id'] != r['id'] and abs(x['age_days'] - r['age_days']) <= 60]
            r['baseline_n'] = len(cohort)
            r['baseline'] = statistics.median(cohort) if len(cohort) >= 12 else None
            r['ratio'] = round(r['views'] / r['baseline'], 2) if r['baseline'] else None
        outliers = [r for r in rows if 3 <= r['age_days'] <= 365 and not r['paid'] and r['ratio'] is not None and r['ratio'] >= 3]
        summary.append(dict(handle=handle, collected=len(rows), eligible=len(eligible), outliers_3x=len(outliers), median=statistics.median(r['views'] for r in eligible) if eligible else None, date_from=min((r['date'] for r in rows), default=None), date_to=max((r['date'] for r in rows), default=None)))
        ranked.extend(rows)
    return ranked, summary

def api(route, token, payload=None):
    req = urllib.request.Request('https://api.apify.com/v2/' + route, data=json.dumps(payload).encode() if payload is not None else None, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=45))

def refresh():
    if not ACCOUNTS: raise RuntimeError('Add account handles to data/watch-config.json first. See docs/research.md.')
    token = os.environ.get('SHORTS_FACTORY_APIFY') or subprocess.check_output(['security', 'find-generic-password', '-a', 'shorts-factory-open-source', '-s', 'SHORTS_FACTORY_APIFY', '-w'], text=True, stderr=subprocess.DEVNULL).strip()
    month = dt.datetime.now(UTC).strftime('%Y-%m')
    ledger_file = DATA / 'watch-budget.json'
    ledger = json.loads(ledger_file.read_text()) if ledger_file.exists() else {'month': month, 'spent_usd': 0, 'runs': {}}
    if ledger['month'] != month: ledger = {'month': month, 'spent_usd': 0, 'runs': {}}
    for handle, count in ACCOUNTS.items():
        cap = round(.01 + count * .003, 2)
        previous = ledger['runs'].get(handle)
        if previous and not previous.get('settled'):
            run = previous
        else:
            if ledger['spent_usd'] + cap > 10: raise RuntimeError('Monthly monitoring budget of $10 reached; existing evidence retained.')
            r = api(f'acts/apify~instagram-reel-scraper/runs?maxTotalChargeUsd={cap}', token, {'username': [handle], 'resultsLimit': count})['data']
            run = {'id': r['id'], 'dataset': r['defaultDatasetId'], 'reserved': cap, 'settled': False}
            ledger['spent_usd'] += cap  # reserve before waiting, so an interrupted run cannot exceed the cap
            ledger['runs'][handle] = run
            write_json(ledger_file, ledger)
        for _ in range(120):
            state = api('actor-runs/' + run['id'], token)['data']
            if state['status'] in ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']: break
            time.sleep(5)
        else: raise RuntimeError('Collection still running; saved run will be resumed next time.')
        ledger['spent_usd'] += float(state.get('usageTotalUsd', run['reserved'])) - run['reserved']
        run['settled'] = True
        write_json(ledger_file, ledger)
        if state['status'] != 'SUCCEEDED': raise RuntimeError(f'Collection {handle}: {state["status"]}')
        incoming = api('datasets/' + run['dataset'] + '/items?clean=true', token)
        valid = [p for p in incoming if p.get('shortCode') and p.get('ownerUsername') == handle]
        if not valid: raise RuntimeError(f'No verified public posts for {handle}; existing data retained.')
        file = DATA / 'raw' / (handle + '.json')
        existing = json.loads(file.read_text()) if file.exists() else []
        merged = {p['shortCode']: p for p in existing if p.get('shortCode')}
        collected = dt.datetime.now(UTC).isoformat()
        for p in valid: p['_collected_at'] = collected; merged[p['shortCode']] = p
        write_json(file, list(merged.values()))
        print(handle, len(valid), 'public reels refreshed', flush=True)

def capture(row):
    """Opening observations only. Keep raw OCR separate from a verified screen headline."""
    id = row['id']; media = DATA / 'media' / (id + '.mp4'); wave = DATA / 'media' / (id + '.wav')
    frame = DATA / 'frames' / (id + '-0.5.jpg'); tx = DATA / 'transcripts' / (id + '.json')
    for folder in [media.parent, frame.parent, tx.parent]: folder.mkdir(parents=True, exist_ok=True)
    def run(args, timeout=60): return subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout)
    if not media.exists() or media.stat().st_size < 100:
        run(['ffmpeg', '-nostdin', '-v', 'error', '-rw_timeout', '20000000', '-i', row['videoUrl'], '-t', '20', '-vf', 'scale=360:-2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-threads', '1', '-c:a', 'aac', '-y', str(media)], 90)
    if not frame.exists(): run(['ffmpeg', '-nostdin', '-v', 'error', '-ss', '0.5', '-i', str(media), '-frames:v', '1', '-y', str(frame)])
    if not tx.exists():
        probe = json.loads(run(['ffprobe', '-v', 'error', '-select_streams', 'a', '-show_streams', '-of', 'json', str(media)]).stdout)
        audio = str(media) if probe.get('streams') else row.get('audioUrl')
        if audio:
            run(['ffmpeg', '-nostdin', '-v', 'error', '-rw_timeout', '20000000', '-i', audio, '-t', '20', '-ac', '1', '-ar', '16000', '-y', str(wave)])
            run(['whisper-cli', '-m', str(pathlib.Path.home() / 'whisper-models/ggml-large-v3-turbo.bin'), '-f', str(wave), '-l', 'fr', '-oj', '-of', str(tx.with_suffix('')), '-t', '4'], 120)
    spoken = ''
    if tx.exists(): spoken = ' '.join(t['text'].strip() for t in json.loads(tx.read_text()).get('transcription', []))
    if any(x in spoken.lower() for x in ['société radio-canada', 'sous-titrage st', 'sous-titres réalisés']): spoken = ''
    ocr_binary = DATA / 'bin/ocr'
    screen = ''
    if ocr_binary.exists():
        ocr = json.loads(run([str(ocr_binary), str(frame)]).stdout.strip())
        screen = ' | '.join(line['text'] for line in ocr.get('lines', []) if line.get('confidence', 0) >= .5)
    # Under 25 quoted words per source, shared between spoken and visual excerpts.
    return {'spoken_excerpt': ' '.join(spoken.split()[:12]), 'screen_ocr_excerpt': ' '.join(screen.split()[:12]), 'observation': 'Transcription et OCR automatiques des premières secondes ; le texte peut contenir des erreurs ou des sous-titres, pas forcément un titre.'}

def rebuild(capture_new=False):
    raw = {h: json.loads((DATA / 'raw' / (h + '.json')).read_text()) for h in ACCOUNTS if (DATA / 'raw' / (h + '.json')).exists()}
    rows, summary = rank_accounts(raw, dt.datetime.now(UTC))
    write_json(DATA / 'watch-ranked.json', rows)
    manual_file = DATA / 'prompt-evidence.json'
    manual = json.loads(manual_file.read_text()) if manual_file.exists() else {}
    known = {c['id'] for c in manual.get('examples', [])}
    pool = sorted([r for r in rows if r['id'] not in known and 3 <= r['age_days'] <= 90 and not r['paid'] and (r['ratio'] or 0) >= 3], key=lambda r: (r['date'], r['ratio']), reverse=True)
    # Keep varied accounts; a single high-volume account must not monopolize the evidence.
    candidates = []
    for h in ACCOUNTS:
        candidates.extend([r for r in pool if r['handle'] == h][:1])
    observations = []
    if capture_new:
        for row in candidates:
            try:
                observed = capture(row)
                observations.append({**{k: row[k] for k in ['id', 'handle', 'url', 'views', 'ratio', 'baseline', 'baseline_n', 'date', 'collected_at']}, **observed})
            except Exception as e: print('Opening unavailable:', row['id'], type(e).__name__, flush=True)
    watch = {'updated_at': dt.datetime.now(UTC).isoformat(), 'method': 'Ratio versus the median of at least 12 OTHER same-account reels posted within 60 days, aged 3–365 days; pinned and declared partnerships excluded from baseline. Public plays do not establish organic reach or hook causality.', 'summary': summary, 'candidates': [{k: r[k] for k in ['id', 'handle', 'url', 'views', 'ratio', 'baseline', 'baseline_n', 'date']} for r in candidates], 'observations': observations}
    write_json(DATA / 'watch.json', watch)
    return watch

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--refresh', action='store_true'); parser.add_argument('--capture', action='store_true'); args = parser.parse_args()
    DATA.mkdir(parents=True, exist_ok=True)
    with (DATA / '.watch.lock').open('w') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return
        if args.refresh: refresh()
        result = rebuild(args.capture)
        print(json.dumps({'updated_at': result['updated_at'], 'accounts': len(result['summary']), 'candidates': len(result['candidates']), 'openings': len(result['observations'])}))
if __name__ == '__main__': main()
