// Serve an Actions-built bundle using only Node's standard library.
import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute, extname } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  dir: { type: "string", default: "dist" },
  host: { type: "string", default: "0.0.0.0" },
  port: { type: "string", default: "4173" },
} });
const root = await realpath(resolve(values.dir));
await stat(resolve(root, "index.html"));
const port = Number(values.port);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Неверный порт");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".wasm": "application/wasm" };
const inside = (path) => { const rel = relative(root, path); return !rel.startsWith("..") && !isAbsolute(rel); };
const server = createServer(async (request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return; }
  try {
    const url = new URL(request.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    const file = await realpath(resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`));
    if (!inside(file)) { response.writeHead(403).end(); return; }
    const info = await stat(file);
    if (!info.isFile()) { response.writeHead(404).end(); return; }
    const data = await readFile(file);
    response.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream", "Content-Length": data.length, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch { response.writeHead(404).end(); }
});
server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(port, values.host, () => console.log(`Bunker: http://localhost:${port} (${root})`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
