import { createServer as createHttpServer } from "http";
import { parse } from "url";
import next from "next";

export async function createServer() {
  const app = next({ dev: false, dir: process.cwd() });
  const handle = app.getRequestHandler();
  
  await app.prepare();
  
  const server = createHttpServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Request error:', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });
  
  return server;
}