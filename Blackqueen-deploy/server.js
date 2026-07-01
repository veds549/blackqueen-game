const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const root = __dirname;
const tables = new Map();
const port = Number(process.env.PORT || 8790);
const host = process.env.HOST || "0.0.0.0";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 3_000_000) request.destroy();
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function tableId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function cleanMessage(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 300);
}

function serveStatic(request, response, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(root, pathname));
  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(data);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === "POST" && url.pathname === "/api/tables") {
      const body = await readJson(request);
      const id = tableId();
      tables.set(id, { id, version: 1, state: body.state, messages: [], nextMessageId: 1 });
      sendJson(response, 201, { id, version: 1 });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    const messageMatch = url.pathname.match(/^\/api\/tables\/([A-Z0-9]+)\/messages$/);
    if (messageMatch && request.method === "GET") {
      const table = tables.get(messageMatch[1]);
      if (!table) {
        sendJson(response, 404, { error: "Table not found" });
        return;
      }
      const after = Math.max(0, Number(url.searchParams.get("after")) || 0);
      sendJson(response, 200, { messages: table.messages.filter((message) => message.id > after) });
      return;
    }

    if (messageMatch && request.method === "POST") {
      const table = tables.get(messageMatch[1]);
      if (!table) {
        sendJson(response, 404, { error: "Table not found" });
        return;
      }
      const body = await readJson(request);
      const text = cleanMessage(body.text);
      if (!text) {
        sendJson(response, 400, { error: "Message is empty" });
        return;
      }
      const playerId = Number(body.playerId);
      const player = table.state?.players?.find((item) => item.id === playerId);
      const author = body.role === "host" ? "Host" : player?.name || "Player";
      const message = {
        id: table.nextMessageId++,
        author,
        playerId: body.role === "host" ? null : playerId,
        role: body.role === "host" ? "host" : "player",
        text,
        sentAt: new Date().toISOString(),
      };
      table.messages.push(message);
      if (table.messages.length > 200) table.messages.splice(0, table.messages.length - 200);
      sendJson(response, 201, { message });
      return;
    }

    const tableMatch = url.pathname.match(/^\/api\/tables\/([A-Z0-9]+)$/);
    if (tableMatch && request.method === "GET") {
      const table = tables.get(tableMatch[1]);
      if (!table) {
        sendJson(response, 404, { error: "Table not found" });
        return;
      }
      sendJson(response, 200, table);
      return;
    }

    if (tableMatch && request.method === "PUT") {
      const table = tables.get(tableMatch[1]);
      if (!table) {
        sendJson(response, 404, { error: "Table not found" });
        return;
      }
      const body = await readJson(request);
      table.state = body.state;
      table.version += 1;
      sendJson(response, 200, { id: table.id, version: table.version });
      return;
    }

    serveStatic(request, response, url);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Blackqueen multiplayer server: http://127.0.0.1:${port}/index.html`);
});
