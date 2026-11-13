import './build-offline-preview.mjs';
import { copyFile } from 'node:fs/promises';
await copyFile('.cache/bedroom-offline.html','dist/standalone-preview.html');
