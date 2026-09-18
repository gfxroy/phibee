import fs from 'node:fs/promises';
import path from 'node:path';
export function scrub(value){return String(value).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/(Bearer\s+)[^\s"']+/gi,'$1[REDACTED]').replace(/((?:api[_-]?key|access[_-]?token|authorization|password)\s*[=:]\s*)[^\s,}]+/gi,'$1[REDACTED]').replace(/figd_[A-Za-z0-9_-]+/g,'[REDACTED]');}
export class RunLog{
 constructor(directory,onError=()=>{}){this.directory=path.join(directory,'logs');this.pending=Promise.resolve();this.onError=onError;}
 write(file,text){this.pending=this.pending.then(async()=>{await fs.mkdir(this.directory,{recursive:true});const p=path.join(this.directory,file);const st=await fs.stat(p).catch(()=>null);if(st?.size>4*1024*1024)await fs.rename(p,p+'.previous');await fs.appendFile(p,scrub(text),{mode:0o600});}).catch(e=>this.onError(e));return this.pending;}
 event(type,data={}){return this.write('events.jsonl',JSON.stringify({at:new Date().toISOString(),type,...data})+'\n');}
 terminal(role,data){return this.write(role+'.log',data);}
 prompt(role,ticket,prompt){return this.event('prompt',{role,ticket,prompt});}
 flush(){return this.pending;}
}
