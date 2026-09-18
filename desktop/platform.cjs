const path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
function stateRoot(home=os.homedir(),platform=process.platform,env=process.env){return platform==='darwin'?path.join(home,'Library','Application Support','Align'):platform==='win32'?path.join(env.APPDATA||path.join(home,'AppData','Roaming'),'Align'):path.join(env.XDG_CONFIG_HOME||path.join(home,'.config'),'Align');}
function killTree(pid){if(process.platform==='win32')spawn('taskkill',['/pid',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});else try{process.kill(-pid,'SIGTERM');}catch{}}
module.exports={stateRoot,killTree};
