const {contextBridge,ipcRenderer}=require('electron');
const subscribe=(channel,fn)=>{const listener=(_event,data)=>fn(data);ipcRenderer.on(channel,listener);return()=>ipcRenderer.removeListener(channel,listener);};
contextBridge.exposeInMainWorld('align',{
  viewWebsite:()=>ipcRenderer.invoke('align:view-website'),
  models:provider=>ipcRenderer.invoke('align:models',provider),
  cleanup:()=>ipcRenderer.invoke('align:cleanup'),
  openLogs:()=>ipcRenderer.invoke('align:logs'),
  openEditor:()=>ipcRenderer.invoke('align:open-editor'),
  listFiles:()=>ipcRenderer.invoke('align:list-files'),
  openSession:project=>ipcRenderer.invoke('align:open-session',project),
  setNotifications:enabled=>ipcRenderer.invoke('align:set-notifications',enabled),
  setAutonomous:enabled=>ipcRenderer.invoke('align:set-autonomous',enabled),
  startResponsive:()=>ipcRenderer.invoke('align:start-responsive'),
  stopResponsive:()=>ipcRenderer.invoke('align:stop-responsive'),
  pauseResponsive:()=>ipcRenderer.invoke('align:pause-responsive'),
  resumeResponsive:()=>ipcRenderer.invoke('align:resume-responsive'),
  state:()=>ipcRenderer.invoke('align:state'),start:project=>ipcRenderer.invoke('align:start',project),pause:()=>ipcRenderer.invoke('align:pause'),resume:()=>ipcRenderer.invoke('align:resume'),stop:()=>ipcRenderer.invoke('align:stop'),heartbeat:()=>ipcRenderer.invoke('align:heartbeat'),
  chooseFolder:()=>ipcRenderer.invoke('align:folder'),attach:role=>ipcRenderer.invoke('align:attach',role),input:(role,data)=>ipcRenderer.send('align:input',role,data),resize:(role,cols,rows)=>ipcRenderer.send('align:resize',role,cols,rows),
  onState:fn=>subscribe('align:state',fn),onTerminal:fn=>subscribe('align:terminal',fn),onApproval:fn=>subscribe('align:approval-prompt',fn)
});
