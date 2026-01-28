import { createServer } from "http";
import { parse } from "url";
import next from "next";
import type { Server } from "http";

let app: any;
let handle: any;
let server: Server | null = null;

export async function startTestServer(): Promise<{ port: number; server: Server }> {
  if (server) {
    const port = (server.address() as any).port;
    return { port, server };
  }

  app = next({ 
    dev: false, 
    dir: process.cwd(),
    conf: { distDir: '.next' }
  });
  
  handle = app.getRequestHandler();
  await app.prepare();

  server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Request error:', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server!.listen(0, (err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const port = (server.address() as any).port;
  console.log(`Test server listening on port ${port}`);
  return { port, server };
}

export async function stopTestServer(): Promise<void> {
  if (!server) return;
  
  await new Promise<void>((resolve, reject) => {
    server!.close((err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });
  
  if (app) await app.close();
  server = null;
  app = null;
  handle = null;
  console.log('Test server stopped');
}