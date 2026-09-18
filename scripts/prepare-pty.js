import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// Some npm tarballs omit the executable bit on node-pty's macOS helper.
if(process.platform==='darwin'){
  const root=path.dirname(require.resolve('node-pty/package.json'));
  for(const dir of ['prebuilds/darwin-'+process.arch,'build/Release']){
    const helper=path.join(root,dir,'spawn-helper');
    try{if((await fs.lstat(helper)).isFile())await fs.chmod(helper,0o755);}catch(e){if(e.code!=='ENOENT')throw e;}
  }
}
