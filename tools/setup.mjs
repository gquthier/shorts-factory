import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='darwin')throw new Error('The full editing/QA pipeline currently requires macOS (Apple Vision).');
execFileSync('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:path.join(root,'vendor/video-agent-skills/skills/short-editing/engine'),stdio:'inherit'});
const missing=[];
for(const [name,args] of [['ffmpeg',['-version']],['ffprobe',['-version']],['yt-dlp',['--version']],['whisper-cli',['--help']],['node',['--version']],['xcrun',['--find','swiftc']]])if(spawnSync(name,args,{stdio:'ignore'}).status!==0)missing.push(name);
if(missing.length){console.log('Missing tools: '+missing.join(', '));console.log('Install with: brew install node@22 ffmpeg yt-dlp whisper-cpp');console.log('Apple Vision compiler: xcode-select --install');}
const model=process.env.WHISPER_MODEL||path.join(os.homedir(),'whisper-models/ggml-large-v3-turbo.bin');
if(!fs.existsSync(model)){console.log('Downloading Whisper large-v3-turbo (~1.6 GB), used locally.');fs.mkdirSync(path.dirname(model),{recursive:true});execFileSync('curl',['--fail','--location','--retry','3','--output',model+'.part','https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin'],{stdio:'inherit'});if(fs.statSync(model+'.part').size<100_000_000)throw new Error('Incomplete model. Run setup again.');fs.renameSync(model+'.part',model);}
if(!fs.existsSync('/Applications/Google Chrome.app')&&!process.env.CHROME_PATH)console.log('Install Google Chrome, or set CHROME_PATH to a Chromium executable.');
console.log('Setup complete. Run npm start, then open Démarrer to connect services and personalize your profile.');
