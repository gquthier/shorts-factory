// Run on the exact git index before publishing. Never print file contents.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
if(!files.length)throw new Error('No staged/tracked files to audit. Stage the intended public source first.');
const problems=[];
for(const file of files){
 if(/(^|\/)(data|inbox|out|research|node_modules|\.ssh|\.config|__pycache__)\//.test(file)||/\.(db|sqlite|pem|key|mp4|wav|zip|dmg)(-|$)/i.test(file)||/(^|\/)\.env(\.|$)/.test(file))problems.push(file+': private/runtime artifact');
 const data=execFileSync('git',['show',':'+file],{maxBuffer:30*1024*1024});
 if(data.length>20*1024*1024)problems.push(file+': oversized file');
 if(!/\.(ttf|woff2|png|jpg|jpeg|mp3|icns)$/.test(file)&&!data.includes(0)){
  const text=data.toString();
  if(/\/Users\/[a-zA-Z0-9._-]+\//.test(text))problems.push(file+': machine-specific home path');
  if(/-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----/.test(text))problems.push(file+': private key');
  if(/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-ant-api\d+-[A-Za-z0-9_-]{40,})/.test(text))problems.push(file+': credential pattern');
 }
}
if(problems.length){console.error(problems.join('\n'));process.exit(1);}
console.log(`Public-source audit passed for ${files.length} staged files. Run gitleaks as the independent secret scan.`);
