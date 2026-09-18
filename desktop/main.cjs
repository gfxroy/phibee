const {app,BrowserWindow,ipcMain,dialog,Menu,Notification,session,shell}=require('electron');
const path=require('node:path');
const {stateRoot,killTree}=require('./platform.cjs');
const fs=require('node:fs/promises');
const {pathToFileURL}=require('node:url');
let win,engine,quitting=false;
// Preserve existing projects, MCP state lookup and token history across the rename.
app.setPath('userData',stateRoot());
app.setName('Phibee');
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});

async function capture(url,viewport,dir,signal){
  const preview=new BrowserWindow({show:false,title:'Phibee · Verifying page',width:viewport.width,height:viewport.height,useContentSize:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,partition:'align-verification',backgroundThrottling:false}});
  const errors=[];let timedOut=false;
  const close=()=>{if(!preview.isDestroyed())preview.destroy();};
  const timeout=setTimeout(()=>{timedOut=true;close();},45000);
  signal?.addEventListener('abort',close,{once:true});
  preview.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  const localNavigation=(e,target)=>{try{if(!['localhost','127.0.0.1','[::1]'].includes(new URL(target).hostname))e.preventDefault();}catch{e.preventDefault();}};
  preview.webContents.on('will-navigate',localNavigation);
  preview.webContents.on('will-redirect',localNavigation);
  preview.webContents.on('console-message',(details)=>{if(details.level==='error'||details.level===3)errors.push(details.message);});
  try{
    if(signal?.aborted)throw Error('Paused.');preview.showInactive();await preview.loadURL(url);
    await preview.webContents.executeJavaScript(`Promise.race([document.fonts.ready, new Promise(r=>setTimeout(r,8000))])`);
    await preview.webContents.insertCSS('*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}');
    await preview.webContents.executeJavaScript(`Promise.race([Promise.all(Array.from(document.images).map(i=>i.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,8000))])`);
    const geometry=await preview.webContents.executeJavaScript(`(()=>({title:document.title,viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth,elements:[...document.querySelectorAll('h1,h2,h3,p,button,a,img,input,section,nav')].slice(0,250).map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {tag:el.tagName,text:(el.textContent||'').trim().slice(0,120),x:r.x,y:r.y,width:r.width,height:r.height,font:s.font,color:s.color,transform:s.transform,padding:s.padding,gap:s.gap}})}))()`);
    await fs.mkdir(dir,{recursive:true});const screenshot=path.join(dir,'render.png'),report=path.join(dir,'geometry.json');await new Promise(resolve=>setTimeout(resolve,350));const image=await preview.webContents.capturePage();await fs.writeFile(screenshot,image.resize({width:viewport.width,height:viewport.height}).toPNG());await fs.writeFile(report,JSON.stringify({...geometry,errors},null,2));return {screenshot,report,errors,overflow:geometry.overflow,url,viewport,capturedAt:new Date().toISOString()};
  }catch(e){throw Error(timedOut?'Local preview capture timed out. Ask the builder to start its dev server.':e.message);}finally{clearTimeout(timeout);signal?.removeEventListener('abort',close);close();}
}
let notificationsEnabled = true;
let globalAutonomous = true;

if (process.platform === 'win32') {
  app.setAppUserModelId('local.phibee.desktop');
}

function showDesktopNotification(title, body) {
  try {
    if (!notificationsEnabled) return;
    if (Notification.isSupported()) {
      const iconPath = path.join(__dirname, '../b.png');
      const n = new Notification({
        title: title || 'Phibee',
        body: body || '',
        icon: iconPath,
        silent: false
      });
      n.show();
      return n;
    }
  } catch (err) {
    console.warn('[Phibee] Desktop notification error:', err.message);
  }
}

const fsSync = require('node:fs');
const os = require('node:os');

function claudeSessionExists(cwd, sessionId) {
  if (!sessionId) return false;
  try {
    const slug = cwd.replace(/[:\\/]+/g, '-');
    const p1 = path.join(os.homedir(), '.claude', 'projects', slug, `${sessionId}.jsonl`);
    if (fsSync.existsSync(p1)) return true;
    const p2 = path.join(os.homedir(), '.claude', 'projects', slug.replace(/^-/, ''), `${sessionId}.jsonl`);
    if (fsSync.existsSync(p2)) return true;
    const base = path.join(os.homedir(), '.claude', 'projects');
    if (fsSync.existsSync(base)) {
      for (const d of fsSync.readdirSync(base)) {
        if (fsSync.existsSync(path.join(base, d, `${sessionId}.jsonl`))) return true;
      }
    }
  } catch {}
  return false;
}

function ensureClaudeFolderTrust(targetDir) {
  if (!targetDir) return;
  try {
    const claudePath = path.join(os.homedir(), '.claude.json');
    let content = {};
    if (fsSync.existsSync(claudePath)) {
      try {
        content = JSON.parse(fsSync.readFileSync(claudePath, 'utf8'));
      } catch {
        content = {};
      }
    }
    content.projects = content.projects || {};
    const pathsToTrust = new Set();
    pathsToTrust.add(targetDir);
    pathsToTrust.add(path.resolve(targetDir));
    pathsToTrust.add(path.normalize(targetDir));
    try {
      if (fsSync.existsSync(targetDir)) {
        pathsToTrust.add(fsSync.realpathSync(targetDir));
      }
    } catch {}

    for (const p of pathsToTrust) {
      if (!p) continue;
      content.projects[p] = content.projects[p] || {};
      content.projects[p].hasTrustDialogAccepted = true;
      if (!Array.isArray(content.projects[p].allowedTools)) {
        content.projects[p].allowedTools = [];
      }
    }

    fsSync.writeFileSync(claudePath, JSON.stringify(content, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Phibee] Could not pre-trust folder in .claude.json:', err.message);
  }
}

async function launch(role,provider,cwd,prompt,onData,onExit,options={}){
  const {executable,environment,claudeSandbox,cliLaunch}=await import('../server/providers.js');const pty=require('node-pty');
  const bin=await executable(provider);if(!bin)throw Error(`${provider} CLI was not found. Install it or select another provider. Figma and login stay in that tool.`);
  if(provider==='antigravity'){const {setupProviderBridge}=await import('./provider-setup.js');await setupProviderBridge(path.join(app.getPath('userData'),'local','active.json'));const {prepareWorkspaceAccess}=await import('./workspace-access.js');cwd=await prepareWorkspaceAccess(cwd);}
  const isAuto=options.autonomous!==false&&globalAutonomous!==false;
  const notificationsOn=Boolean(options.notifications||notificationsEnabled);
  const args=provider==='codex'?['--sandbox','workspace-write','--ask-for-approval',isAuto?'never':'on-request']:provider==='claude'?(isAuto?['--dangerously-skip-permissions','--permission-mode','acceptEdits']:['--settings',claudeSandbox]):['--sandbox'];
  if(provider==='claude'){ensureClaudeFolderTrust(cwd);const {managerSystem,builderSystem}=await import('./prompts.js');args.push('--append-system-prompt',role==='manager'?managerSystem(options.run):builderSystem(options.run));}
  const {modelArgs}=await import('./models.js');args.push(...modelArgs(options.model));
  if(provider==='antigravity'){
    args.push('--add-dir',cwd,'--mode','accept-edits');
    if(isAuto)args.push('--dangerously-skip-permissions');
    if(options.session)args.push('--conversation',options.session);
    args.push('--prompt-interactive',prompt);
  }else{
    if(provider==='claude'){
      if(options.session){
        const isUUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.session);
        if(isUUID && claudeSessionExists(cwd, options.session)){
          args.push('--resume',options.session);
        }else if(isUUID){
          args.push('--session-id',options.session);
        }
      }else{
        const crypto=require('node:crypto');
        const newSession=crypto.randomUUID();
        options.session=newSession;
        args.push('--session-id',newSession);
        if(options.run){
          options.run.sessions=options.run.sessions||{};
          options.run.sessions['claude:'+role]=newSession;
          options.run.sessions[role]=newSession;
        }
      }
    }else if(provider==='codex'&&options.session){
      args.push('resume',options.session);
    }
    args.push(prompt);
  }
  const env={...environment(),ALIGN_USAGE_DIR:options.usageDir||'',ALIGN_USAGE_ROLE:role,ALIGN_USAGE_PROVIDER:provider,ALIGN_USAGE_SESSION:options.session||'',TERM:'xterm-256color',COLORTERM:'truecolor'};delete env.ELECTRON_RUN_AS_NODE;
  const cli=await cliLaunch(bin,args);const proc=pty.spawn(cli.bin,cli.args,{cwd,env,name:'xterm-256color',cols:90,rows:34});
  let dead=false;
  let streamBuffer='';
  let autoApproveTimer=null;
  const {extractTerminalTokens}=await import('./usage.js');
  const {detectApprovalPrompt}=await import('./approval.js');
  proc.onData(chunk=>{
    onData(chunk);
    if(dead)return;

    const extracted=extractTerminalTokens(chunk);
    if(extracted&&options.usageDir&&options.session){
      try{
        fs.mkdir(options.usageDir,{recursive:true}).then(()=>{
          const target=path.join(options.usageDir,options.session+'.json');
          const report={role,provider,session:options.session,input:extracted.input,output:extracted.output,updatedAt:Date.now()};
          fs.writeFile(target,JSON.stringify(report)).catch(()=>{});
        }).catch(()=>{});
      }catch{}
    }

    // Auto-detect and handle stale Claude session failure
    if(/no conversation found with session id/i.test(chunk)){
      if(options.run){
        if(options.run.sessions){
          delete options.run.sessions[role];
          delete options.run.sessions['claude:'+role];
        }
        if(options.run.memory?.sessions){
          delete options.run.memory.sessions[role];
          delete options.run.memory.sessions['claude:'+role];
        }
      }
    }

    streamBuffer=(streamBuffer+chunk).slice(-4000);
    const approval=detectApprovalPrompt(streamBuffer,provider);

    if(approval&&approval.detected){
      if(win&&!win.isDestroyed()){
        win.webContents.send('align:approval-prompt',{role,type:approval.type,response:approval.response});
      }
      const roleLabel=role==='builder'?'Builder':(role==='responsive'?'Responsive Maker':'Manager');
      showDesktopNotification('Phibee Approval Required',`${roleLabel} (${provider}) is requesting approval in ${options.run?.project?.name||'project'}.`);
      if(isAuto&&!autoApproveTimer){
        const delay=approval.type?.startsWith('trust')?600:150;
        autoApproveTimer=setTimeout(()=>{
          autoApproveTimer=null;
          if(!dead){
            if(approval.type==='trust-arrow-reorder'){
              proc.write('\x1b[B');
              setTimeout(()=>{
                if(!dead){
                  proc.write('\r');
                  streamBuffer='';
                }
              },250);
            }else{
              proc.write(approval.response);
              streamBuffer='';
            }
          }
        },delay);
      }
    }
  });
  proc.onExit(onExit);
  return {write:data=>{if(!dead)proc.write(data);},resize:(c,r)=>{if(!dead)proc.resize(c,r);},send:async text=>{if(dead)throw Error('Terminal closed.');proc.write('\x1b[200~'+text.replaceAll('\x1b','')+'\x1b[201~');await new Promise(r=>setTimeout(r,100));if(!dead)proc.write('\r');},kill:()=>{dead=true;killTree(proc.pid);try{proc.kill();}catch{}}};
}

function trusted(event){if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('Untrusted IPC sender.');}
function handle(name,fn){ipcMain.handle(name,async(event,...args)=>{trusted(event);return fn(...args);});}
async function createWindow(){
  win=new BrowserWindow({width:1320,height:900,minWidth:860,minHeight:650,title:'Phibee',icon:path.join(__dirname,'../b.png'),backgroundColor:'#0c0d0e',...(process.platform==='darwin'?{titleBarStyle:'hiddenInset',trafficLightPosition:{x:20,y:22}}:{}),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
  await session.defaultSession.clearCache();
  await win.loadFile(path.join(__dirname,'../dist/index.html'));
  win.on('closed',()=>{win=null;});
}
app.whenReady().then(async()=>{
  await session.defaultSession.clearCache();
  await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
  const {PageQueue}=await import('./queue.js');const {PreviewServer}=await import('./preview.js');const previewServer=new PreviewServer();
  engine=new PageQueue({dataDir:path.join(app.getPath('userData'),'local'),projectsDir:path.join(app.getPath('documents'),'Phiby Projects'),launch,capture,startPreview:(root,signal)=>previewServer.start(root,signal),stopPreview:()=>previewServer.stop()});await engine.init();
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));session.fromPartition('align-verification').setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  engine.on('state',data=>{if(win&&!win.isDestroyed())win.webContents.send('align:state',data);});engine.on('terminal',data=>{if(win&&!win.isDestroyed())win.webContents.send('align:terminal',data);});
  engine.on('completed',r=>{showDesktopNotification('Phibee Finished',`${r.project?.name||'Project'}: All ${r.pages?.length||1} pages reviewed.`);});
  engine.on('preview_ready',data=>{showDesktopNotification('Website Preview Ready',`${data.projectName||'Project'}: Live preview online at ${data.url}`);});
  engine.on('handoff_ready',data=>{showDesktopNotification('Design Handoff Complete',`${data.projectName||'Project'}: Manager briefed Builder with design specifications.`);});
  engine.on('responsive_done',data=>{showDesktopNotification('Responsive Maker Complete',`${data.projectName||'Project'}: Mobile and tablet optimizations applied.`);});
  handle('align:view-website',async()=>{
    const r=engine.run;
    const lastBuild=r?.lastBuild||r?.memory?.lastBuild||r?.project?.lastBuild;
    const hasBuiltPages=r?.pages?.some(p=>p.status==='done')||r?.memory?.completedPages?.length>0;
    if(!r||(!lastBuild&&!r.previewUrl&&!r.project?.previewUrl&&!hasBuiltPages))throw Error('The builder has not finished a page yet.');
    const {previewRoute,checkPreview}=await import('./preview.js');
    const base=await previewServer.start(r.project.directory,engine.cancel?.signal.aborted?undefined:engine.cancel?.signal);
    // For historical runs, recover the route but never reuse the old port.
    const route=lastBuild?.previewPath||(r.verification?.url?new URL(r.verification.url).pathname:'/');
    const url=previewRoute(base,route);await checkPreview(url);r.previewUrl=url;
    if(r.lastBuild)r.lastBuild.previewUrl=url;
    if(!r.lastBuild)r.lastBuild={summary:'Website build',previewUrl:url,previewPath:route};
    await engine.persist();
    await engine.syncProjectState();
    await shell.openExternal(url);return {url};
  });
  handle('align:cleanup',async()=>{if(!engine.run||!['completed','stopped'].includes(engine.run.status))throw Error('Finish or stop the run before cleanup.');const {cleanupPlan,performCleanup}=await import('./cleanup.js');const plan=await cleanupPlan(engine.run.project.directory);if(!plan.files.length)return {cleaned:false};const choice=await dialog.showMessageBox(win,{type:'warning',message:'Keep the website and move these temporary files to Trash?',detail:plan.files.join('\n')+'\n\nWebsite source and public assets stay. This removes Phibee logs, references and checkpoints; this run cannot be resumed.',buttons:['Cancel','Clean up'],defaultId:0,cancelId:0});if(choice.response!==1)return {cleaned:false};engine.run.cleaning=true;try{engine.killTerminals();await engine.log?.flush();await engine.refreshUsage();await performCleanup(plan,p=>shell.trashItem(p));engine.run.cleaned=true;engine.run.message='Cleaned up. Website files and assets are ready.';return {cleaned:true};}finally{engine.run.cleaning=false;await engine.persist();}});
  handle('align:logs',async()=>{if(!engine.run)throw Error('No active project.');await engine.ensureLog().flush();shell.showItemInFolder(path.join(engine.run.directory,'logs','events.jsonl'));});
  handle('align:models',async provider=>{if(!['codex','claude','antigravity'].includes(provider))throw Error('Unknown provider.');const {listModels}=await import('./models.js');return listModels(provider);});
  handle('align:set-notifications', enabled => { notificationsEnabled = Boolean(enabled); return { notifications: notificationsEnabled }; });
  handle('align:set-autonomous', enabled => { globalAutonomous = Boolean(enabled); return { autonomous: globalAutonomous }; });
  handle('align:open-session',async p=>{if(p?.directory)ensureClaudeFolderTrust(p.directory);return engine.openSession(p);});
  handle('align:state',()=>engine.state());handle('align:start',async p=>{if(p?.directory)ensureClaudeFolderTrust(p.directory);return engine.start(p);});handle('align:pause',()=>engine.pause());handle('align:resume',()=>engine.resume());handle('align:stop',()=>engine.stop());handle('align:heartbeat',()=>engine.heartbeat());
  handle('align:start-responsive',()=>engine.startResponsive());handle('align:stop-responsive',()=>engine.stopResponsive());
  handle('align:pause-responsive',()=>engine.pauseResponsive());handle('align:resume-responsive',()=>engine.resumeResponsive());
  handle('align:open-editor',async()=>{
    const dir=engine.run?.project?.directory;
    if(!dir)throw Error('No active project folder.');
    const {exec}=require('node:child_process');
    return new Promise(resolve=>{
      exec(`cursor "${dir}"`,err1=>{
        if(!err1)return resolve({app:'cursor'});
        exec(`code "${dir}"`,err2=>{
          if(!err2)return resolve({app:'code'});
          shell.openPath(dir).then(()=>resolve({app:'finder'}));
        });
      });
    });
  });
  handle('align:list-files',async()=>{
    const dir=engine.run?.project?.directory;
    if(!dir)return [];
    const {scanProjectFiles}=await import('./memory.js');
    return scanProjectFiles(dir);
  });
  handle('align:folder',async()=>{const result=await dialog.showOpenDialog(win,{title:'Choose a project folder',properties:['openDirectory','createDirectory']});return result.canceled?null:result.filePaths[0];});
  handle('align:attach',role=>{if(!['manager','builder','responsive'].includes(role))throw Error('Unknown terminal.');return engine.buffers[role];});
  ipcMain.on('align:input',(e,role,data)=>{trusted(e);engine.input(role,data);});ipcMain.on('align:resize',(e,role,c,r)=>{trusted(e);if(['manager','builder','responsive'].includes(role))engine.resize(role,c,r);});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Phibee',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{type:'separator'},{role:'quit'}]},{label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'View',submenu:[{role:'reload'},{role:'toggleDevTools'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]},{label:'Window',submenu:[{role:'minimize'},{role:'zoom'},{role:'front'}]}]));
  await createWindow();app.on('activate',()=>{if(!win)createWindow();});
  if(process.argv.includes('--resume-align')&&['paused','blocked'].includes(engine.run?.status))await engine.resume();
  if(process.env.ALIGN_NATIVE_SMOKE){
    await new Promise(r=>setTimeout(r,500));
    const pty=require('node-pty');const terminalOutput=await new Promise((resolve,reject)=>{const child=pty.spawn(process.platform==='win32'?'cmd.exe':'/bin/sh',process.platform==='win32'?['/d','/c','echo native-pty-ok']:['-c','printf native-pty-ok'],{env:process.env,cols:80,rows:20,cwd:app.getPath('temp')});let output='';child.onData(d=>output+=d);child.onExit(()=>resolve(output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').trim()));setTimeout(()=>reject(Error('Native PTY test timed out')),5000).unref();});
    const report={electron:process.versions.electron,node:process.versions.node,terminalOutput,renderer:await win.webContents.executeJavaScript('({title:document.title,native:!!window.align,heading:document.querySelector("h1")?.textContent,overflow:document.documentElement.scrollWidth>innerWidth})')};
    const http=require('node:http');const fixture=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Capture fixture</title><h1>Local verification</h1><button>Continue</button>');});
    await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
    try{report.capture=await capture(`http://127.0.0.1:${fixture.address().port}`,{width:1024,height:768},process.env.ALIGN_NATIVE_SMOKE+'-capture',new AbortController().signal);}finally{fixture.close();}
    const {PNG}=require('pngjs');const pixels=PNG.sync.read(await fs.readFile(report.capture.screenshot));let dark=0;for(let i=0;i<pixels.data.length;i+=4)if(pixels.data[i]<100&&pixels.data[i+1]<100&&pixels.data[i+2]<100)dark++;
    if(dark<100||report.terminalOutput!=='native-pty-ok'||!report.renderer.native)throw Error('Native smoke verification failed.');report.capture.contentPixels=dark;
    await fs.mkdir(path.dirname(process.env.ALIGN_NATIVE_SMOKE),{recursive:true});await fs.writeFile(process.env.ALIGN_NATIVE_SMOKE,JSON.stringify(report,null,2));await fs.writeFile(process.env.ALIGN_NATIVE_SMOKE+'.png',(await win.webContents.capturePage()).toPNG());app.quit();
  }
}).catch(async e=>{console.error(e);if(!process.env.ALIGN_NATIVE_SMOKE)dialog.showErrorBox('Phibee could not start',e.message);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',e=>{if(quitting)return;e.preventDefault();quitting=true;Promise.resolve(engine?.shutdown()).finally(()=>app.quit());});
