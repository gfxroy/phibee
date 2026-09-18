import platform from './platform.cjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {environment} from '../server/providers.js';

export async function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});}
export function previewRoute(base,route='/'){
 if(typeof route!=='string'||!route.startsWith('/')||route.startsWith('//')||route.includes('\\'))throw Error('Preview route must be a local path.');
 const url=new URL(route,base);if(url.origin!==new URL(base).origin)throw Error('Invalid preview route.');return url.href;
}
export async function checkPreview(url,requireSuccess=true){const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(3000)});if(requireSuccess&&!response.ok)throw Error(`Website returned HTTP ${response.status}.`);await response.body?.cancel();return url;}
export class PreviewServer {
  async start(root,signal){
   try{root=await fs.realpath(root);}catch{root=path.resolve(root);}
   if(this.root===root&&this.url&&(this.child&&!this.child.killed&&this.child.exitCode===null||this.server?.listening)){
    try{return await checkPreview(this.url);}catch{this.stop();}
   }
   this.stop();if(signal?.aborted)throw Error('Preview cancelled.');
   this.root=root;
   let bin,kind;for(const [type,file] of [['vite','node_modules/vite/bin/vite.js'],['next','node_modules/next/dist/bin/next']]){try{await fs.access(path.join(root,file));bin=path.join(root,file);kind=type;break;}catch{}}
   if(!bin){await fs.access(path.join(root,'index.html'));return this.startStatic(root,signal);}
   const env=environment();let node;for(const dir of env.PATH.split(path.delimiter)){const candidate=path.join(dir,process.platform==='win32'?'node.exe':'node');try{await fs.access(candidate);node=candidate;break;}catch{}}
   if(!node){
     const candidates=[process.execPath,'/usr/local/bin/node','/opt/homebrew/bin/node','C:\\Program Files\\nodejs\\node.exe'];
     for(const c of candidates){try{await fs.access(c);node=c;break;}catch{}}
   }
   if(!node)throw Error('Node.js was not found for the website preview.');
   for(let attempt=0;attempt<3;attempt++){
    const port=await freePort();if(signal?.aborted)throw Error('Preview cancelled.');
    try{return await this.launch(node,bin,kind,root,port,env,signal);}catch(e){if(!/EADDRINUSE|already in use/i.test(e.message)||attempt===2)throw e;}
   }
  }
  async launch(node,bin,kind,root,port,env,signal){
   const args=kind==='vite'?[bin,'--host','127.0.0.1','--port',String(port),'--strictPort']:[bin,'dev','--hostname','127.0.0.1','--port',String(port)];
   const child=this.child=spawn(node,args,{cwd:root,env,stdio:['ignore','pipe','pipe'],detached:true,windowsHide:true});
   const stop=()=>this.stop();signal?.addEventListener('abort',stop,{once:true});this.unsubscribe=()=>signal?.removeEventListener('abort',stop);
   const url=`http://127.0.0.1:${port}/`;
   return new Promise((resolve,reject)=>{
    let output='',settled=false,checking=false;const timeout=setTimeout(()=>finish(Error('Website preview timed out: '+output.slice(-1500))),60000);
    const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timeout);if(error){this.stop();reject(error);}else{this.url=url;resolve(url);}};
    const data=chunk=>{
     output=(output+String(chunk).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'')).slice(-8000);
     // Probe only after our child advertises readiness, never an unrelated occupied port.
     if(!checking&&(kind==='vite'?(output.includes(url)||output.includes(':'+port)||/ready in/i.test(output)):/ready in/i.test(output))){checking=true;checkPreview(url,false).then(()=>finish(),e=>finish(e));}
    };
   child.stdout.on('data',data);child.stderr.on('data',data);child.on('error',e=>finish(e));child.on('exit',()=>{if(this.child===child){this.child=null;this.url=null;}finish(Error('Website preview exited: '+output.slice(-1500)));});
  });
 }
 async startStatic(root,signal){
  const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2'};
  const server=this.server=http.createServer(async(req,res)=>{try{
   const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name.split('/').some(s=>s.startsWith('.')))throw Error('Private path');
   let target=path.resolve(root,'.'+name);const stat=await fs.stat(target);if(stat.isDirectory())target=path.join(target,'index.html');target=await fs.realpath(target);
   const rel=path.relative(root,target);if(rel.startsWith('..'+path.sep)||rel==='..'||path.isAbsolute(rel))throw Error('Outside website');
   const ext=path.extname(target).toLowerCase();if(!mime[ext])throw Error('Unsupported website file');res.setHeader('Content-Type',mime[ext]);res.end(await fs.readFile(target));
  }catch{res.writeHead(404);res.end('Not found');}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  this.url=`http://127.0.0.1:${server.address().port}/`;const stop=()=>this.stop();signal?.addEventListener('abort',stop,{once:true});this.unsubscribe=()=>signal?.removeEventListener('abort',stop);return checkPreview(this.url);
 }
 stop(){this.unsubscribe?.();this.unsubscribe=null;if(this.child){platform.killTree(this.child.pid);this.child=null;}if(this.server){this.server.closeAllConnections();this.server.close();this.server=null;}this.url=null;}
}
