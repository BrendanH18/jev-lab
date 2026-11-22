import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { createInterface } from "node:readline";
import zlib from "node:zlib";

// Start the real Jev Lab server with temporary data and a loopback model stub.
export async function startBrowserApp(respond) {
  const stub = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url.endsWith("/v1/models")) {
      return send(200, { models: [{ name: "jev-1.14.0", description: "stub", release_date: "2026-10-14" }] });
    }
    if (req.method !== "POST" || !req.url.endsWith("/v1/systemone")) return send(404, { detail: { message: "stub" } });
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let raw = Buffer.concat(chunks);
    if (req.headers["content-encoding"] === "zstd") raw = zlib.zstdDecompressSync(raw); // the SDK on Python 3.14
    send(...respond(JSON.parse(raw)));
  });
  stub.listen(0, "127.0.0.1");
  await once(stub, "listening");

  // Use the installed locked environment and keep SDK calls off any configured proxy.
  const noProxy = ["127.0.0.1", "localhost", process.env.NO_PROXY].filter(Boolean).join(",");
  const stubUrl = `http://127.0.0.1:${stub.address().port}`;
  const app = spawn("uv", ["run", "--offline", "--locked", "python", "tests/browser/serve.py", stubUrl], {
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, NO_PROXY: noProxy, no_proxy: noProxy },
  });
  const failed = new Promise((_, reject) => {
    app.once("error", reject);
    app.once("exit", (code) => reject(new Error(`tests/browser/serve.py exited (${code}) before it started`)));
  });
  const close = async () => {
    if (app.pid && app.exitCode === null && app.signalCode === null) {
      const exited = once(app, "exit");
      app.kill();
      await exited; // serve.py deletes its temporary directory on the way out
    }
    stub.close();
  };
  try {
    const [line] = await Promise.race([once(createInterface({ input: app.stdout }), "line"), failed]);
    return { base: `http://127.0.0.1:${JSON.parse(line).port}`, close };
  } catch (error) {
    await close();
    throw error;
  }
}
