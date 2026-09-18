import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareWorkspaceAccess} from '../desktop/workspace-access.js';
import {stageAssets} from '../desktop/assets.js';
test('workspace access stays project scoped, preserves deny and ask rules, and is idempotent',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'align-access-'));try{
 const project=path.join(root,'site');await fs.mkdir(project);const file=path.join(root,'settings.json');
 await fs.writeFile(file,JSON.stringify({unrelated:42,permissions:{deny:['command(sudo)'],ask:['read_url(example.com)']}}));
 const real=await prepareWorkspaceAccess(project,file);const settings=JSON.parse(await fs.readFile(file));
 assert.equal(settings.unrelated,42);assert.deepEqual(settings.permissions.deny,['command(sudo)']);assert.deepEqual(settings.permissions.ask,['read_url(example.com)']);
 assert.ok(settings.permissions.allow.includes(`write_file(${real})`));assert.ok(!settings.permissions.allow.some(x=>x.startsWith('unsandboxed(')||x.includes('(*)')));
 const before=await fs.readFile(file,'utf8');await prepareWorkspaceAccess(project,file);assert.equal(await fs.readFile(file,'utf8'),before);
 await assert.rejects(prepareWorkspaceAccess(os.homedir(),file),/dedicated/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('asset handoff stages original bytes, deduplicates and rejects escaping public symlinks',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'align-assets-'));try{
 const run={project:{directory:root},directory:path.join(root,'.align/run'),pageIndex:0};const source=path.join(run.directory,'page-1/assets');await fs.mkdir(source,{recursive:true});await fs.writeFile(path.join(source,'one.png'),'original');
 const [asset]=await stageAssets(run);assert.equal(await fs.readFile(asset.local,'utf8'),'original');assert.match(asset.url,/^\/assets\/figma\//);assert.deepEqual(await stageAssets(run),[asset]);
 await fs.rm(path.join(root,'public'),{recursive:true});await fs.symlink(os.tmpdir(),path.join(root,'public'));await assert.rejects(stageAssets(run));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
