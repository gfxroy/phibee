import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {environment} from '../server/providers.js';
// Reuse an existing provider-owned Figma credential; never ship or request one in Phiby.
export async function setupProviderBridge(stateFile){
 const configFile=path.join(os.homedir(),'.gemini/config/mcp_config.json');let config;try{config=JSON.parse(await fs.readFile(configFile,'utf8'));}catch{return;}
 const entries=Object.values(config.mcpServers||{});const source=entries.find(c=>c.env?.FIGMA_API_KEY||c.env?.FIGMA_OAUTH_TOKEN);if(!source)return;
 let node;for(const dir of environment().PATH.split(path.delimiter)){const p=path.join(dir,process.platform==='win32'?'node.exe':'node');try{await fs.access(p,1);node=p;break;}catch{}}if(!node)return;
 const dest=path.join(os.homedir(),'.phiby','tools');await fs.mkdir(dest,{recursive:true});const helper=path.join(dest,'figma-export.cjs');await fs.copyFile(fileURLToPath(new URL('./mcp/figma-export.cjs',import.meta.url)),helper);
 const credentials=Object.fromEntries(Object.entries(source.env).filter(([k])=>['FIGMA_API_KEY','FIGMA_OAUTH_TOKEN'].includes(k)));
 const next={command:node,args:[helper],env:{...credentials,PHIBY_STATE_FILE:stateFile}};
 if(JSON.stringify(config.mcpServers?.['align-figma-export'])===JSON.stringify(next))return;
 config.mcpServers={...config.mcpServers,'align-figma-export':next};await fs.copyFile(configFile,configFile+'.phiby-backup-'+Date.now());const temp=configFile+'.phiby.tmp';await fs.writeFile(temp,JSON.stringify(config,null,2),{mode:0o600});await fs.rename(temp,configFile);
}
