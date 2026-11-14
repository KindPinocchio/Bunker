import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// A local preview only: same game modules and PNGs, bundled into one file without a server.
const root=process.cwd();
const assets={};
for (const name of ['raster/bedroom-atlas-v1.png','raster/bedroom-atlas-high-v1.png','raster/worker-high-v1.png','poster.svg','archive-photo.png']) {
 const bytes=await readFile(path.join(root,'public/assets/bedroom',name));
 assets[`/assets/bedroom/${name}`]=`data:${name.endsWith('.svg')?'image/svg+xml':'image/png'};base64,${bytes.toString('base64')}`;
}
const control=await readFile(path.join(root,'public/assets/control/control-surfaces-v1.png'));
assets['/assets/control/control-surfaces-v1.png']=`data:image/png;base64,${control.toString('base64')}`;
const result=await build({entryPoints:['src/game/bedroom-ui.ts'],bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,write:false,outdir:'.cache/offline',plugins:[{
 name:'inline-preview-assets',setup(b){b.onLoad({filter:/bedroom-(scene|ui)\.ts$/},async args=>{
  let code=await readFile(args.path,'utf8');
  if(args.path.endsWith('bedroom-scene.ts'))code=code.replace('Assets.load(BEDROOM_ART.atlas)','Assets.load(globalThis.__BUNKER_PREVIEW_ASSETS[BEDROOM_ART.atlas])').replace('Assets.load(BEDROOM_ART.materialAtlas)','Assets.load(globalThis.__BUNKER_PREVIEW_ASSETS[BEDROOM_ART.materialAtlas])').replace('Assets.load(CONTROL_ATLAS)','Assets.load(globalThis.__BUNKER_PREVIEW_ASSETS[CONTROL_ATLAS])').replace('Assets.load(person.atlas)','Assets.load(globalThis.__BUNKER_PREVIEW_ASSETS[person.atlas])').replace('Assets.load("/assets/bedroom/poster.svg")','Assets.load(globalThis.__BUNKER_PREVIEW_ASSETS["/assets/bedroom/poster.svg"])');
  else code=code.replace('img.src = m.image;','img.src = globalThis.__BUNKER_PREVIEW_ASSETS[m.image] ?? m.image;');
  return {contents:code,loader:'ts',resolveDir:path.dirname(args.path)};
 });}
}]});
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text.replace(/<\/script/gi,'<\\/script');
const css=result.outputFiles.find(f=>f.path.endsWith('.css')).text;
const html=`<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Бункер — локальный просмотр спрайтов</title><link rel="icon" href="data:,"><style>${css}</style></head><body><div id="app"></div><script>globalThis.__BUNKER_PREVIEW_ASSETS=${JSON.stringify(assets)};</script><script>${js}</script></body></html>`;
await mkdir('.cache',{recursive:true});
await writeFile('.cache/bedroom-offline.html',html);
console.log(`Local preview: .cache/bedroom-offline.html (${Buffer.byteLength(html)} bytes)`);
