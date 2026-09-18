import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {jsonRead,jsonWrite} from './core.js';

export const PROVIDERS={codex:{name:'Codex',commands:['codex']},claude:{name:'Claude Code',commands:['claude']},antigravity:{name:'Antigravity',commands:['agy','antigravity']}};
export const FIGMA='https://mcp.figma.com/mcp';
const extraPaths=[path.join(os.homedir(),'.cargo','bin'),path.join(os.homedir(),'AppData','Roaming','npm'),path.join(os.homedir(),'AppData','Local','Microsoft','WinGet','Links'),'/opt/homebrew/bin','/usr/local/bin',path.join(os.homedir(),'.local/bin'),'/Applications/ChatGPT.app/Contents/Resources','/Applications/Codex.app/Contents/Resources'];
export function environment(){const env={...process.env,PATH:[process.env.PATH,...extraPaths].join(path.delimiter)};delete env.CLAUDECODE;return env;}
export async function executable(id){if(!PROVIDERS[id])throw Error('Unknown provider.');for(const name of PROVIDERS[id].commands.flatMap(n=>process.platform==='win32'?[n+'.exe',n+'.cmd',n]:[n]))for(const dir of environment().PATH.split(path.delimiter)){const file=path.join(dir,name);try{await fs.access(file,1);return file;}catch{}}return null;}
export async function cliLaunch(bin,args){
 if(process.platform!=='win32'||(!bin.endsWith('.cmd')&&!bin.endsWith('.bat')))return {bin,args};
 try {
   const shim=await fs.readFile(bin,'utf8');
   const match=shim.match(/%~?dp0%?[\\/]?([^"\r\n]+\.(?:m?js|cjs))/i);
   if(match){
     return {bin:'node.exe',args:[path.resolve(path.dirname(bin),match[1]),...args]};
   }
 } catch {}
 return {bin:process.env.COMSPEC||'cmd.exe',args:['/c',bin,...args]};
}
export async function command(file,args,{cwd,input,signal,onLine=()=>{},timeout=120000}={}) {
  let execFile=file,execArgs=args;
  if(process.platform==='win32'&&(file.endsWith('.cmd')||file.endsWith('.bat'))){
    const resolved=await cliLaunch(file,args).catch(()=>({bin:process.env.COMSPEC||'cmd.exe',args:['/c',file,...args]}));
    execFile=resolved.bin;
    execArgs=resolved.args;
  }
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(Error('Stopped.'));
    const p=spawn(execFile,execArgs,{cwd,env:environment(),shell:false,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});let output='',errors='',buffer='',settled=false,timedOut=false;
    const kill=()=>{try{if(process.platform==='win32')p.kill('SIGTERM');else process.kill(-p.pid,'SIGTERM');}catch{}setTimeout(()=>{try{if(process.platform==='win32')p.kill('SIGKILL');else process.kill(-p.pid,'SIGKILL');}catch{}},1500).unref();};
    const timer=setTimeout(()=>{timedOut=true;kill();},timeout);signal?.addEventListener('abort',kill,{once:true});
    const done=(err,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',kill);err?reject(err):resolve(result);};
    p.stdout.on('data',b=>{const s=b.toString();output=(output+s).slice(-4_000_000);buffer+=s;let n;while((n=buffer.indexOf('\n'))>=0){onLine(buffer.slice(0,n),'stdout');buffer=buffer.slice(n+1);}});
    p.stderr.on('data',b=>{errors=(errors+b.toString()).slice(-16000);onLine(b.toString(),'stderr');});
    p.on('error',e=>done(e));p.stdin.on('error',()=>{});
    p.on('close',code=>{if(buffer)onLine(buffer,'stdout');if(signal?.aborted)return done(Error('Stopped by user.'));if(timedOut)return done(Error('Provider timed out. Check authentication, permissions, and the session log.'));if(code!==0)return done(Error(`Provider exited (${code}): ${errors.slice(-2500)||output.slice(-2500)}`));done(null,{output,errors,code});});
    p.stdin.end(input||'');
  });
}
function figmaEntries(config){return Object.entries(config?.mcpServers||{}).filter(([name,c])=>!c.disabled&&(/figma/i.test(name)||String(c.url||c.serverUrl||'').includes('mcp.figma.com'))).map(([name,c])=>({name,url:c.serverUrl||c.url||'Local MCP'}));}
export async function providerStatus(id,cwd){
  const bin=await executable(id);if(!bin)return {id,name:PROVIDERS[id].name,installed:false,figma:'unavailable',message:'CLI not found on this computer.'};
  let version='Installed',figma='unknown',servers=[],message='',pluginCheckIncomplete=false;
  try{version=(await command(bin,['--version'],{timeout:10000})).output.trim().split('\n').at(-1);}catch{}
  try{
    if(id==='antigravity'){
      const global=await jsonRead(path.join(os.homedir(),'.gemini/config/mcp_config.json'),{}),local=await jsonRead(path.join(cwd,'.agents/mcp_config.json'),{});
      servers=figmaEntries({mcpServers:{...global.mcpServers,...local.mcpServers}});figma=servers.length?'configured':'missing';
    }else{
      const r=await command(bin,['mcp','list',...(id==='codex'?['--json']:[])],{cwd,timeout:30000});
      if(id==='codex'){
        const items=JSON.parse(r.output);servers=(Array.isArray(items)?items:items.servers||[]).filter(x=>x.enabled!==false&&(/figma/i.test(x.name)||String(x.transport?.url||x.url||'').includes('mcp.figma.com'))).map(x=>({name:x.name,url:x.transport?.url||x.url||'Configured MCP'}));
        if(!servers.length){try{const plugins=await command(bin,['plugin','list','--json'],{cwd,timeout:15000});const catalog=JSON.parse(plugins.output);servers=(catalog.installed||[]).filter(x=>x.enabled!==false&&/figma/i.test(x.name||x.pluginId)).map(x=>({name:x.name||x.pluginId,url:'Provider plugin',plugin:true}));pluginCheckIncomplete=/failed to list|failed to send|error sending/i.test(plugins.errors);}catch(e){pluginCheckIncomplete=!/unrecognized subcommand|unknown command|unexpected argument/i.test(e.message);}}
        figma=servers.length?'configured':pluginCheckIncomplete?'unknown':'missing';
      }
      else{const lines=r.output.split('\n').filter(s=>/figma/i.test(s));servers=lines.map(s=>({name:s.split(':')[0].trim(),url:FIGMA}));figma=lines.length?(/needs authentication|not authenticated/i.test(lines.join(' '))?'approval-required':/failed|error/i.test(lines.join(' '))?'unreachable':'configured'):'missing';}
    }
    message=figma==='missing'?'No enabled Figma connection found. Approve setup to add the official MCP.':figma==='unknown'?'No direct MCP entry found and plugin lookup was incomplete. Try importing a selection, or reconnect and check again.':'Configuration detected. Import a selection to verify live access.';
  }catch(e){message=`Could not check MCP: ${e.message}`;}
  return {id,name:PROVIDERS[id].name,installed:true,version,figma,servers,message};
}
export async function installFigma(id,cwd,onLine,signal){
  const status=await providerStatus(id,cwd);if(!status.installed)throw Error('Install the provider CLI first.');
  if(['configured','approval-required','unreachable'].includes(status.figma))return {message:'Existing Figma configuration preserved. Complete authorization in the provider.',alreadyConfigured:true};
  if(status.figma==='unknown')throw Error('Cannot safely install until the current MCP configuration can be inspected.');
  if(id==='antigravity'){
    const file=path.join(cwd,'.agents/mcp_config.json');const config=await jsonRead(file,{});if(config.mcpServers?.['align-figma'])throw Error('An align-figma entry already exists. Inspect it before replacing.');
    if(await fs.stat(file).catch(()=>null))await fs.copyFile(file,file+'.align-backup-'+Date.now());
    config.mcpServers={...config.mcpServers,'align-figma':{serverUrl:FIGMA}};await jsonWrite(file,config);
    return {message:'Figma added to this project. Open Antigravity /mcp and authorize Figma in its settings.'};
  }
  const args=id==='codex'?['mcp','add','align-figma','--url',FIGMA]:['mcp','add','--transport','http','--scope','user','align-figma',FIGMA];
  await command(await executable(id),args,{cwd,onLine,signal,timeout:180000});
  return {message:'Figma configured. Complete provider OAuth approval before importing.'};
}
export const claudeSandbox=JSON.stringify({sandbox:{enabled:true,failIfUnavailable:true,allowUnsandboxedCommands:false,autoAllowBashIfSandboxed:true}});
export function agentArgs(id,{role,model,session,images=[],artifactDir,schemaPath,schema}){
  if(id==='codex'){
    const args=['exec','--json','--skip-git-repo-check','-c','approval_policy="never"','-c',`sandbox_mode="${role==='reviewer'?'read-only':'workspace-write'}"`];
    if(artifactDir&&!session&&role!=='reviewer')args.push('--add-dir',artifactDir);if(session)args.push('resume',session);if(model)args.push('-m',model);if(schemaPath)args.push('--output-schema',schemaPath);for(const image of images)args.push('-i',image);args.push('-');return args;
  }
  if(id==='claude'){
    const args=['-p','--output-format','stream-json','--verbose','--settings',claudeSandbox,'--permission-mode',role==='reviewer'?'plan':'acceptEdits'];
    if(role==='reviewer')args.push('--disallowedTools','Bash,Edit,Write,NotebookEdit');
    if(artifactDir)args.push('--add-dir',artifactDir);if(model)args.push('--model',model);if(session)args.push('--resume',session);if(schema)args.push('--json-schema',JSON.stringify(schema));return args;
  }
  const args=['--sandbox','--output-format','stream-json','-p'];if(model)args.push('--model',model);if(session)args.push('--conversation',session);if(schema)args.push('--json-schema',JSON.stringify(schema));return args;
}
export function decodeEvent(id,event){
  if(id==='codex')return {session:event.thread_id,text:event.item?.type==='agent_message'?event.item.text:undefined,error:event.type==='turn.failed'?event.error?.message:undefined};
  if(id==='claude')return {session:event.session_id,text:event.type==='result'?(typeof event.structured_output==='object'?JSON.stringify(event.structured_output):event.result):undefined,error:event.type==='result'&&event.is_error?(event.result||event.errors?.join('\n')||'Provider reported an error.'):undefined};
  return {session:event.result?.conversation_id,text:event.event==='result'?event.result?.response:undefined,error:event.result?.status==='ERROR'?(event.result.error||'Provider reported an error.'):undefined};
}
export async function runAgent(id,opts){
  const bin=await executable(id);if(!bin)throw Error(`${PROVIDERS[id].name} CLI is not installed.`);
  let text='',session=opts.session,error;const args=agentArgs(id,opts);
  let input=opts.prompt;
  // Antigravity's -p takes a positional prompt; spawn receives a literal argument, never shell code.
  if(id==='antigravity'){args.splice(args.indexOf('-p')+1,0,input);input='';}
  await command(bin,args,{cwd:opts.cwd,input,signal:opts.signal,timeout:opts.timeout||600000,onLine:(line,stream)=>{
    opts.onLine?.(line,stream);
    try{const value=decodeEvent(id,JSON.parse(line));if(value.session)session=value.session;if(value.text)text=value.text;if(value.error)error=value.error;}catch{}
  }});
  if(error)throw Error(error);if(!text.trim())throw Error('Provider returned no final response. Check the session log and provider permissions.');return {text,session};
}
