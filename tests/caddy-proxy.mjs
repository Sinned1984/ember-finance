import { createServer } from "node:net";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function availablePort() {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}

// Real Caddy with an isolated test CA. Never installs trust or requests public certificates.
// Production configuration is reused; only loopback upstream/ports and test TLS are substituted.
export async function caddyProxy(upstreamPort) {
  const binary = process.env.EMBER_CADDY_BINARY || process.env.EMBER_TEST_CADDY_BINARY;
  if (!binary) throw new Error("Set EMBER_CADDY_BINARY to an installed Caddy executable.");
  const root = await mkdtemp(join(tmpdir(), "ember-caddy-check-"));
  const tlsPort = await availablePort(), httpPort = await availablePort(), adminPort = await availablePort();
  const origin = `https://localhost:${tlsPort}`;
  const config = (await readFile("deploy/Caddyfile", "utf8"))
    .replace("admin 127.0.0.1:2019", `admin 127.0.0.1:${adminPort}\n\tskip_install_trust\n\tdefault_bind 127.0.0.1\n\thttp_port ${httpPort}\n\thttps_port ${tlsPort}`)
    .replace("reverse_proxy ember:3000", `bind 127.0.0.1\n\ttls internal\n\treverse_proxy 127.0.0.1:${upstreamPort}`);
  const path = join(root, "Caddyfile"); await writeFile(path, config);
  await mkdir(join(root, "data")); await mkdir(join(root, "config"));
  const caPath = join(root, "data/caddy/pki/authorities/local/root.crt");
  let child, output = "";
  async function stop() {
    if (child && child.exitCode === null) { child.kill(); await once(child, "exit"); }
  }
  async function request(path, { method = "GET", headers = {}, body } = {}) {
    const ca = await readFile(caPath);
    return new Promise((resolve, reject) => {
      const req = httpsRequest(origin + path, { method, headers, ca, timeout: 10_000,
        lookup: (_hostname, options, callback) => options.all ? callback(null, [{ address: "127.0.0.1", family: 4 }]) : callback(null, "127.0.0.1", 4),
      }, res => {
        const chunks = []; res.on("data", chunk => chunks.push(chunk));
        const fingerprint = res.socket.getPeerCertificate().fingerprint256;
        res.on("end", () => {
          const response = new Response(Buffer.concat(chunks).length ? Buffer.concat(chunks) : null,
            { status: res.statusCode, headers: Object.entries(res.headers).flatMap(([key, values]) => (Array.isArray(values) ? values : [values]).filter(value => value !== undefined).map(value => [key, value])) });
          resolve({ response, fingerprint });
        });
      });
      req.on("error", reject); req.on("timeout", () => req.destroy(new Error("Synthetic HTTPS request timed out")));
      req.end(body);
    });
  }
  async function start() {
    output = "";
    child = spawn(binary, ["run", "--config", path, "--adapter", "caddyfile"], {
      env: { ...process.env, EMBER_APP_URL: origin, XDG_DATA_HOME: join(root, "data"), XDG_CONFIG_HOME: join(root, "config") },
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
    let readinessError;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(`Test Caddy could not start: ${output}`);
      try {
        // Match the non-browser wget healthcheck; fetch adds browser metadata.
        const adminHealthy = await new Promise((resolve, reject) => {
          const probe = httpRequest(`http://127.0.0.1:${adminPort}/config/`, { timeout: 1000 }, res => {
            res.resume(); res.on("end", () => resolve(res.statusCode === 200));
          });
          probe.on("error", reject); probe.on("timeout", () => probe.destroy(new Error("Caddy admin timeout")));
          probe.end();
        });
        if (adminHealthy) { await request("/api/health"); return; }
      } catch (error) { readinessError = `${error.message}: ${error.cause?.code || ""}`; }
      await delay(100);
    }
    throw new Error(`Test Caddy startup timed out: ${readinessError}\n${output}`);
  }
  try { await start(); }
  catch (error) { await stop(); await rm(root, { recursive: true, force: true }); throw error; }
  return { origin, httpOrigin: `http://127.0.0.1:${httpPort}`, request,
    async restart() { await stop(); await start(); },
    async close() { await stop(); await rm(root, { recursive: true, force: true }); },
  };
}
