const {app,BrowserWindow,shell,dialog,Menu}=require('electron');
const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const PORT=Number(process.env.PORT||4783), HOME_URL=`http://127.0.0.1:${PORT}/`, ROOT=path.resolve(__dirname,'..');
app.setName('Shorts Factory');
let server,win,quitting=false,restarts=[];
if(!app.requestSingleInstanceLock())app.quit();
else {
 app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
 function env(){
  let loginPath='';try{loginPath=execFileSync('/bin/zsh',['-lc','printf %s "$PATH"'],{encoding:'utf8',timeout:5000});}catch{}
  return {...process.env,PATH:[loginPath,'/opt/homebrew/bin','/usr/local/bin',path.join(os.homedir(),'.local/bin'),process.env.PATH].filter(Boolean).join(':'),SHORTS_DATA:process.env.SHORTS_DATA||app.getPath('userData'),PORT:String(PORT),ELECTRON_RUN_AS_NODE:'1'};
 }
 const ping=()=>new Promise(resolve=>{const req=http.get(HOME_URL+'api/state',res=>{res.resume();resolve(res.statusCode===200);});req.on('error',()=>resolve(false));req.setTimeout(1000,()=>{req.destroy();resolve(false);});});
 async function ready(){for(let i=0;i<100;i++){if(await ping())return true;await new Promise(r=>setTimeout(r,300));}return false;}
 function launchServer(){
  const childEnv=env();fs.mkdirSync(childEnv.SHORTS_DATA,{recursive:true});const log=fs.openSync(path.join(childEnv.SHORTS_DATA,'server.log'),'a');
  server=spawn(process.execPath,['--experimental-strip-types','--no-warnings',path.join(ROOT,'src/server.ts')],{cwd:ROOT,env:childEnv,stdio:['ignore',log,log]});fs.closeSync(log);
  server.on('error',()=>dialog.showErrorBox('Shorts Factory','Le moteur ne démarre pas. Consulte server.log dans les données de l’application.'));
  server.on('exit',()=>{if(quitting)return;restarts=restarts.filter(t=>Date.now()-t<300000);restarts.push(Date.now());if(restarts.length>5){dialog.showErrorBox('Shorts Factory','Le moteur s’arrête en boucle. Consulte server.log.');return;}setTimeout(async()=>{if(quitting)return;launchServer();if(await ready()&&win)win.loadURL(HOME_URL);},3000);});
 }
 function createWindow(){
  win=new BrowserWindow({width:1480,height:960,minWidth:900,minHeight:620,title:'Shorts Factory',backgroundColor:'#0c0c0d',titleBarStyle:'hiddenInset',trafficLightPosition:{x:14,y:16},webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});win.loadURL(HOME_URL);
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//.test(url))void shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-navigate',(e,url)=>{if(new URL(url).origin!==new URL(HOME_URL).origin){e.preventDefault();if(/^https?:\/\//.test(url))void shell.openExternal(url);}});win.on('closed',()=>{win=null;});
 }
 app.whenReady().then(async()=>{Menu.setApplicationMenu(Menu.buildFromTemplate([{role:'appMenu'},{role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'}]));if(await ping()){dialog.showErrorBox('Shorts Factory',`Le port ${PORT} est déjà utilisé. Arrête npm run serve ou choisis un autre PORT.`);app.quit();return;}launchServer();if(!(await ready())){dialog.showErrorBox('Shorts Factory','Le moteur ne démarre pas. Consulte server.log.');app.quit();return;}createWindow();app.on('activate',()=>{if(!win)createWindow();});});
 app.on('window-all-closed',()=>{});app.on('before-quit',()=>{quitting=true;if(server)server.kill('SIGTERM');});
}
