import { unlink } from 'node:fs/promises';
await unlink('dist/standalone-preview.html').catch(error=>{if(error.code!=='ENOENT')throw error;});
