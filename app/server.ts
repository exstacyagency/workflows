import http from "http";
import next from "next";

export async function createServer() {
  const app = next({
    dev: true,
    dir: process.cwd(),
  });

  const handle = app.getRequestHandler();
  await app.prepare();

  const server = http.createServer((req, res) => {
    handle(req, res);
  });

  return server;
}
