import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, mkdir, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';

const env={...process.env};
// Local Linux reuses system Chromium and FFmpeg; CI uses Playwright's downloaded executables.
if(!env.CI&&!env.PLAYWRIGHT_BROWSERS_PATH&&process.platform==='linux'&&existsSync('/usr/bin/chromium')&&existsSync('/usr/bin/ffmpeg')){
 const registry=JSON.parse(await readFile('node_modules/playwright-core/browsers.json','utf8'));
 const revision=registry.browsers.find(browser=>browser.name==='ffmpeg').revision;
 env.PLAYWRIGHT_BROWSERS_PATH=path.resolve('.cache/playwright');
 const directory=path.join(env.PLAYWRIGHT_BROWSERS_PATH,`ffmpeg-${revision}`);
 await mkdir(directory,{recursive:true});
 const executable=path.join(directory,'ffmpeg-linux');
 try{await access(executable);}catch{await symlink('/usr/bin/ffmpeg',executable);}
}
const child=spawn(process.execPath,['node_modules/playwright/cli.js','test',...process.argv.slice(2)],{stdio:'inherit',env});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
child.once('error',error=>{console.error(error.message);process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code??1;});
