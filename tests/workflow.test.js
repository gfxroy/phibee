import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {WebSocket} from 'ws';
import {capture} from '../server/capture.js';

// Runs the real HTTP service and screenshot engine against disposable fixtures.
// Coding-provider responses are deliberately simulated; no account or paid model is used.
test('local service: Figma setup, import, two-session correction, checkpoint, PTY and access boundaries',{timeout:90000},async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'align-workflow-'));const project=path.join(tmp,'project'),bin=path.join(tmp,'bin'),data=path.join(tmp,'data');await fs.mkdir(project);await fs.mkdir(bin);
  const page=margin=>`<!doctype html><html><head><title>Fixture</title><style>body{margin:0;background:#fff;color:#111;font-family:Arial}h1{margin:${margin}px;font-size:32px}</style></head><body><h1>Visual fixture</h1></body></html>`;
  await fs.writeFile(path.join(project,'index.html'),page(80));
  const preview=http.createServer(async(req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url==='/expected'?page(20):await fs.readFile(path.join(project,'index.html'),'utf8'));});await new Promise(r=>preview.listen(4328,'127.0.0.1',r));
  const reference=await capture('http://127.0.0.1:4328/expected',{width:800,height:600},path.join(tmp,'reference'));
  const fake=String.raw`#!/usr/bin/env node
const fs=require('fs'),path=require('path'); const args=process.argv.slice(2),root=process.env.ALIGN_FIXTURE;
if(args.includes('--version')){console.log('fixture-cli 1.0');process.exit(0);}
if(args[0]==='plugin'){console.log('{"installed":[]}');process.exit(0);}
if(args[0]==='mcp'){if(args[1]==='list')console.log(fs.existsSync(path.join(root,'installed'))?JSON.stringify([{name:'align-figma',enabled:true,transport:{url:'https://mcp.figma.com/mcp'}}]):'[]');else{fs.writeFileSync(path.join(root,'installed'),'yes');console.log('Configured. OAuth approval required.');}process.exit(0);}
if(!args.includes('exec')){console.log('Fixture terminal ready');process.stdin.on('data',d=>console.log('echo: '+d));return;}
let prompt='';process.stdin.on('data',b=>prompt+=b);process.stdin.on('end',()=>{
fs.appendFileSync(path.join(root,'prompts.jsonl'),JSON.stringify({args,prompt})+'\n');
if(prompt.includes('PAUSE_FIXTURE')){setInterval(()=>{},1000);return;}
const reviewer=args.includes('sandbox_mode="read-only"'),session=reviewer?'review-session':'build-session';let result;
if(prompt.includes('TASK: Import')){const dest=prompt.match(/Save all downloaded files ONLY under (.+?)\. Do not/)[1];fs.mkdirSync(dest,{recursive:true});fs.copyFileSync(process.env.ALIGN_REFERENCE,path.join(dest,'frame.png'));result={summary:'Imported fixture design',reference:path.join(dest,'frame.png'),assets:[],notes:'20px title margin'};}
else if(reviewer){const fixed=fs.existsSync(path.join(root,'fixed'));result={summary:fixed?'Reference matched':'Heading offset needs correction',verdict:fixed?'pass':'fix',issues:fixed?[]:[{id:'heading',region:'Hero heading',severity:'high',evidence:'Heading margin is 80px; target is 20px.',fix:'Use 20px margin.',acceptance:'Heading starts at x=20.'}],correctionPrompt:fixed?'':'Change the heading margin from 80px to 20px. Preserve the heading text.',blockedReason:''};}
else{const file=path.join(process.cwd(),'index.html');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('margin:80px','margin:20px'));fs.writeFileSync(path.join(root,'fixed'),'yes');result='Updated the heading margin. Build checked in fixture.';}
console.log(JSON.stringify({type:'thread.started',thread_id:session}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:typeof result==='string'?result:JSON.stringify(result)}}));
});`;
  await fs.writeFile(path.join(bin,'codex'),fake,{mode:0o755});
  let proc;try{
    proc=spawn(process.execPath,['server/index.js'],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'production',PORT:'4327',ALIGN_DATA_DIR:data,ALIGN_FIXTURE:tmp,ALIGN_REFERENCE:reference.screenshot,PATH:bin+path.delimiter+process.env.PATH},stdio:['ignore','pipe','pipe']});
    let serverLog='';proc.stdout.on('data',b=>serverLog+=b);proc.stderr.on('data',b=>serverLog+=b);
    const base='http://127.0.0.1:4327';let token;
    for(let i=0;i<100;i++){try{token=(await (await fetch(base+'/api/bootstrap')).json()).token;break;}catch{await new Promise(r=>setTimeout(r,80));}}
    assert.ok(token,'Server started: '+serverLog);
    const call=async(url,method='GET',body)=>{const r=await fetch(base+'/api'+url,{method,headers:{'Content-Type':'application/json','x-align-token':token},...(body?{body:JSON.stringify(body)}:{})});const json=await r.json();if(!r.ok)throw Error(json.error);return json;};
    const wait=async id=>{for(let i=0;i<200;i++){const s=await call('/state'),run=s.runs.find(r=>r.id===id);if(!s.active.includes(id))return run;await new Promise(r=>setTimeout(r,100));}throw Error('Workflow timed out');};
    assert.equal((await fetch(base+'/api/state')).status,401);
    assert.equal((await fetch(base+'/api/bootstrap',{headers:{Origin:'https://evil.example'}})).status,403);
    const p=await call('/projects','POST',{name:'Workflow fixture',directory:project,figmaUrl:'https://www.figma.com/design/Test123/Fixture?node-id=1-2',previewUrl:'http://127.0.0.1:4328',brief:'Keep the original heading text.',constraints:'Do not add navigation.',viewport:{width:800,height:600},maxIterations:3});
    await assert.rejects(call('/projects/'+p.id+'/figma/install','POST',{provider:'codex',approved:false}));assert.equal(await fs.stat(path.join(tmp,'installed')).catch(()=>null),null);
    const setup=await call('/projects/'+p.id+'/figma/install','POST',{provider:'codex',approved:true});assert.equal((await wait(setup.id)).status,'approval-required');
    const imported=await call('/projects/'+p.id+'/figma/import','POST',{});const importResult=await wait(imported.id);assert.equal(importResult.status,'completed',importResult.error);
    const run=await call('/projects/'+p.id+'/runs','POST',{});let result=await wait(run.id);assert.equal(result.status,'awaiting-review',result.error);assert.equal(result.iterations[0].review.issues[0].region,'Hero heading');assert.ok(result.iterations[0].diff.changedPercent>0);
    await call('/runs/'+run.id+'/continue','POST',{});result=await wait(run.id);assert.equal(result.status,'completed',result.error);assert.equal(result.iterations.length,2);assert.equal(result.iterations[1].diff.changedPercent,0);assert.notEqual(result.sessions.reviewer,result.sessions.builder);assert.deepEqual(result.checkpoints[0].files,['index.html']);
    const prompts=(await fs.readFile(path.join(tmp,'prompts.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s));assert.equal(prompts.length,4);assert.ok(prompts.every(p=>p.prompt.includes('Keep the original heading text.')));assert.ok(prompts.every(p=>p.prompt.includes('Do not add navigation.')));
    await fs.appendFile(path.join(project,'index.html'),'<!-- newer human edit -->');await assert.rejects(call('/runs/'+run.id+'/restore','POST',{checkpointId:result.checkpoints[0].id}),/newer edits/);
    await fs.writeFile(path.join(project,'index.html'),page(20));await call('/runs/'+run.id+'/restore','POST',{checkpointId:result.checkpoints[0].id});assert.match(await fs.readFile(path.join(project,'index.html'),'utf8'),/margin:80px/);
    await call('/projects/'+p.id,'PUT',{...p,brief:'PAUSE_FIXTURE'});
    const paused=await call('/projects/'+p.id+'/runs','POST',{});
    await assert.rejects(call('/projects/'+p.id,'PUT',{...p,name:'Cannot change an active run'}),/already active/);
    for(let i=0;i<100;i++){const r=(await call('/state')).runs.find(r=>r.id===paused.id);if(r.status==='reviewing')break;await new Promise(r=>setTimeout(r,50));}
    await call('/runs/'+paused.id+'/pause','POST',{});assert.equal((await wait(paused.id)).status,'paused');
    const term=await call('/projects/'+p.id+'/terminals','POST',{provider:'codex',role:'builder'});
    assert.ok((await call('/state')).terminals.some(t=>t.id===term.id),'Terminals can be reattached after refresh');
    const socket=new WebSocket('ws://127.0.0.1:4327/terminal/'+term.id+'?token='+token,{origin:base});
    const terminalOutput=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('PTY timeout')),5000);socket.on('open',()=>socket.send(JSON.stringify({type:'input',data:'hello fixture\r'})));socket.on('message',raw=>{output+=JSON.parse(raw).data||'';if(output.includes('echo: hello fixture')){clearTimeout(timer);resolve(output);}});socket.on('error',reject);});assert.match(terminalOutput,/Fixture terminal ready/);socket.close();await call('/terminals/'+term.id,'DELETE');
  }finally{proc?.kill('SIGTERM');if(proc)await new Promise(resolve=>{proc.once('exit',resolve);setTimeout(resolve,3000).unref();});await new Promise(r=>preview.close(r));await fs.rm(tmp,{recursive:true,force:true});}
});
