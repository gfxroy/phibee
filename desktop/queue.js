import fs from 'node:fs/promises';
import path from 'node:path';
import {collectUsage} from './usage.js';
import {previewRoute} from './preview.js';
import {writeInventory} from './inventory.js';
import {stageAssets} from './assets.js';
import {RunLog} from './run-log.js';
import {EventEmitter} from 'node:events';
import {z} from 'zod';
import {parseFigma,jsonRead,jsonWrite,realInside,uid,snapshot,changed} from '../server/core.js';
import {managerPrompt,builderPrompt,pageDirectory} from './prompts.js';
import {loadSessionMemory,updateSessionMemory,detectProviderSession,scanProjectFiles} from './memory.js';

export const nativeProjectSchema=z.object({
  managerModel:z.string().regex(/^$|^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/).nullish().transform(v=>v||''),
  builderModel:z.string().regex(/^$|^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/).nullish().transform(v=>v||''),
  responsiveModel:z.string().regex(/^$|^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/).nullish().transform(v=>v||''),
  responsiveProvider:z.enum(['codex','claude','antigravity']).nullish().transform(v=>v||'claude'),
  instructionMode:z.enum(['single','pages']).default('single'),
  stack:z.enum(['react','next','vue','html','existing']).default('react'),
  name:z.string().trim().min(1).max(100),
  directory:z.string().nullish().transform(v=>v||''),
  prompt:z.string().max(30000).nullish().transform(v=>v||''),
  pages:z.array(z.object({
    name:z.string().trim().min(1).max(100),
    url:z.string().max(2000),
    notes:z.string().max(5000).nullish().transform(v=>v||'')
  })).min(1).max(40),
  viewport:z.object({width:z.number().int().min(320).max(2560),height:z.number().int().min(320).max(1800)}),
  manager:z.enum(['codex','claude','antigravity']),
  builder:z.enum(['codex','claude','antigravity']),
  sessionId:z.string().max(200).nullish().transform(v=>v||''),
  sessions:z.record(z.string()).nullish().transform(v=>v||{}),
  continueSession:z.boolean().nullish().transform(v=>Boolean(v)),
  autonomous:z.boolean().nullish().transform(v=>v!==false),
  lastBuild:z.any().nullish(),
  previewUrl:z.string().nullish().transform(v=>v||''),
  completedPages:z.array(z.any()).nullish().transform(v=>v||[]),
  pageIndex:z.number().nullish().transform(v=>v??0),
  revision:z.number().nullish().transform(v=>v??0),
  usage:z.any().nullish()
}).passthrough();
const managerAction=z.discriminatedUnion('type',[
  z.object({ticket:z.string(),type:z.literal('build'),prompt:z.string().min(1).max(40000),reference:z.string().optional()}),
  z.object({ticket:z.string(),type:z.literal('verify'),previewUrl:z.string(),reference:z.string()}),
  z.object({ticket:z.string(),type:z.literal('page_done'),verificationId:z.string(),summary:z.string().min(1),checks:z.array(z.string().min(1)).min(1)}),
  z.object({ticket:z.string(),type:z.literal('blocked'),reason:z.string().min(1)})
]);
const builderResult=z.object({ticket:z.string(),status:z.enum(['done','blocked']),summary:z.string().min(1),previewUrl:z.string().default(''),previewPath:z.string().default('/'),checks:z.array(z.string()).default([])});
export function localPreview(input){const u=new URL(input);if(!['http:','https:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password)throw Error('The preview must be a localhost website.');return u.href;}

export class PageQueue extends EventEmitter {
  constructor({dataDir,projectsDir,launch,capture,startPreview,stopPreview,interval=600}){
    super();
    this.dataDir=dataDir;
    this.projectsDir=projectsDir;
    this.launch=async(role,provider,cwd,prompt,onData,onExit,customOptions={})=>{
      const roleSessionKey=`${provider}:${role}`;
      let roleSession=this.run?.sessions?.[roleSessionKey]||'';
      if(!roleSession&&this.run?.sessions?.[role]&&!this.run.sessions[role].includes(':')){
        const oldProvider = this.run?.providerHandoff?.[role]?.from;
        const oldSession = oldProvider ? (this.run?.savedSessions?.[role] || this.run?.savedSessions?.[`${oldProvider}:${role}`]) : null;
        if(!oldProvider || !oldSession || this.run.sessions[role] !== oldSession || this.run?.previousProviders?.[role] === provider){
          roleSession=this.run.sessions[role];
        }
      }
      return launch(role,provider,cwd,prompt,onData,onExit,{
        usageDir:path.join(this.run.directory,'usage',role),
        model:this.run.project[role+'Model']||this.run.project.builderModel||'',
        session:roleSession,
        autonomous:this.run.project.autonomous??true,
        run:this.run,
        ...customOptions
      });
    };
    this.capture=capture;this.startPreview=startPreview;this.stopPreview=stopPreview;this.interval=interval;this.terminals={};this.backgroundSessions=new Map();this.run=null;this.polling=false;this.writeChain=Promise.resolve();this.buffers={manager:'',builder:'',responsive:''};this.lastHandledActionKey=null;}
  async init(){await fs.mkdir(this.dataDir,{recursive:true});this.projects=await jsonRead(path.join(this.dataDir,'projects.json'),[]);const saved=await jsonRead(path.join(this.dataDir,'active.json'));if(saved){this.run=saved;if(!['completed','stopped'].includes(saved.status)){saved.resumeStage=saved.resumeStage||saved.status;saved.status='paused';saved.message='Session paused. Terminal memory loaded — click Resume to continue coding.';}await this.loadBuffersFromLogs(this.run);}this.usageTimer=setInterval(()=>this.refreshUsage().catch(()=>{}),1000);this.usageTimer.unref?.();return this.state();}
  async loadBuffersFromLogs(run){
    if(!run||!run.directory)return;
    const logDir=path.join(run.directory,'logs');
    for(const role of ['manager','builder','responsive']){
      let content='';
      try{
        const filePath=path.join(logDir,`${role}.log`);
        const stats=await fs.stat(filePath);
        const readSize=Math.min(stats.size,256*1024);
        const handle=await fs.open(filePath,'r');
        const buffer=Buffer.alloc(readSize);
        await handle.read(buffer,0,readSize,Math.max(0,stats.size-readSize));
        await handle.close();
        content=buffer.toString('utf8');
      }catch{}

      const roleTitle=role==='builder'?'Builder (Implementation)':(role==='responsive'?'Responsive Maker':'Manager (Design & Review)');
      const roleModel=role==='responsive'?(run.project?.responsiveModel||run.project?.builderModel):(role==='builder'?run.project?.builderModel:run.project?.managerModel);
      const provider=role==='responsive'?(run.project?.responsiveProvider||run.project?.builder):(role==='builder'?run.project?.builder:run.project?.manager);
      const completedCount=run.pages?.filter(p=>p.status==='done').length||run.memory?.completedPages?.length||0;
      const totalPages=run.project?.pages?.length||run.pages?.length||1;
      const previewUrl=run.lastBuild?.previewUrl||run.previewUrl||run.memory?.lastBuild?.previewUrl||'';

      const header=[
        `\r\n\x1b[38;2;120;120;120m┌────────────────────────────────────────────────────────────────────────┐\x1b[0m`,
        `\x1b[38;2;120;120;120m│\x1b[0m \x1b[1;37mSESSION MEMORY LOADED\x1b[0m · \x1b[36m#${(run.sessionId||run.id||'').slice(0,8)}\x1b[0m \x1b[38;2;100;100;100m(${provider}${roleModel?':'+roleModel:''})\x1b[0m`,
        `\x1b[38;2;120;120;120m│\x1b[0m Workspace: \x1b[1;32m${run.project?.name||'Project'}\x1b[0m`,
        `\x1b[38;2;120;120;120m│\x1b[0m Location:  \x1b[38;2;160;160;160m${run.project?.directory||''}\x1b[0m`,
        `\x1b[38;2;120;120;120m│\x1b[0m Role:      \x1b[33m${roleTitle}\x1b[0m`,
        `\x1b[38;2;120;120;120m│\x1b[0m Status:    \x1b[35mPaused at Page ${(run.pageIndex||0)+1} of ${totalPages}\x1b[0m (${completedCount} completed)`,
        run.lastBuild?.summary?`\x1b[38;2;120;120;120m│\x1b[0m Last Build: \x1b[32m${run.lastBuild.summary.slice(0,60)}\x1b[0m`:null,
        previewUrl?`\x1b[38;2;120;120;120m│\x1b[0m Preview:   \x1b[34m${previewUrl}\x1b[0m`:null,
        `\x1b[38;2;120;120;120m│\x1b[0m \x1b[1;33mSession paused at this exact state. Click "Resume" to start agents.\x1b[0m`,
        `\x1b[38;2;120;120;120m└────────────────────────────────────────────────────────────────────────┘\x1b[0m\r\n`
      ].filter(Boolean).join('\r\n');

      if(content.trim()){
        this.buffers[role]=(content+'\r\n'+header).slice(-500000);
      }else{
        this.buffers[role]=header;
      }
    }
  }
  async syncProjectState(){
    if(!this.run||!this.run.project)return;
    const projId=this.run.project.id;
    const p=this.projects?.find(x=>x.id===projId);
    if(p){
      p.sessionId=this.run.sessionId||this.run.id;
      p.sessions={...(p.sessions||{}),...(this.run.sessions||{})};
      p.pageIndex=this.run.pageIndex;
      p.revision=this.run.revision;
      if(this.run.lastBuild)p.lastBuild=this.run.lastBuild;
      if(this.run.previewUrl)p.previewUrl=this.run.previewUrl;
      if(this.run.usage)p.usage=this.run.usage;
      if(this.run.memory?.completedPages)p.completedPages=this.run.memory.completedPages;
      p.updatedAt=new Date().toISOString();
      await jsonWrite(path.join(this.dataDir,'projects.json'),this.projects);
    }
  }
  async refreshUsage(){
    if(!this.run||this.run.cleaned)return;
    const next=await collectUsage(this.run.directory,this.run.usage,{
      run:this.run,
      sessions:this.run.sessions,
      project:this.run.project
    });
    let sessionUpdated=false;
    for(const s of Object.values(next.sessions||{})){
      if(s.session&&s.role&&this.run){
        this.run.sessions=this.run.sessions||{};
        if(this.run.sessions[s.role]!==s.session){
          this.run.sessions[s.role]=s.session;
          sessionUpdated=true;
        }
      }
    }
    if(sessionUpdated&&this.run.project){
      this.run.project.sessions={...this.run.project.sessions,...this.run.sessions};
      this.run.project.sessionId=this.run.sessions.builder||this.run.sessions.manager||this.run.id;
      await this.syncProjectState();
    }
    if(JSON.stringify(next)!==JSON.stringify(this.run.usage)){this.run.usage=next;await this.persist();await this.syncProjectState();}
  }
  ensureLog(){if(this.run&&this.logRun!==this.run.id){this.logRun=this.run.id;this.log=new RunLog(this.run.directory,e=>{this.run.logError=e.message;this.emit('state',this.state());});}return this.log;}
  event(type,data={}){return this.ensureLog()?.event(type,{pageIndex:this.run?.pageIndex,status:this.run?.status,ticket:this.run?.ticket,...data});}
  state(){
    const activeRuns={};
    const isResponsiveRunning=Boolean(this.terminals.responsive);
    const isGuideGenerating=Boolean(this.run?.guideGenerating);
    const isMainRunning=this.run&&['manager','builder','starting','verifying','preparing'].includes(this.run.status);
    if(this.run&&(isMainRunning||isResponsiveRunning||isGuideGenerating)){
      const rId=this.run.sessionId||this.run.id;
      const displayStatus=isGuideGenerating?'guide':(isResponsiveRunning?'responsive':this.run.status);
      const displayMsg=isGuideGenerating
        ?'Manager is analyzing website structure and preparing responsive design guide…'
        :(isResponsiveRunning?'Responsive agent is optimizing layout…':this.run.message);
      activeRuns[rId]={
        id:this.run.id,
        sessionId:rId,
        projectId:this.run.project?.id,
        name:this.run.project?.name,
        status:displayStatus,
        pageIndex:this.run.pageIndex,
        message:displayMsg
      };
    }
    if(this.backgroundSessions){
      for(const [id,bg] of this.backgroundSessions.entries()){
        const bgResp=Boolean(bg.terminals?.responsive);
        const bgGuide=Boolean(bg.run?.guideGenerating);
        const bgMain=bg.run&&['manager','builder','starting','verifying','preparing'].includes(bg.run.status);
        if(bg.run&&(bgMain||bgResp||bgGuide)){
          const rId=bg.run.sessionId||bg.run.id||id;
          const status=bgGuide?'guide':(bgResp?'responsive':bg.run.status);
          const message=bgGuide
            ?'Manager is analyzing website structure and preparing responsive design guide…'
            :(bgResp?'Responsive agent is optimizing layout…':bg.run.message);
          activeRuns[rId]={
            id:bg.run.id,
            sessionId:rId,
            projectId:bg.run.project?.id,
            name:bg.run.project?.name,
            status,
            pageIndex:bg.run.pageIndex,
            message
          };
        }
      }
    }
    return {
      projects:this.projects||[],
      run:this.run?structuredClone(this.run):null,
      terminals:Object.keys(this.terminals),
      activeRuns,
      responsiveRunning:isResponsiveRunning,
      responsivePaused:Boolean(this.run?.responsivePaused),
      guideGenerating:isGuideGenerating
    };
  }
  async persist(){const value=structuredClone(this.run);this.writeChain=this.writeChain.catch(()=>{}).then(()=>jsonWrite(path.join(this.dataDir,'active.json'),value));await this.writeChain;if(this.run)this.emit('state',this.state());}
  async control(){if(this.run&&this.lastLoggedTicket!==this.run.ticket){this.lastLoggedTicket=this.run.ticket;this.event('transition',{message:this.run.message});}if(this.run&&`${this.run.status}:${this.run.pageIndex}`!==this.lastStage){this.lastStage=`${this.run.status}:${this.run.pageIndex}`;this.run.stageStartedAt=Date.now();}if(this.run)await jsonWrite(path.join(this.run.directory,'control.json'),{runId:this.run.id,status:this.run.status,pageIndex:this.run.pageIndex,page:this.run.project.pages[this.run.pageIndex],ticket:this.run.ticket,revision:this.run.revision,verification:this.run.verification,brief:this.run.project.prompt});await this.persist();}
  async saveProject(input){
    const p=nativeProjectSchema.parse(input);
    for(const page of p.pages)parseFigma(page.url);
    if(!p.directory){
      const slug=p.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'project';
      p.directory=path.join(this.projectsDir,slug+'-'+uid().slice(0,6));
      await fs.mkdir(p.directory,{recursive:true});
    }
    p.directory=await fs.realpath(p.directory);
    if(!(await fs.stat(p.directory)).isDirectory())throw Error('Select a project folder.');
    const existingIndex=(input.id||input.sessionId)?this.projects.findIndex(x=>(input.id&&x.id===input.id)||(input.sessionId&&(x.sessionId===input.sessionId||x.id===input.sessionId))):-1;
    let entry;
    if(existingIndex>=0){
      entry={
        ...this.projects[existingIndex],
        ...p,
        id:this.projects[existingIndex].id||input.id,
        sessionId:input.sessionId||this.projects[existingIndex].sessionId||null,
        manager:p.manager,
        builder:p.builder,
        managerModel:p.managerModel,
        builderModel:p.builderModel,
        lastBuild:input.lastBuild||this.projects[existingIndex].lastBuild||null,
        previewUrl:input.previewUrl||this.projects[existingIndex].previewUrl||null,
        completedPages:input.completedPages||this.projects[existingIndex].completedPages||[],
        usage:input.usage||this.projects[existingIndex].usage||null,
        updatedAt:new Date().toISOString()
      };
      this.projects[existingIndex]=entry;
    }else{
      entry={
        ...p,
        id:input.id||uid(),
        sessionId:input.sessionId||null,
        lastBuild:input.lastBuild||null,
        previewUrl:input.previewUrl||null,
        completedPages:input.completedPages||[],
        usage:input.usage||null,
        createdAt:new Date().toISOString()
      };
      this.projects.unshift(entry);
    }
    await jsonWrite(path.join(this.dataDir,'projects.json'),this.projects);
    return entry;
  }
  async openSession(input){
    let project=null;
    if(input.id){
      project=this.projects?.find(x=>x.id===input.id);
    }
    if(!project&&input.sessionId){
      project=this.projects?.find(x=>x.sessionId===input.sessionId||x.id===input.sessionId);
    }
    if(!project&&input.directory){
      project=this.projects?.find(x=>x.directory===input.directory);
    }
    if(!project){
      project=await this.saveProject(input);
    }else if(input.manager||input.builder||input.managerModel!==undefined||input.builderModel!==undefined){
      if(input.manager)project.manager=input.manager;
      if(input.builder)project.builder=input.builder;
      if(input.managerModel!==undefined)project.managerModel=input.managerModel;
      if(input.builderModel!==undefined)project.builderModel=input.builderModel;
      if(input.prompt)project.prompt=input.prompt;
      project.updatedAt=new Date().toISOString();
      await jsonWrite(path.join(this.dataDir,'projects.json'),this.projects);
    }

    if(!project.directory)throw Error('Please choose a folder for this project.');
    const sessionId=input.sessionId||project.sessionId||input.sessions?.builder||input.sessions?.manager||project.id||uid();
    let directory=path.join(project.directory,'.align','runs',sessionId);
    await fs.mkdir(directory,{recursive:true});
    await realInside(project.directory,directory);

    if(this.run&&(this.run.id===sessionId||this.run.sessionId===sessionId||(this.run.project?.id&&this.run.project.id===project.id))){
      this.run.runningProviders=this.run.runningProviders||{manager:this.run.project?.manager,builder:this.run.project?.builder};
      this.run.runningModels=this.run.runningModels||{manager:this.run.project?.managerModel||'',builder:this.run.project?.builderModel||''};
      if(input.manager)this.run.project.manager=input.manager;
      if(input.builder)this.run.project.builder=input.builder;
      if(input.managerModel!==undefined)this.run.project.managerModel=input.managerModel;
      if(input.builderModel!==undefined)this.run.project.builderModel=input.builderModel;
      await this.persist();
      return this.state();
    }

    if(this.backgroundSessions?.has(sessionId)){
      const isCurrentActive = this.run && (['manager','builder','starting','verifying','preparing'].includes(this.run.status) || Boolean(this.terminals?.responsive) || this.run.guideGenerating || this.run.responsivePaused);
      if(isCurrentActive){
        this.backgroundSessions.set(this.run.sessionId||this.run.id,{run:this.run,terminals:this.terminals,buffers:this.buffers,timer:this.timer,deadline:this.deadline,cancel:this.cancel,terminalEpoch:this.terminalEpoch});
      }else if(this.run){
        this.killTerminals();
      }
      const bg=this.backgroundSessions.get(sessionId);
      this.backgroundSessions.delete(sessionId);
      this.run=bg.run;
      this.terminals=bg.terminals;
      this.buffers=bg.buffers;
      this.timer=bg.timer;
      this.deadline=bg.deadline;
      this.cancel=bg.cancel;
      this.terminalEpoch=bg.terminalEpoch;
      await this.persist();
      for(const [role,buf] of Object.entries(this.buffers||{})){
        if(buf)this.emit('terminal',{role,data:buf});
      }
      return this.state();
    }

    const isCurrentActive = this.run && (['manager','builder','starting','verifying','preparing'].includes(this.run.status) || Boolean(this.terminals.responsive) || this.run.guideGenerating || this.run.responsivePaused);
    if(isCurrentActive){
      this.backgroundSessions=this.backgroundSessions||new Map();
      this.backgroundSessions.set(this.run.sessionId||this.run.id,{run:this.run,terminals:this.terminals,buffers:this.buffers,timer:this.timer,deadline:this.deadline,cancel:this.cancel,terminalEpoch:this.terminalEpoch});
      this.run=null;
      this.terminals={};
      this.buffers={manager:'',builder:'',responsive:''};
      this.timer=null;
      this.deadline=null;
      this.cancel=null;
    }else if(this.run&&Object.keys(this.terminals).length){
      await this.pause('Switched session to #'+sessionId.slice(0,8));
    }

    let savedMemory=await loadSessionMemory(directory);
    if(!savedMemory){
      try{
        const runsBase=path.join(project.directory,'.align','runs');
        const entries=await fs.readdir(runsBase,{withFileTypes:true});
        let bestDir=null,bestMtime=0;
        for(const ent of entries){
          if(ent.isDirectory()){
            const cand=path.join(runsBase,ent.name);
            try{
              const st=await fs.stat(path.join(cand,'memory.json')).catch(()=>fs.stat(cand));
              if(st.mtimeMs>bestMtime){
                bestMtime=st.mtimeMs;
                bestDir=cand;
              }
            }catch{}
          }
        }
        if(bestDir){
          const candMemory=await loadSessionMemory(bestDir);
          if(candMemory){
            directory=bestDir;
            savedMemory=candMemory;
          }
        }
      }catch{}
    }

    const savedControl=await jsonRead(path.join(directory,'control.json'),null);

    const restoredPageIndex=Math.min(
      Math.max(0,savedMemory?.pageIndex??savedControl?.pageIndex??project.pageIndex??0),
      Math.max(0,project.pages.length-1)
    );
    const restoredRevision=savedMemory?.revision??savedControl?.revision??project.revision??0;
    const completedList=savedMemory?.completedPages||project.completedPages||[];

    const pages=project.pages.map((p,idx)=>{
      const done=completedList.find(cp=>cp.index===idx);
      if(done){
        return {name:p.name,status:'done',iterations:1,summary:done.summary,checks:done.checks||[]};
      }
      if(idx===restoredPageIndex){
        return {name:p.name,status:'active',iterations:restoredRevision};
      }
      return {name:p.name,status:'queued',iterations:0};
    });

    const sessions={
      ...(savedMemory?.sessions||{}),
      ...(project.sessions||{}),
      ...(input.sessions||{})
    };

    let projectFiles=[];
    try{
      projectFiles=await scanProjectFiles(project.directory);
    }catch{}
    if(savedMemory){
      savedMemory.projectFiles=projectFiles;
    }

    let lastBuild=savedMemory?.lastBuild||project.lastBuild||null;
    let previewUrl=savedMemory?.lastBuild?.previewUrl||project.previewUrl||(lastBuild?lastBuild.previewUrl:null)||null;
    if(!lastBuild&&(projectFiles.includes('index.html')||projectFiles.includes('package.json')||project.pages.some(p=>p.status==='done'))){
      lastBuild={summary:'Existing project codebase',previewPath:'/',checks:['Project initialized']};
    }
    if(lastBuild&&!lastBuild.previewUrl&&previewUrl){
      lastBuild.previewUrl=previewUrl;
    }
    const pageDir=path.join(directory,`page-${restoredPageIndex+1}`);
    const existingHandoff=await jsonRead(path.join(pageDir,'handoff.json'),null);
    const existingBuilderResult=await jsonRead(path.join(directory,'builder-result.json'),null);
    const wasResponsive=Boolean(
      savedMemory?.lastActiveRole==='responsive'||
      savedMemory?.resumeStage==='responsive'||
      savedMemory?.responsivePaused||
      savedControl?.lastActiveRole==='responsive'
    );
    const isBuilderPending=!wasResponsive&&Boolean(
      existingHandoff&&(
        !existingBuilderResult||
        existingBuilderResult.ticket!==(savedControl?.ticket||'')||
        savedMemory?.resumeStage==='builder'||
        savedMemory?.lastActiveRole==='builder'||
        savedControl?.status==='builder'
      )
    );
    const lastActiveRole=wasResponsive?'responsive':(isBuilderPending?'builder':(savedMemory?.lastActiveRole||(savedMemory?.resumeStage==='builder'?'builder':'manager')));
    const resumeStage=wasResponsive?'responsive':(isBuilderPending?'builder':(savedMemory?.resumeStage||savedControl?.status||(lastActiveRole==='builder'?'builder':'manager')));

    this.run={
      id:sessionId,
      project,
      directory,
      continueSession:true,
      sessionId,
      sessions,
      status:'paused',
      resumeStage,
      lastActiveRole,
      responsivePaused:Boolean(wasResponsive||savedMemory?.responsivePaused),
      guideGenerated:Boolean(savedMemory?.guideGenerated||false),
      pageIndex:restoredPageIndex,
      revision:restoredRevision,
      ticket:savedControl?.ticket||uid(),
      readyToken:uid(),
      pages,
      checkpoints:[],
      createdAt:savedMemory?.createdAt||project.createdAt||new Date().toISOString(),
      message:`Session #${sessionId.slice(0,8)} memory loaded. Click Resume to continue coding.`,
      verification:savedMemory?.lastReview||savedControl?.verification||null,
      lastBuild,
      previewUrl,
      usage:savedMemory?.usage||project.usage||{manager:{input:0,output:0},builder:{input:0,output:0}},
      memory:savedMemory
    };

    await this.loadBuffersFromLogs(this.run);
    await this.control();
    await this.syncProjectState();
    return this.state();
  }
  heartbeat(){
    this.lastHeartbeatAt=Date.now();
    return {ok:true,lastHeartbeatAt:this.lastHeartbeatAt,status:this.run?.status};
  }
  async start(input){
    const requestedContinuing=Boolean(input.continueSession&&(input.sessionId||input.id));
    const targetSessionId=requestedContinuing?(input.sessionId||input.id):null;
    const isCurrentActive = this.run && (['manager','builder','verifying','preparing','starting'].includes(this.run.status) || Boolean(this.terminals?.responsive) || this.run.guideGenerating || this.run.responsivePaused);
    if(isCurrentActive){
      if(targetSessionId && (this.run.id===targetSessionId||this.run.sessionId===targetSessionId||this.run.project?.sessionId===targetSessionId)){
        return this.state();
      }
      this.backgroundSessions=this.backgroundSessions||new Map();
      this.backgroundSessions.set(this.run.sessionId||this.run.id,{
        run:this.run,
        terminals:this.terminals,
        buffers:this.buffers,
        timer:this.timer,
        deadline:this.deadline,
        cancel:this.cancel,
        terminalEpoch:this.terminalEpoch
      });
      this.run=null;
      this.terminals={};
      this.buffers={manager:'',builder:'',responsive:''};
      this.timer=null;
      this.deadline=null;
      this.cancel=null;
    }else if(this.run&&Object.keys(this.terminals).length){
      this.killTerminals();
    }
    const project=await this.saveProject(input);
    if(!project.directory)throw Error('Please choose a folder for your project before starting.');
    const isContinuing=Boolean(input.continueSession&&(input.sessionId||project.sessionId));
    let id=isContinuing?(input.sessionId||project.sessionId):(input.sessionId||input.id||uid());
    let directory=path.join(project.directory,'.align','runs',id);

    let savedMemory=null,savedControl=null;
    if(isContinuing){
      savedMemory=await loadSessionMemory(directory);
      if(!savedMemory){
        try{
          const runsBase=path.join(project.directory,'.align','runs');
          const entries=await fs.readdir(runsBase,{withFileTypes:true});
          let bestDir=null,bestMtime=0;
          for(const ent of entries){
            if(ent.isDirectory()){
              const cand=path.join(runsBase,ent.name);
              try{
                const st=await fs.stat(path.join(cand,'memory.json')).catch(()=>fs.stat(cand));
                if(st.mtimeMs>bestMtime){
                  bestMtime=st.mtimeMs;
                  bestDir=cand;
                }
              }catch{}
            }
          }
          if(bestDir){
            const candMemory=await loadSessionMemory(bestDir);
            if(candMemory){
              if(!input.sessionId){
                directory=bestDir;
                id=path.basename(bestDir);
              }
              savedMemory=candMemory;
            }
          }
        }catch{}
      }
      savedControl=await jsonRead(path.join(directory,'control.json'),null);
    }
    await fs.mkdir(directory,{recursive:true});
    await realInside(project.directory,directory);
    const restoredPageIndex=Math.min(Math.max(0,savedMemory?.pageIndex??savedControl?.pageIndex??0),Math.max(0,project.pages.length-1));
    const restoredRevision=savedMemory?.revision??savedControl?.revision??0;
    const completedList=savedMemory?.completedPages||[];

    const pages=project.pages.map((p,idx)=>{
      const done=completedList.find(cp=>cp.index===idx);
      if(done){
        return {name:p.name,status:'done',iterations:1,summary:done.summary,checks:done.checks||[]};
      }
      if(idx===restoredPageIndex&&isContinuing){
        return {name:p.name,status:'active',iterations:restoredRevision};
      }
      return {name:p.name,status:'queued',iterations:0};
    });

    const sessions={...(savedMemory?.sessions||{}),...(project.sessions||{}),...(input.sessions||{})};
    const lastBuild=savedMemory?.lastBuild||project.lastBuild||null;
    const previewUrl=savedMemory?.lastBuild?.previewUrl||project.previewUrl||(lastBuild?lastBuild.previewUrl:null)||null;
    if(lastBuild&&!lastBuild.previewUrl&&previewUrl)lastBuild.previewUrl=previewUrl;

    const previousProviders = this.run?.runningProviders || savedMemory?.providers || (this.run?.project ? { manager: this.run.project.manager, builder: this.run.project.builder } : null);
    const providerHandoff = {
      manager: previousProviders?.manager && previousProviders.manager !== project.manager ? { from: previousProviders.manager, to: project.manager } : null,
      builder: previousProviders?.builder && previousProviders.builder !== project.builder ? { from: previousProviders.builder, to: project.builder } : null
    };

    const previousModels = this.run?.runningModels || savedMemory?.models || (this.run?.project ? { manager: this.run.project.managerModel || '', builder: this.run.project.builderModel || '' } : null);
    const modelHandoff = {
      manager: previousModels?.manager && previousModels.manager !== (project.managerModel || '') ? { from: previousModels.manager, to: project.managerModel || 'default' } : null,
      builder: previousModels?.builder && previousModels.builder !== (project.builderModel || '') ? { from: previousModels.builder, to: project.builderModel || 'default' } : null
    };

    const pageDir=path.join(directory,`page-${restoredPageIndex+1}`);
    const existingHandoff=isContinuing?await jsonRead(path.join(pageDir,'handoff.json'),null):null;
    const existingBuilderResult=isContinuing?await jsonRead(path.join(directory,'builder-result.json'),null):null;
    const wasResponsive=isContinuing&&Boolean(
      savedMemory?.lastActiveRole==='responsive'||
      savedMemory?.resumeStage==='responsive'||
      savedMemory?.responsivePaused||
      savedControl?.lastActiveRole==='responsive'
    );
    const isBuilderPending=!wasResponsive&&Boolean(
      existingHandoff&&(
        !existingBuilderResult||
        existingBuilderResult.ticket!==(savedControl?.ticket||'')||
        savedMemory?.resumeStage==='builder'||
        savedMemory?.lastActiveRole==='builder'||
        savedControl?.status==='builder'
      )
    );
    const lastActiveRole=wasResponsive?'responsive':(isBuilderPending?'builder':(savedMemory?.lastActiveRole||(savedMemory?.resumeStage==='builder'?'builder':'manager')));
    const resumeStage=wasResponsive?'responsive':(isBuilderPending?'builder':(savedMemory?.resumeStage||(lastActiveRole==='builder'?'builder':'manager')));

    this.run={
      id,project,directory,continueSession:isContinuing,sessionId:id,sessions,
      status:'starting',pageIndex:restoredPageIndex,revision:restoredRevision,
      guideGenerated:Boolean(savedMemory?.guideGenerated||false),
      ticket:uid(),readyToken:uid(),pages,checkpoints:[],
      createdAt:savedMemory?.createdAt||new Date().toISOString(),
      message:isContinuing?`Continuing session #${id.slice(0,8)}…`:'Opening your two coding tools…',
      verification:savedMemory?.lastReview||savedControl?.verification||null,
      lastBuild,
      previewUrl,
      memory:savedMemory,
      responsivePaused:Boolean(wasResponsive||savedMemory?.responsivePaused),
      savedSessions:savedMemory?.sessions||null,
      previousProviders:previousProviders||{manager:project.manager,builder:project.builder},
      previousModels:previousModels||{manager:project.managerModel||'',builder:project.builderModel||''},
      runningProviders:{manager:project.manager,builder:project.builder},
      runningModels:{manager:project.managerModel||'',builder:project.builderModel||''},
      providerHandoff,
      modelHandoff,
      lastActiveRole,
      resumeStage
    };
    this.run.memory=await updateSessionMemory(this.run,isContinuing?'session_continued':'session_started',{lastActiveRole,resumeStage});
    if(isContinuing){
      await this.loadBuffersFromLogs(this.run);
    }else{
      this.buffers={manager:'',builder:''};
    }
    await this.control();
    await this.openTerminals();
    await this.syncProjectState();
    return this.state();
  }
  async openTerminals(){
    const run=this.run;const epoch=this.terminalEpoch=(this.terminalEpoch||0)+1;this.cancel=new AbortController();run.readyToken=uid();run.ticket=uid();run.pages[run.pageIndex].status='active';run.status='manager';run.message='Manager is inspecting the current page.';
    run.runningProviders={manager:run.project.manager,builder:run.project.builder};
    run.runningModels={manager:run.project.managerModel||'',builder:run.project.builderModel||''};
    await this.control();
    await fs.mkdir(path.join(pageDirectory(run),'assets'),{recursive:true});
    if((run.lastBuild||run.previewUrl||run.memory?.lastBuild)&&this.startPreview){
      try{
        const base=await this.startPreview(run.project.directory,this.cancel.signal);
        const route=run.lastBuild?.previewPath||run.memory?.lastBuild?.previewPath||'/';
        const previewUrl=previewRoute(base,route);
        run.previewUrl=previewUrl;
        if(run.lastBuild)run.lastBuild.previewUrl=previewUrl;
        await this.persist();
        await this.syncProjectState();
        this.event('preview_started',{url:previewUrl});
      }catch(e){
        console.warn('Auto-start preview on resume:',e.message);
      }
    }
    const pageDir=pageDirectory(run);
    const existingHandoff=await jsonRead(path.join(pageDir,'handoff.json'),null);
    const existingBuilderResult=await jsonRead(path.join(run.directory,'builder-result.json'),null);
    const isBuilderPending=Boolean(
      existingHandoff&&(
        !existingBuilderResult||
        existingBuilderResult.ticket!==run.ticket||
        run.resumeStage==='builder'||
        run.lastActiveRole==='builder'
      )
    );
    const pendingBuild=isBuilderPending?existingHandoff:null;
    if(pendingBuild){await stageAssets(run);await writeInventory(run);}
    run.resumeStage=null;
    if(pendingBuild){
      run.status='builder';
      run.lastActiveRole='builder';
      run.reference=pendingBuild.reference;
      run.message=`Builder (${run.project.builder}) is continuing its saved task.`;
      this.output('manager','\r\n[Align] Scoped resumption: Manager is awaiting builder completion of current task...\r\n');
      this.output('builder',`Builder is resuming task from handoff.json using ${run.project.builder}...\r\n`);
      await this.control();
      const prompt=builderPrompt(run,'Continue from existing project files; do not restart completed work.\n'+pendingBuild.prompt);
      await this.ensureLog().prompt('builder',run.ticket,prompt);
      this.event('launch',{role:'builder',provider:run.project.builder,resumed:true});
      try{
        this.terminals.builder=await this.launch('builder',run.project.builder,run.project.directory,prompt,d=>this.output('builder',d,run),()=>{if(this.terminalEpoch===epoch)this.terminalExited('builder');});
      }catch(e){
        this.killTerminals();
        await this.block(e.message);
        throw e;
      }
    }else{
      const managerContinuationPrompt=(run.lastBuild||run.memory?.lastBuild)?`BUILD UPON EXISTING WEBSITE: The website is already built (live preview: ${run.lastBuild?.previewUrl||run.memory?.lastBuild?.previewUrl||run.previewUrl||'localhost'}). Do NOT recreate or overwrite existing components (rotator, layout, styles). Inspect current files and design; verify or make focused enhancements on top of the working codebase.`:run.revision?'Resume this page. Reuse already downloaded context/assets. If the builder result has a preview URL, verify the existing implementation; otherwise send a focused builder task.':'Use Figma MCP, save context.md, reference.png and original assets in the shared page folder, then send the structured builder prompt immediately.';
      try{
        this.ensureLog().prompt('manager',run.ticket,managerPrompt(run,managerContinuationPrompt));
        this.event('launch',{role:'manager',provider:run.project.manager});
        this.output('builder','Waiting for the manager to retrieve Figma context and send the implementation prompt.\r\n');
        this.terminals.manager=await this.launch('manager',run.project.manager,run.project.directory,managerPrompt(run,managerContinuationPrompt),(d)=>this.output('manager',d,run),()=>{if(this.terminalEpoch===epoch)this.terminalExited('manager');});
      }catch(e){
        this.killTerminals();
        run.status='blocked';
        run.message=e.message;
        await this.control();
        throw e;
      }
    }
    this.timer=setInterval(()=>this.poll().catch(e=>console.warn('[Align] Poll error:',e.message)),this.interval);this.deadline=setTimeout(()=>this.pause('Execution paused after three hours. Resume to continue the current page.'),3*60*60*1000);this.deadline.unref?.();await this.persist();
  }
  output(role,data,targetRun=this.run){
    if(targetRun?.cleaning||targetRun?.cleaned)return;
    if(targetRun===this.run){
      this.ensureLog()?.terminal(role,data);
      this.buffers[role]=(this.buffers[role]+data).slice(-500000);
      this.emit('terminal',{role,data});
    }else if(this.backgroundSessions){
      const bg=this.backgroundSessions.get(targetRun?.sessionId||targetRun?.id);
      if(bg){
        bg.buffers=bg.buffers||{manager:'',builder:'',responsive:''};
        bg.buffers[role]=(bg.buffers[role]+data).slice(-500000);
      }
    }
    if(this.run){
      this.run.lastActiveRole=role;
      const provider=role==='manager'?this.run.project?.manager:this.run.project?.builder;
      const detected=detectProviderSession(role,provider,data);
      if(detected&&this.run.sessions?.[role]!==detected){
        this.run.sessions=this.run.sessions||{};
        this.run.sessions[role]=detected;
        this.run.sessions[provider+':'+role]=detected;
        updateSessionMemory(this.run,'session_detected',{role,provider,sessionId:detected}).catch(()=>{});
        this.persist().catch(()=>{});
      }
    }
  }
  async terminalExited(role){
    this.event('terminal_exit',{role});
    delete this.terminals[role];
    if(!this.run||['paused','completed','stopped','blocked'].includes(this.run.status))return;
    if(role==='manager'&&['builder','preparing'].includes(this.run.status)){
      this.output('manager','\r\n[Align] Manager completed turn; waiting for builder to complete task.\r\n');
      return;
    }
    if(role==='builder'){
      try{
        const res=await this.readSignal('builder-result.json');
        if(res?.ticket===this.run.ticket)return;
      }catch{}
    }
    if(role==='manager'){
      try{
        const act=await this.readSignal('manager-action.json');
        if(act?.ticket===this.run.ticket)return;
      }catch{}
    }
    this.run.retryCount=this.run.retryCount||{};
    const retries=this.run.retryCount[role]||0;
    if(retries<3){
      this.run.retryCount[role]=retries+1;
      this.event('agent_transient_retry',{role,attempt:this.run.retryCount[role]});
      this.output(role,`\r\n[Align] ${role==='manager'?'Manager':'Builder'} process exited. Auto-recovering terminal (attempt ${this.run.retryCount[role]} of 3)...\r\n`);
      const epoch=this.terminalEpoch;
      setTimeout(async()=>{
        try{
          if(this.terminalEpoch!==epoch||!this.run||['paused','completed','stopped','blocked'].includes(this.run.status))return;
          if(role==='manager'&&this.run.status==='manager'){
            const p=managerPrompt(this.run,'Continue the current step. Figma context and assets are preserved.');
            await this.ensureLog().prompt('manager',this.run.ticket,p);
            this.terminals.manager=await this.launch('manager',this.run.project.manager,this.run.project.directory,p,d=>this.output('manager',d),()=>{if(this.terminalEpoch===epoch)this.terminalExited('manager');});
          }else if(role==='builder'&&this.run.status==='builder'){
            const pageDir=pageDirectory(this.run);
            const handoff=await jsonRead(path.join(pageDir,'handoff.json'),null);
            const p=builderPrompt(this.run,handoff?.prompt||'Continue from existing project files; do not restart completed work.');
            await this.ensureLog().prompt('builder',this.run.ticket,p);
            this.terminals.builder=await this.launch('builder',this.run.project.builder,this.run.project.directory,p,d=>this.output('builder',d),()=>{if(this.terminalEpoch===epoch)this.terminalExited('builder');});
          }
        }catch(err){
          console.warn(`[Align] Auto-recovery for ${role} error:`,err.message);
        }
      },1500);
      return;
    }
    await this.pause(`${role==='manager'?'Manager':'Builder'} terminal exited after 3 recovery attempts. Code and evidence are preserved. Click Resume to continue.`);
  }
  async deliver(role,prompt){const t=this.terminals[role];if(!t)throw Error(`${role} terminal is not running.`);await this.ensureLog().prompt(role,this.run.ticket,prompt);await t.send(prompt);this.event('prompt_sent',{role});}
  async deliverManager(prompt){
    if(this.terminals.manager){
      await this.deliver('manager',prompt);
    }else{
      const epoch=this.terminalEpoch;
      await this.ensureLog().prompt('manager',this.run.ticket,prompt);
      this.event('launch',{role:'manager',provider:this.run.project.manager});
      this.terminals.manager=await this.launch('manager',this.run.project.manager,this.run.project.directory,prompt,(d)=>this.output('manager',d),()=>{if(this.terminalEpoch===epoch)this.terminalExited('manager');});
    }
  }
  input(role,data){if(!['manager','builder','responsive'].includes(role)||typeof data!=='string'||data.length>100000)throw Error('Invalid terminal input.');this.terminals[role]?.write(data);if(this.run&&!this.timer&&role!=='responsive'){this.timer=setInterval(()=>this.poll().catch(e=>this.block(e.message)),this.interval);}}
  resize(role,cols,rows){this.terminals[role]?.resize(Math.max(20,Math.min(300,Number(cols)||80)),Math.max(5,Math.min(100,Number(rows)||24)));}
  async generateResponsiveGuide(){
    if(!this.run||!this.run.project?.directory)return null;
    const guidePath=path.join(this.run.project.directory,'responsive-guide.md');
    if(this.run.guideGenerated){
      try{
        const existing=await fs.readFile(guidePath,'utf8');
        if(existing.trim().length>60)return existing;
      }catch{}
    }

    this.run.guideGenerating=true;
    this.run.message='Manager is analyzing website structure and preparing responsive design guide…';
    this.emit('state',this.state());

    const guidePrompt=`TASK: Generate a concise, concrete RESPONSIVE DESIGN BLUEPRINT for the website in this project directory: ${this.run.project.directory}.
Save this blueprint to \`responsive-guide.md\` in the project root directory.

Inspect the HTML/components and styling in this repository. In \`responsive-guide.md\`, detail:
1. Breakpoints: Mobile (375px-480px), Tablet (768px), Desktop (1024px+).
2. Layout containers: Specify which flex/grid sections need column stacking or 1-column layouts on small screens.
3. Navigation/Header: Menu collapse or compact scaling rules.
4. Images & Media: max-width: 100%, height: auto, object-fit.
5. Exact Files and Selectors: List the exact CSS classes and files to update.
6. Desktop preservation: Explicit note to never break desktop screens >= 1024px.

Write \`responsive-guide.md\` immediately. Work quickly and concisely.`;

    try{
      await this.deliverManager(guidePrompt);
      const startTime=Date.now();
      while(Date.now()-startTime<15000){
        await new Promise(r=>setTimeout(r,1000));
        try{
          const content=await fs.readFile(guidePath,'utf8');
          if(content.trim().length>60){
            this.run.guideGenerated=true;
            this.run.guideGenerating=false;
            this.emit('state',this.state());
            return content;
          }
        }catch{}
      }
    }catch(err){
      console.warn('[Phibee] Guide generation prompt error:',err.message);
    }finally{
      this.run.guideGenerating=false;
      this.emit('state',this.state());
    }
    return null;
  }
  async startResponsive(){
    if(!this.run||!this.run.project?.directory)throw Error('No active session.');
    if(this.terminals.responsive){return {running:true};}
    this.run.responsivePaused=false;
    this.run.lastActiveRole='responsive';
    this.run.resumeStage='responsive';
    const provider=this.run.project.responsiveProvider||this.run.project.builder;
    const model=this.run.project.responsiveModel||this.run.project.builderModel||'';
    const cwd=this.run.project.directory;
    const previewUrl=this.run.previewUrl||this.run.lastBuild?.previewUrl||this.run.memory?.lastBuild?.previewUrl||'http://localhost:5173';

    let guide=null;
    try{
      guide=await this.generateResponsiveGuide();
    }catch(e){
      console.warn('[Phibee] Guide generation fallback:',e.message);
    }

    const prompt=`You are an expert responsive design specialist. Your ONLY task is to make the existing website fully responsive across all screen sizes (mobile 375px, tablet 768px, desktop 1440px).

The website is already built and running at: ${previewUrl}
Project directory: ${cwd}
${guide ? `\n--- MANAGER'S RESPONSIVE DESIGN BLUEPRINT ---\n${guide}\n-------------------------------------------\n` : ''}
RULES:
1. PRESERVE DESKTOP: DO NOT break or alter any existing desktop styling or layout (screens >= 1024px).
2. NO SCAFFOLDING: DO NOT run npm init, create-vite, or install packages. Work directly with existing files.
3. VIEWPORT CHECK: Ensure \`<meta name="viewport" content="width=device-width, initial-scale=1.0">\` is present in \`index.html\`.
4. BREAKPOINTS: Standard breakpoints:
   - Mobile: @media (max-width: 480px) and @media (max-width: 768px)
   - Tablet: @media (min-width: 769px) and (max-width: 1023px)
5. MEDIA QUERIES: Add responsive CSS directly to the primary stylesheet (e.g., \`src/style.css\`, \`src/App.css\`, or \`src/index.css\`).
6. LAYOUT COLLAPSE:
   - Convert multi-column CSS grids (\`grid-template-columns\`) and horizontal flex containers (\`flex-direction: row\`) to single column / \`flex-direction: column\` on <= 768px.
   - Stack navigation bars into compact menus or readable rows.
7. ZERO OVERFLOW:
   - Set \`overflow-x: hidden\` and \`box-sizing: border-box\` where needed.
   - All images, videos, canvas, and svg elements must have \`max-width: 100%; height: auto;\`.
8. TYPOGRAPHY: Scale down large hero headlines and oversized margins/paddings on mobile screens so text never clips or extends horizontally.
9. SPEED: Work rapidly. Directly read stylesheets, append or integrate media queries, and ensure clean execution without waiting.

Inspect the repository and apply the responsive styles now.`;

    this.buffers.responsive='';
    const epoch=this.terminalEpoch;
    try{
      this.ensureLog()?.prompt('responsive', this.run.ticket, prompt);
      const currentRun = this.run;
      this.terminals.responsive=await this.launch('responsive',provider,cwd,prompt,d=>{
        this.output('responsive', d, currentRun);
      },()=>{
        delete this.terminals.responsive;
        this.output('responsive', '\r\n[Phibee] Responsive Maker finished.\r\n', currentRun);
        this.emit('responsive_done', { projectName: currentRun?.project?.name, sessionId: currentRun?.sessionId || currentRun?.id });
        this.emit('state',this.state());
      },{
        usageDir:path.join(this.run.directory,'usage','responsive'),
        model,
        session:this.run.sessions?.responsive||'',
        autonomous:this.run.project.autonomous??true,
        run:this.run
      });
      this.emit('state',this.state());
    }catch(e){
      throw Error('Could not start responsive maker: '+e.message);
    }
    return {running:true};
  }
  pauseResponsive(){
    if(this.terminals.responsive){
      this.terminals.responsive.kill();
      delete this.terminals.responsive;
      if(this.run){
        this.run.responsivePaused=true;
        this.run.lastActiveRole='responsive';
        this.run.resumeStage='responsive';
      }
      this.output('responsive', '\r\n[Phibee] Responsive Maker paused. Click Resume to continue.\r\n');
      this.emit('state',this.state());
    }
  }
  async resumeResponsive(){
    if(this.run){
      this.run.responsivePaused=false;
      this.run.lastActiveRole='responsive';
    }
    return this.startResponsive();
  }
  stopResponsive(){
    if(this.terminals.responsive){
      this.terminals.responsive.kill();
      delete this.terminals.responsive;
      if(this.run){
        this.run.responsivePaused=false;
        this.run.lastActiveRole=this.run.status;
      }
      this.output('responsive', '\r\n[Phibee] Responsive Maker stopped.\r\n');
      this.emit('state',this.state());
    }
  }
  async readSignal(file, runDir = this.run?.directory){try{if(!runDir)return null;const p=await realInside(runDir,file),s=await fs.stat(p);if(s.size>100000)throw Error('Protocol message exceeds the size limit.');return JSON.parse(await fs.readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)return null;throw e;}}
  async poll(){if(this.polling)return;this.polling=true;try{
    if(this.run&&['manager','builder','completed'].includes(this.run.status)){
      if(this.run.status==='manager'&&Date.now()-this.run.stageStartedAt>5*60*1000){
        await this.pause('Manager exceeded 5 minutes without a handoff. Check Figma MCP access in the provider, then Resume; saved assets will be reused.');
      }else if(this.run.status==='manager'||this.run.status==='completed'){
        const action=await this.readSignal('manager-action.json', this.run.directory);
        if(action){
          const actionKey=JSON.stringify(action);
          if(actionKey!==this.lastHandledActionKey){
            const isBuild=action.type==='build';
            const ticketMatches=action.ticket===this.run.ticket;
            const isCorrection=(this.run.status==='completed'&&isBuild)||(isBuild&&!ticketMatches&&Boolean(action.prompt));
            if(ticketMatches||isCorrection){
              this.lastHandledActionKey=actionKey;
              if(this.run.status==='completed'||isCorrection){
                this.run.status='manager';
                this.run.ticket=action.ticket||this.run.ticket||uid();
                if(this.run.pages[this.run.pageIndex]){this.run.pages[this.run.pageIndex].status='active';}
              }
              const parsed=managerAction.parse(action);
              this.event('manager_action_received',{action:parsed.type});
              await this.handleManager(parsed);
            }else if(action.ticket!==this.run.ticket&&this.staleTicket!==action.ticket){
              this.staleTicket=action.ticket;
              this.event('stale_action_ignored',{receivedTicket:action.ticket});
            }
          }
        }
      }else if(this.run.status==='builder'){
        const result=await this.readSignal('builder-result.json', this.run.directory);
        if(result?.ticket===this.run.ticket)await this.handleBuilder(builderResult.parse(result));
      }
    }
    if(this.backgroundSessions){
      for(const [, bg] of this.backgroundSessions.entries()){
        if(bg.run&&['manager','builder','completed'].includes(bg.run.status)){
          const bgRun=bg.run;
          if(bgRun.status==='manager'||bgRun.status==='completed'){
            const action=await this.readSignal('manager-action.json', bgRun.directory);
            if(action){
              const actionKey=JSON.stringify(action);
              if(actionKey!==bg.lastHandledActionKey){
                const isBuild=action.type==='build';
                const ticketMatches=action.ticket===bgRun.ticket;
                const isCorrection=(bgRun.status==='completed'&&isBuild)||(isBuild&&!ticketMatches&&Boolean(action.prompt));
                if(ticketMatches||isCorrection){
                  bg.lastHandledActionKey=actionKey;
                  if(bgRun.status==='completed'||isCorrection){
                    bgRun.status='manager';
                    bgRun.ticket=action.ticket||bgRun.ticket||uid();
                    if(bgRun.pages[bgRun.pageIndex]){bgRun.pages[bgRun.pageIndex].status='active';}
                  }
                  const parsed=managerAction.parse(action);
                  await this.handleManager(parsed, bgRun, bg.terminals);
                  this.emit('state', this.state());
                }
              }
            }
          }else if(bgRun.status==='builder'){
            const result=await this.readSignal('builder-result.json', bgRun.directory);
            if(result?.ticket===bgRun.ticket){
              await this.handleBuilder(builderResult.parse(result), bgRun);
              this.emit('state', this.state());
            }
          }
        }
      }
    }
  }catch(err){console.warn('[Align] Poll transient error:',err.message);}finally{this.polling=false;}}
  async handleManager(action, r=this.run, terminals=this.terminals){if(!r||r.status!=='manager'||action.ticket!==r.ticket)return false;
    if(action.type==='blocked'){if(r===this.run)await this.block(action.reason);else{r.status='blocked';r.message=action.reason;await jsonWrite(path.join(r.directory,'control.json'),{status:'blocked',message:action.reason});}return true;}
    if(action.type==='build'){
      if(r.pages[r.pageIndex].iterations>=20){if(r===this.run)await this.pause('20 corrections on this page. Review the terminals, then Resume for another set.');return true;}
      r.reference=await realInside(r.project.directory,action.reference||path.join(pageDirectory(r),'reference.png'));
      const refBytes=await fs.readFile(r.reference);if(!refBytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Figma reference PNG is missing. The manager must save the real screenshot before handing off.');
      const staged=await stageAssets(r);await writeInventory(r);if(r===this.run)this.event('assets_staged',{count:staged.length});
      r.ticket=uid();r.status='preparing';r.verification=null;r.message='Preparing the builder handoff…';
      if(r===this.run)await this.control();else await jsonWrite(path.join(r.directory,'control.json'),{status:r.status,ticket:r.ticket,message:r.message});
      const cp={id:uid(),pageIndex:r.pageIndex,revision:r.revision+1};cp.directory=path.join(r.directory,'checkpoints',cp.id);cp.before=await snapshot(r.project.directory,cp.directory);r.checkpoints.push(cp);if(this.cancel?.signal?.aborted)return false;
      r.revision++;r.pages[r.pageIndex].iterations++;r.status='builder';r.guideGenerated=false;r.message=`Builder is working on ${r.project.pages[r.pageIndex].name}.`;
      if(r===this.run)await this.control();else await jsonWrite(path.join(r.directory,'control.json'),{status:r.status,ticket:r.ticket,message:r.message});
      await fs.unlink(path.join(r.directory,'builder-result.json')).catch(()=>{});
      await jsonWrite(path.join(pageDirectory(r),'handoff.json'),{prompt:action.prompt,reference:r.reference,figma:r.project.pages[r.pageIndex].url,context:path.join(pageDirectory(r),'context.md'),assets:path.join(pageDirectory(r),'assets'),ticket:r.ticket});
      updateSessionMemory(r,'manager_build',{prompt:action.prompt}).catch(()=>{});
      this.emit('handoff_ready', { projectName: r.project?.name, sessionId: r.sessionId || r.id });
      if(terminals.builder)await (terminals.builder.send ? terminals.builder.send(builderPrompt(r,action.prompt)) : this.deliver('builder',builderPrompt(r,action.prompt)));else{const epoch=this.terminalEpoch;if(r===this.run){await this.ensureLog().prompt('builder',r.ticket,builderPrompt(r,action.prompt));this.event('launch',{role:'builder',provider:r.project.builder});}terminals.builder=await this.launch('builder',r.project.builder,r.project.directory,builderPrompt(r,action.prompt),d=>this.output('builder',d,r),()=>{if(this.terminalEpoch===epoch)this.terminalExited('builder');});}return true;
    }
    if(action.type==='verify'){
      if(r.revision===0)throw Error('The manager must send a builder task before verifying this page.');
      const url=localPreview(action.previewUrl),reference=await realInside(r.project.directory,action.reference);const b=await fs.readFile(reference);if(!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Manager must provide an actual reference PNG for the current page.');
      r.status='verifying';r.message='Capturing the current page for the manager…';r.ticket=uid();
      if(r===this.run)await this.control();else await jsonWrite(path.join(r.directory,'control.json'),{status:r.status,ticket:r.ticket,message:r.message});
      const id=uid();const evidence=await this.capture(url,r.project.viewport,path.join(r.directory,'verification',id),this.cancel?.signal);if(this.cancel?.signal?.aborted)return false;
      r.previewUrl=url;r.verification={id,pageIndex:r.pageIndex,revision:r.revision,reference,...evidence};r.status='manager';r.message='Manager is comparing the design with the fresh render.';
      if(r===this.run)await this.control();else await jsonWrite(path.join(r.directory,'control.json'),{status:r.status,ticket:r.ticket,message:r.message});
      if(r===this.run)await this.deliverManager(managerPrompt(r,`FRESH VERIFICATION ${id}:\n${JSON.stringify(r.verification)}\nOpen both the original reference and captured screenshot. Inspect geometry and browser errors. Request focused corrections if anything material remains. Only page_done can finish this page; cite this exact verification ID and concrete checks.`));
      return true;
    }
    const v=r.verification;
    if(!v||v.id!==action.verificationId||v.pageIndex!==r.pageIndex||v.revision!==r.revision)throw Error('Completion rejected: the current page needs a fresh verification of its latest build.');
    if(v.errors?.length||v.overflow)throw Error('Completion rejected: browser errors or horizontal overflow remain.');
    const page=r.pages[r.pageIndex];page.status='done';page.summary=action.summary;page.checks=action.checks;page.verificationId=v.id;page.completedAt=new Date().toISOString();
    r.memory=await updateSessionMemory(r,'page_completed',{summary:action.summary,checks:action.checks});
    await this.syncProjectState(r);
    if(r.pageIndex===r.pages.length-1){r.status='completed';r.message='Every page in your queue has been reviewed.';r.ticket=uid();clearTimeout(this.deadline);if(r===this.run)await this.control();else await jsonWrite(path.join(r.directory,'control.json'),{status:r.status,message:r.message});this.emit('completed',r);return true;}
    r.pageIndex++;await fs.mkdir(path.join(pageDirectory(r),'assets'),{recursive:true});r.reference=null;r.revision=0;r.verification=null;r.ticket=uid();r.pages[r.pageIndex].status='active';r.message=`Moving to ${r.project.pages[r.pageIndex].name}.`;
    if(r===this.run){await this.control();await this.deliverManager(managerPrompt(r,'The previous page passed review. NOW focus exclusively on this next page. Preserve all completed pages. Inspect this new Figma selection before instructing the builder.'));}
    return true;
  }
  async handleBuilder(result, r=this.run){
    if(r===this.run)this.event('builder_result_received',{result});
    if(!r||r.status!=='builder'||result.ticket!==r.ticket)return false;
    const cp=r.checkpoints.at(-1);if(cp){const diff=await changed(r.project.directory,cp.before);cp.after=diff.after;cp.files=diff.files;}
    if(result.status==='blocked'){if(r===this.run)await this.block('Builder: '+result.summary);else{r.status='blocked';r.message='Builder: '+result.summary;}return true;}
    r.status='manager';r.ticket=uid();r.lastBuild=result;r.memory=await updateSessionMemory(r,'builder_done',result);
    if(r===this.run)await this.control();else await jsonWrite(path.join(r.directory,'control.json'),{status:r.status,ticket:r.ticket,lastBuild:result});
    if(this.startPreview){
      try{
        const base=await this.startPreview(r.project.directory,this.cancel?.signal);
        result.previewUrl=previewRoute(base,result.previewPath||'/');
        r.previewUrl=result.previewUrl;
        r.lastBuild.previewUrl=result.previewUrl;
        if(r===this.run){await this.persist();this.event('preview_started',{url:result.previewUrl});}
        this.emit('preview_ready',{projectName:r.project?.name,url:result.previewUrl,sessionId:r.sessionId||r.id});
        await this.syncProjectState(r);
      }catch(e){
        if(r===this.run)await this.block('Preview: '+e.message);
        return false;
      }
    }
    await this.syncProjectState(r);
    if(!result.previewUrl){if(r===this.run)await this.block('Builder did not supply a localhost preview URL. Ask it to start the dev server and report the route.');return false;}
    await this.handleManager({ticket:r.ticket,type:'verify',previewUrl:result.previewUrl,reference:r.reference||path.join(pageDirectory(r),'reference.png')}, r);return true;
  }
  async block(message){this.event('blocked',{message});if(!this.run||['paused','completed','stopped'].includes(this.run.status))return;this.run.status='blocked';this.run.message=message;await this.control();}
  killTerminals(){this.stopPreview?.();this.terminalEpoch=(this.terminalEpoch||0)+1;const list=Object.values(this.terminals);this.terminals={};for(const t of list)t.kill();clearInterval(this.timer);clearTimeout(this.deadline);this.cancel?.abort();}
  async pause(message='Paused. Your current page and progress are saved.'){
    this.event('paused',{message});
    if(!this.run)return;
    const hadResponsive=Boolean(this.terminals.responsive);
    this.run.responsivePaused=hadResponsive;
    if(hadResponsive){
      this.run.lastActiveRole='responsive';
    }
    if(['manager','builder'].includes(this.run.status))this.run.resumeStage=this.run.status;
    if(!hadResponsive){
      this.run.lastActiveRole=this.run.status;
    }
    this.run.status='paused';
    this.run.message=message;
    this.killTerminals();
    await updateSessionMemory(this.run,'session_paused',{lastActiveRole:this.run.lastActiveRole,resumeStage:this.run.resumeStage,responsivePaused:this.run.responsivePaused});
    await this.control();
  }
  async resume(){
    if(this.run&&['manager','builder','verifying','preparing','starting'].includes(this.run.status)){
      return this.state();
    }
    if(!this.run||!['paused','blocked'].includes(this.run.status))throw Error('No paused page to resume.');
    this.run.status='paused';
    this.killTerminals();
    if(this.polling)throw Error('The previous operation is stopping. Try Resume in a moment.');
    if(this.run.pages[this.run.pageIndex].iterations>=20)this.run.pages[this.run.pageIndex].iterations=0;
    if(this.run.project?.directory){
      try{
        const files=await scanProjectFiles(this.run.project.directory);
        if(this.run.memory)this.run.memory.projectFiles=files;
      }catch{}
    }
    if(this.run.lastActiveRole === 'responsive' || this.run.resumeStage === 'responsive' || this.run.responsivePaused){
      this.run.responsivePaused = false;
      this.run.lastActiveRole = 'responsive';
      this.run.resumeStage = 'responsive';
      this.run.status = 'completed';
      await this.startResponsive();
      await this.control();
      return this.state();
    }
    await this.openTerminals();
    return this.state();
  }
  async stop(){if(!this.run)return;if(['manager','builder'].includes(this.run.status))this.run.resumeStage=this.run.status;this.run.lastActiveRole=this.run.lastActiveRole||this.run.status;this.run.status='stopped';this.run.message='Stopped. Source files and local evidence are preserved.';this.killTerminals();await updateSessionMemory(this.run,'session_stopped',{lastActiveRole:this.run.lastActiveRole,resumeStage:this.run.resumeStage});await this.control();}
  async shutdown(){
    clearInterval(this.usageTimer);
    await this.refreshUsage();
    if(this.backgroundSessions){
      for(const [,bg] of this.backgroundSessions.entries()){
        for(const t of Object.values(bg.terminals||{}))t.kill?.();
        clearInterval(bg.timer);
        clearTimeout(bg.deadline);
        bg.cancel?.abort();
      }
      this.backgroundSessions.clear();
    }
    if(this.run&&!['completed','stopped'].includes(this.run.status))await this.pause('Phiby closed. Resume to continue this page.');else this.killTerminals();
    await this.log?.flush();
  }
}
