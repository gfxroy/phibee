import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PNG} from 'pngjs';
import {PageQueue,localPreview} from '../desktop/queue.js';
import {pageDirectory} from '../desktop/prompts.js';
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'align-flow-'));const project=path.join(root,'project');await fs.mkdir(project);const opened=[],sent=[],captures=[];const q=new PageQueue({dataDir:path.join(root,'state'),projectsDir:root,interval:100000,launch:async(role,provider,cwd,prompt,onData,onExit,options)=>{opened.push({role,prompt,onExit,options});return {send:async prompt=>sent.push({role,prompt}),kill(){},resize(){},write(){}};},capture:async(url,viewport,dir)=>{captures.push(url);return {url,viewport,screenshot:path.join(dir,'render.png'),report:path.join(dir,'geometry.json'),errors:[],overflow:false};}});await q.init();await q.start({name:'Site',directory:project,prompt:'Preserve rotations and checkout',manager:'antigravity',builder:'antigravity',viewport:{width:1440,height:900},pages:[{name:'Home',url:'https://www.figma.com/design/abc/site?node-id=1-1'},{name:'Pricing',url:'https://www.figma.com/design/abc/site?node-id=2-2'}]});const reference=async()=>{await fs.writeFile(path.join(pageDirectory(q.run),'reference.png'),PNG.sync.write(new PNG({width:20,height:20})));};return {q,root,opened,sent,captures,reference,close:async()=>{await q.shutdown();await fs.rm(root,{recursive:true,force:true});}};}
test('manager retrieves design first; builder launches directly with real task, no readiness handshake',async()=>{const f=await fixture();try{assert.deepEqual(f.opened.map(x=>x.role),['manager']);assert.ok(!f.opened[0].prompt.includes('node-id=2-2'));await f.reference();await f.q.handleManager({ticket:f.q.run.ticket,type:'build',prompt:'Build Home with supplied assets'});assert.deepEqual(f.opened.map(x=>x.role),['manager','builder']);const prompt=f.opened[1].prompt;for(const value of ['Build Home','Preserve rotations','node-id=1-1','/assets','/context.md','/reference.png'])assert.ok(prompt.includes(value));assert.equal(f.q.run.status,'builder');}finally{await f.close();}});
test('builder completion automatically captures before the manager reviews, corrections invalidate previous evidence',async()=>{const f=await fixture();try{await f.reference();const q=f.q;await q.handleManager({ticket:q.run.ticket,type:'build',prompt:'Build Home'});await q.handleBuilder({ticket:q.run.ticket,status:'done',summary:'Built',previewUrl:'http://localhost:3000',checks:['Build passed']});assert.equal(f.captures.length,1);assert.equal(f.sent.at(-1).role,'manager');assert.ok(q.run.verification);const old=q.run.verification.id;await q.handleManager({ticket:q.run.ticket,type:'build',prompt:'Fix rotation'});assert.equal(q.run.verification,null);await q.handleBuilder({ticket:q.run.ticket,status:'done',summary:'Fixed',previewUrl:'http://localhost:3000',checks:['Build passed']});await assert.rejects(q.handleManager({ticket:q.run.ticket,type:'page_done',verificationId:old,summary:'done',checks:['visual']}),/fresh/);await q.handleManager({ticket:q.run.ticket,type:'page_done',verificationId:q.run.verification.id,summary:'Home verified',checks:['Visual and interactions']} );assert.equal(q.run.pageIndex,1);assert.match(f.sent.at(-1).prompt,/node-id=2-2/);assert.equal(q.run.reference,null);}finally{await f.close();}});
test('missing reference cannot start builder and missing preview cannot pass review',async()=>{const f=await fixture();try{const q=f.q;await assert.rejects(q.handleManager({ticket:q.run.ticket,type:'build',prompt:'Build'}));assert.equal(f.opened.length,1);await f.reference();await q.handleManager({ticket:q.run.ticket,type:'build',prompt:'Build'});await q.handleBuilder({ticket:q.run.ticket,status:'done',summary:'Done',checks:[]});assert.equal(q.run.status,'blocked');assert.equal(q.run.pageIndex,0);}finally{await f.close();}});
test('stalled manager pauses visibly and late terminal exits cannot break resume',async()=>{const f=await fixture();try{const q=f.q,old=f.opened[0];q.run.stageStartedAt=Date.now()-301000;await q.poll();assert.equal(q.run.status,'paused');assert.match(q.run.message,/5 minutes/);await q.resume();old.onExit();assert.equal(q.run.status,'manager');assert.deepEqual(Object.keys(q.terminals),['manager']);}finally{await f.close();}});
test('preview rejects external and spoofed hosts',()=>{assert.throws(()=>localPreview('https://example.com'));assert.throws(()=>localPreview('http://localhost.evil.com'));assert.equal(localPreview('http://localhost:3000'),'http://localhost:3000/');});
test('resume continues an interrupted builder task without repeating manager design analysis',async()=>{const f=await fixture();try{await f.reference();const q=f.q;await q.handleManager({ticket:q.run.ticket,type:'build',prompt:'Implement Home using saved image assets'});const old=q.run.ticket;await q.pause();await q.resume();assert.equal(q.run.status,'builder');assert.equal(q.run.revision,1);assert.notEqual(q.run.ticket,old);assert.equal(f.opened.at(-1).role,'builder');assert.match(f.opened.at(-1).prompt,/Implement Home using saved image assets/);assert.ok(!f.opened.slice(2).some(x=>x.role==='manager'));}finally{await f.close();}});

test('selected builder model reaches launch and managed preview preserves its page route',async()=>{const f=await fixture();try{await f.reference();f.q.run.project.builderModel='gemini-3.8-flash-high';f.q.startPreview=async()=> 'http://127.0.0.1:49123/';await f.q.handleManager({ticket:f.q.run.ticket,type:'build',prompt:'Build Home'});assert.equal(f.opened.at(-1).options.model,'gemini-3.8-flash-high');await f.q.handleBuilder({ticket:f.q.run.ticket,status:'done',summary:'Built',previewPath:'/login',checks:['Build passed']});assert.equal(f.captures.at(-1),'http://127.0.0.1:49123/login');}finally{await f.close();}});

test('autonomous flag defaults to true and reaches launch options',async()=>{const f=await fixture();try{assert.equal(f.opened[0].options.autonomous,true);await f.reference();await f.q.handleManager({ticket:f.q.run.ticket,type:'build',prompt:'Build Home'});assert.equal(f.opened.at(-1).options.autonomous,true);}finally{await f.close();}});

test('manager correction prompt after completion reliably fires the builder',async()=>{const f=await fixture();try{await f.reference();const q=f.q;
  // 1. Build and complete page 1
  await q.handleManager({ticket:q.run.ticket,type:'build',prompt:'Build Home'});
  await q.handleBuilder({ticket:q.run.ticket,status:'done',summary:'Built Home',previewUrl:'http://localhost:3000',checks:['Build passed']});
  await q.handleManager({ticket:q.run.ticket,type:'page_done',verificationId:q.run.verification.id,summary:'Home done',checks:['Visual ok']});
  // 2. Build and complete page 2 (final page)
  await f.reference();
  await q.handleManager({ticket:q.run.ticket,type:'build',prompt:'Build Pricing'});
  await q.handleBuilder({ticket:q.run.ticket,status:'done',summary:'Built Pricing',previewUrl:'http://localhost:3000',checks:['Build passed']});
  await q.handleManager({ticket:q.run.ticket,type:'page_done',verificationId:q.run.verification.id,summary:'Pricing done',checks:['Visual ok']});
  assert.equal(q.run.status,'completed');

  // 3. User gives a correction prompt to manager after completion
  // Manager writes a new action to manager-action.json
  const sentBefore=f.sent.length;
  await fs.writeFile(path.join(q.run.directory,'manager-action.json'),JSON.stringify({ticket:q.run.ticket,type:'build',prompt:'Change navbar background to dark and make buttons rounded',reference:path.join(pageDirectory(q.run),'reference.png')}));
  
  // 4. Poll detects action, triggers builder, delivers prompt
  await q.poll();
  assert.equal(q.run.status,'builder');
  assert.ok(f.sent.length>sentBefore);
  assert.equal(f.sent.at(-1).role,'builder');
  assert.match(f.sent.at(-1).prompt,/Change navbar background to dark/);
}finally{await f.close();}});

test('responsive agent launches on demand without closing manager/builder, accepts input/resize, and stops cleanly', async () => {
  const f = await fixture();
  try {
    const q = f.q;
    assert.ok(q.terminals.manager);
    const result = await q.startResponsive();
    assert.deepEqual(result, { running: true });
    assert.ok(q.terminals.responsive);
    assert.ok(q.terminals.manager);

    const responsiveLaunch = f.opened.find(x => x.role === 'responsive');
    assert.ok(responsiveLaunch, 'Responsive role should be launched');
    assert.match(responsiveLaunch.prompt, /responsive design specialist/i);

    assert.ok(q.state().terminals.includes('responsive'));
    assert.ok(q.state().terminals.includes('manager'));

    assert.doesNotThrow(() => q.input('responsive', 'ls\r'));
    assert.doesNotThrow(() => q.resize('responsive', 100, 40));

    const secondResult = await q.startResponsive();
    assert.deepEqual(secondResult, { running: true });

    q.stopResponsive();
    assert.equal(q.terminals.responsive, undefined);
    assert.ok(!q.state().terminals.includes('responsive'));
    assert.ok(q.terminals.manager);
  } finally {
    await f.close();
  }
});

