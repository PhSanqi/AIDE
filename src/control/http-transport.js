import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const MCP_PROTOCOL_VERSION = "2026-07-28";
const MCP_SERVER_INFO = { name: "aide", version: "0.0.0" };
const UI_ASSETS = new Map([
  ["/", { url: new URL("../../web/index.html", import.meta.url), type: "text/html; charset=utf-8" }],
  ["/app.js", { url: new URL("../../web/app.js", import.meta.url), type: "text/javascript; charset=utf-8" }],
  ["/styles.css", { url: new URL("../../web/styles.css", import.meta.url), type: "text/css; charset=utf-8" }],
]);

const MCP_TOOLS = [
  {
    name: "aide_submit",
    description: "Start one AIDE Task and return its durable task id immediately. strategy=economy prefers the configured low-consumption target; strategy=capability prefers the configured high-capability target. crossfire requests two independent capability planners; decompose requests one structured capability decomposition decision before execution; semantic_acceptance adds explicit semantic criteria reviewed only after mechanical acceptance passes. AIDE continues supervision independently of the MCP request.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
        strategy: { type: "string", enum: ["economy", "capability"] },
        crossfire: { type: "boolean" },
        decompose: { type: "boolean" },
        constraints: { type: "array", maxItems: 32, items: { type: "string" } },
        semantic_acceptance: { type: "array", maxItems: 16, items: { type: "string" } },
        options: { type: "object" },
        client_request_id: { type: "string" },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    name: "aide_status",
    description: "Read durable AIDE Task state, current Attempt, frozen Harness approval contract, actual native approval state, pending interactions, and each pending interaction's native response contract.",
    inputSchema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"], additionalProperties: false },
  },
  {
    name: "aide_respond",
    description: "Resolve one pending AIDE interaction using the response shape declared by that interaction's native_contract, then continue the Task to its next boundary.",
    inputSchema: {
      type: "object",
      properties: { interaction_id: { type: "string" }, response: {}, options: { type: "object" } },
      required: ["interaction_id", "response"],
      additionalProperties: false,
    },
  },
  {
    name: "aide_steer",
    description: "Steer the currently active Attempt of one Task when its assigned Harness supports same-turn steering.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" }, message: { type: "string" } },
      required: ["task_id", "message"],
      additionalProperties: false,
    },
  },
  {
    name: "aide_cancel",
    description: "Request cancellation of the currently active Attempt for one Task.",
    inputSchema: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"], additionalProperties: false },
  },
  {
    name: "aide_recoveries",
    description: "List open Tasks whose durable state is active but whose previous native run is detached after a service restart.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "aide_routing_history",
    description: "Read bounded observational routing/outcome history for offline replay and calibration. This never changes current routing decisions.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 1000 } }, additionalProperties: false },
  },
  {
    name: "aide_recover",
    description: "Resolve one detached AIDE Attempt. Same-host persisted PIDs are checked automatically; otherwise quiescent=true is required. Reroute uses persisted side-effect classification.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        action: { type: "string", enum: ["abandon", "reroute", "finalize"] },
        quiescent: { type: "boolean" },
      },
      required: ["task_id", "action"],
      additionalProperties: false,
    },
  },
];

function httpError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, http_status: status });
}

function optionsObject(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("options must be a JSON object.");
  return value;
}

function submitOptions(options, strategy, crossfire, decompose, constraints, semanticAcceptance) {
  const base = optionsObject(options);
  if (constraints !== undefined) {
    if (!Array.isArray(constraints) || constraints.length > 32 || constraints.some((item) => typeof item !== "string" || item.trim().length === 0)) {
      throw new TypeError("constraints must be an array of at most 32 non-empty strings.");
    }
    if (base.constraints !== undefined) throw new TypeError("constraints conflicts with options.constraints.");
  }
  let acceptance = base.acceptance;
  if (semanticAcceptance !== undefined) {
    if (!Array.isArray(semanticAcceptance) || semanticAcceptance.length > 16
      || semanticAcceptance.some((item) => typeof item !== "string" || item.trim().length === 0 || item.length > 1_000)) {
      throw new TypeError("semantic_acceptance must be an array of at most 16 non-empty strings up to 1000 characters.");
    }
    const existing = acceptance === undefined ? {} : optionsObject(acceptance);
    if (existing.semantic !== undefined) throw new TypeError("semantic_acceptance conflicts with options.acceptance.semantic.");
    acceptance = { ...existing, semantic: semanticAcceptance };
  }
  const requirements = base.requirements === undefined ? {} : optionsObject(base.requirements);
  if (strategy !== undefined && !["economy", "capability"].includes(strategy)) throw new TypeError("strategy must be economy or capability.");
  if (strategy !== undefined && requirements.execution_strategy !== undefined && requirements.execution_strategy !== strategy) {
    throw new TypeError("strategy conflicts with options.requirements.execution_strategy.");
  }
  const executionStrategy = strategy ?? requirements.execution_strategy;
  if (crossfire !== undefined && typeof crossfire !== "boolean") throw new TypeError("crossfire must be a boolean.");
  if (crossfire === true && executionStrategy === "economy") throw new TypeError("crossfire requires capability strategy.");
  if (crossfire === true && requirements.plan_consensus !== undefined && requirements.plan_consensus !== "dual") {
    throw new TypeError("crossfire conflicts with options.requirements.plan_consensus.");
  }
  if (decompose !== undefined && typeof decompose !== "boolean") throw new TypeError("decompose must be a boolean.");
  if (decompose === true && executionStrategy === "economy") throw new TypeError("decompose requires capability strategy.");
  if (decompose === true && crossfire === true) throw new TypeError("decompose cannot be combined with crossfire.");
  if (decompose === true && requirements.semantic_decomposition !== undefined && requirements.semantic_decomposition !== "plan") {
    throw new TypeError("decompose conflicts with options.requirements.semantic_decomposition.");
  }
  const merged = {
    ...requirements,
    ...(executionStrategy === undefined ? {} : { execution_strategy: executionStrategy }),
    ...(crossfire === true ? { execution_strategy: "capability", plan_consensus: "dual" } : {}),
    ...(decompose === true ? { execution_strategy: "capability", semantic_decomposition: "plan" } : {}),
  };
  return {
    ...base,
    ...(constraints === undefined ? {} : { constraints }),
    ...(semanticAcceptance === undefined ? {} : { acceptance }),
    ...(Object.keys(merged).length === 0 ? {} : { requirements: merged }),
  };
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${name} is required.`);
  return value;
}

function authorized(header, token) {
  if (token === null) return true;
  const supplied = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
  const left = Buffer.from(supplied);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function jsonBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw httpError("AIDE_HTTP_BODY_TOO_LARGE", "Request body is too large.", 413);
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Body must be an object.");
    return value;
  } catch {
    throw httpError("AIDE_HTTP_JSON_INVALID", "Request body must be a JSON object.");
  }
}

function writeJson(response, status, value) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  response.end(body);
}

async function writeAsset(response, asset) {
  const body = await readFile(asset.url);
  response.writeHead(200, {
    "content-type": asset.type,
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function mcpResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      ...result,
      _meta: { ...(result?._meta ?? {}), "io.modelcontextprotocol/serverInfo": MCP_SERVER_INFO },
    },
  };
}

function mcpError(id, code, message, data = undefined) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function mcpToolResult(value) {
  return {
    resultType: "complete",
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    isError: false,
  };
}

function errorStatus(error) {
  if (Number.isInteger(error?.http_status)) return error.http_status;
  if (String(error?.code ?? "").includes("NOT_FOUND")) return 404;
  if (error?.code === "PROVIDER_AUTH_UNSUPPORTED") return 400;
  if (["SERVICE_LEASE_BUSY", "SERVICE_LEASE_LOST", "SERVICE_LEASE_RELEASED"].includes(error?.code)) return 503;
  if (String(error?.code ?? "").startsWith("RECOVERY_")) return 409;
  if (String(error?.code ?? "").includes("STATE_INVALID") || String(error?.code ?? "").includes("CONFLICT")) return 409;
  if (error instanceof TypeError || String(error?.code ?? "").includes("INVALID")) return 400;
  return 500;
}

export class AideHttpTransport {
  constructor({ runtime, host, port, token, bodyLimit }) {
    this.runtime = runtime;
    this.host = host;
    this.port = port;
    this.token = token;
    this.bodyLimit = bodyLimit;
    this.server = createServer((request, response) => { void this.#handle(request, response); });
  }

  static async start({
    runtime,
    host = "127.0.0.1",
    port = 0,
    token = process.env.AIDE_CONTROL_TOKEN ?? null,
    bodyLimit = 256 * 1024,
  } = {}) {
    if (!runtime || typeof runtime.enqueue !== "function") throw new TypeError("HTTP transport requires AideServiceRuntime.");
    if (!LOOPBACK_HOSTS.has(host) && (typeof token !== "string" || token.length < 16)) {
      throw httpError("AIDE_HTTP_AUTH_REQUIRED", "Non-loopback AIDE HTTP transport requires AIDE_CONTROL_TOKEN with at least 16 characters.", 500);
    }
    if (token !== null && (typeof token !== "string" || token.length < 16)) throw new TypeError("HTTP bearer token must contain at least 16 characters.");
    if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new TypeError("HTTP port is invalid.");
    if (!Number.isInteger(bodyLimit) || bodyLimit < 1_024) throw new TypeError("HTTP bodyLimit must be at least 1024 bytes.");
    const transport = new AideHttpTransport({ runtime, host, port, token, bodyLimit });
    await new Promise((resolve, reject) => {
      transport.server.once("error", reject);
      transport.server.listen(port, host, () => {
        transport.server.off("error", reject);
        resolve();
      });
    });
    return transport;
  }

  address() {
    const address = this.server.address();
    return typeof address === "object" && address ? { host: this.host, port: address.port } : null;
  }

  async stop() {
    if (!this.server.listening) return;
    await new Promise((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
  }

  async #handle(request, response) {
    try {
      if (!authorized(request.headers.authorization, this.token)) throw httpError("AIDE_HTTP_UNAUTHORIZED", "Unauthorized.", 401);
      const url = new URL(request.url ?? "/", "http://aide.local");
      const path = url.pathname;
      const method = request.method ?? "GET";

      if (method === "GET" && UI_ASSETS.has(path)) return writeAsset(response, UI_ASSETS.get(path));
      if (method === "POST" && path === "/mcp") return this.#handleMcp(request, response);
      if (method === "GET" && path === "/health") return writeJson(response, 200, await this.runtime.health());
      if (method === "GET" && path === "/v1/catalog") return writeJson(response, 200, await this.runtime.catalog());
      if (method === "GET" && path === "/v1/conversations") return writeJson(response, 200, { conversations: await this.runtime.conversations({ archived: url.searchParams.get("archived") === "true" }) });
      if (method === "POST" && path === "/v1/conversations") {
        const body = await jsonBody(request, this.bodyLimit);
        return writeJson(response, 201, await this.runtime.createConversation({ title: body.title ?? "New conversation", defaults: body.defaults ?? {} }));
      }
      if (method === "GET" && path === "/v1/tasks") {
        const rawLimit = url.searchParams.get("limit");
        return writeJson(response, 200, { tasks: await this.runtime.tasks({ limit: rawLimit === null ? 100 : Number(rawLimit) }) });
      }
      let providerMatch = path.match(/^\/v1\/providers\/([^/]+)\/login$/);
      if (method === "POST" && providerMatch) {
        const body = await jsonBody(request, this.bodyLimit);
        return writeJson(response, 200, await this.runtime.providerLogin(decodeURIComponent(providerMatch[1]), {
          method: body.method ?? "chatgpt",
          apiKey: body.api_key ?? null,
        }));
      }
      providerMatch = path.match(/^\/v1\/providers\/([^/]+)\/login\/([^/]+)$/);
      if (method === "GET" && providerMatch) {
        return writeJson(response, 200, await this.runtime.providerLoginStatus(decodeURIComponent(providerMatch[1]), decodeURIComponent(providerMatch[2])));
      }
      providerMatch = path.match(/^\/v1\/providers\/([^/]+)\/login\/([^/]+)\/cancel$/);
      if (method === "POST" && providerMatch) {
        return writeJson(response, 200, await this.runtime.providerLoginCancel(decodeURIComponent(providerMatch[1]), decodeURIComponent(providerMatch[2])));
      }
      providerMatch = path.match(/^\/v1\/providers\/([^/]+)\/logout$/);
      if (method === "POST" && providerMatch) return writeJson(response, 200, await this.runtime.providerLogout(decodeURIComponent(providerMatch[1])));
      if (method === "GET" && path === "/v1/recoveries") return writeJson(response, 200, { recoveries: await this.runtime.recoveries() });
      if (method === "GET" && path === "/v1/routing-history") {
        const rawLimit = url.searchParams.get("limit");
        const limit = rawLimit === null ? 100 : Number(rawLimit);
        return writeJson(response, 200, { history: await this.runtime.routingHistory({ limit }) });
      }
      if (method === "POST" && path === "/v1/tasks") {
        const body = await jsonBody(request, this.bodyLimit);
        const clientRequestId = request.headers["idempotency-key"] ?? null;
        return writeJson(response, 202, await this.runtime.enqueue(requiredString(body.message, "message"), submitOptions(body.options, body.strategy, body.crossfire, body.decompose, body.constraints, body.semantic_acceptance), { clientRequestId }));
      }

      let conversationMatch = path.match(/^\/v1\/conversations\/([^/]+)$/);
      if (method === "GET" && conversationMatch) return writeJson(response, 200, await this.runtime.conversation(decodeURIComponent(conversationMatch[1])));
      if (method === "PATCH" && conversationMatch) {
        const body = await jsonBody(request, this.bodyLimit);
        return writeJson(response, 200, await this.runtime.updateConversation(decodeURIComponent(conversationMatch[1]), body));
      }
      conversationMatch = path.match(/^\/v1\/conversations\/([^/]+)\/tasks$/);
      if (method === "POST" && conversationMatch) {
        const body = await jsonBody(request, this.bodyLimit);
        const clientRequestId = request.headers["idempotency-key"] ?? null;
        const conversationId = decodeURIComponent(conversationMatch[1]);
        const options = submitOptions(body.options, body.strategy, body.crossfire, body.decompose, body.constraints, body.semantic_acceptance);
        return writeJson(response, 202, await this.runtime.enqueue(requiredString(body.message, "message"), { ...options, conversationId }, { clientRequestId }));
      }

      let match = path.match(/^\/v1\/tasks\/([^/]+)$/);
      if (method === "GET" && match) return writeJson(response, 200, await this.runtime.status(decodeURIComponent(match[1])));
      match = path.match(/^\/v1\/tasks\/([^/]+)\/(steer|cancel|recover)$/);
      if (method === "POST" && match) {
        const taskId = decodeURIComponent(match[1]);
        if (match[2] === "cancel") return writeJson(response, 202, await this.runtime.cancelTask(taskId));
        const body = await jsonBody(request, this.bodyLimit);
        if (match[2] === "recover") {
          return writeJson(response, 200, await this.runtime.recoverTask(taskId, {
            action: requiredString(body.action, "action"),
            quiescent: body.quiescent,
          }));
        }
        return writeJson(response, 200, await this.runtime.steerTask(taskId, requiredString(body.message, "message")));
      }

      match = path.match(/^\/v1\/interactions\/([^/]+)\/respond$/);
      if (method === "POST" && match) {
        const body = await jsonBody(request, this.bodyLimit);
        if (!Object.hasOwn(body, "response")) throw new TypeError("response is required.");
        return writeJson(response, 200, await this.runtime.respond(decodeURIComponent(match[1]), body.response, optionsObject(body.options)));
      }

      throw httpError("AIDE_HTTP_NOT_FOUND", "Route not found.", 404);
    } catch (error) {
      if (!response.headersSent) {
        writeJson(response, errorStatus(error), { error: { code: error?.code ?? "AIDE_HTTP_INTERNAL", message: error?.message ?? "Internal error." } });
      } else {
        response.destroy();
      }
    }
  }

  async #handleMcp(request, response) {
    let body;
    try {
      body = await jsonBody(request, this.bodyLimit);
      const id = body.id ?? null;
      if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
        return writeJson(response, 400, mcpError(id, -32600, "Invalid Request"));
      }
      const protocol = request.headers["mcp-protocol-version"];
      const headerMethod = request.headers["mcp-method"];
      const headerName = request.headers["mcp-name"];
      const meta = body.params?._meta ?? {};
      if (protocol !== MCP_PROTOCOL_VERSION || meta["io.modelcontextprotocol/protocolVersion"] !== MCP_PROTOCOL_VERSION) {
        return writeJson(response, 400, mcpError(id, -32602, "Unsupported MCP protocol version.", { supported: [MCP_PROTOCOL_VERSION] }));
      }
      if (!meta["io.modelcontextprotocol/clientCapabilities"] || typeof meta["io.modelcontextprotocol/clientCapabilities"] !== "object" || Array.isArray(meta["io.modelcontextprotocol/clientCapabilities"])) {
        return writeJson(response, 400, mcpError(id, -32602, "MCP clientCapabilities metadata is required."));
      }
      const expectedName = body.method === "tools/call" ? body.params?.name : undefined;
      if (headerMethod !== body.method || (expectedName !== undefined && headerName !== expectedName) || (expectedName === undefined && headerName !== undefined)) {
        return writeJson(response, 400, mcpError(id, -32020, "MCP routing headers do not match the JSON-RPC request."));
      }

      if (body.method === "server/discover") {
        return writeJson(response, 200, mcpResult(id, {
          resultType: "complete",
          supportedVersions: [MCP_PROTOCOL_VERSION],
          capabilities: { tools: {} },
          instructions: "Use aide_submit to start durable work, then aide_status/aide_respond/aide_steer/aide_cancel with explicit AIDE handles.",
          ttlMs: 60_000,
          cacheScope: "private",
        }));
      }
      if (body.method === "tools/list") {
        return writeJson(response, 200, mcpResult(id, { resultType: "complete", tools: MCP_TOOLS, ttlMs: 60_000, cacheScope: "private" }));
      }
      if (body.method === "tools/call") {
        try {
          const value = await this.#callMcpTool(body.params?.name, body.params?.arguments ?? {});
          return writeJson(response, 200, mcpResult(id, mcpToolResult(value)));
        } catch (error) {
          if (error instanceof TypeError || error?.code === "AIDE_MCP_TOOL_NOT_FOUND") throw error;
          const failure = {
            resultType: "complete",
            content: [{ type: "text", text: JSON.stringify({ error_code: error?.code ?? "AIDE_TOOL_FAILED", error_message: error?.message ?? "AIDE tool failed." }) }],
            structuredContent: { error: { code: error?.code ?? "AIDE_TOOL_FAILED", message: error?.message ?? "AIDE tool failed." } },
            isError: true,
          };
          return writeJson(response, 200, mcpResult(id, failure));
        }
      }
      return writeJson(response, 200, mcpError(id, -32601, "Method not found"));
    } catch (error) {
      const id = body?.id ?? null;
      const code = error instanceof TypeError ? -32602 : -32603;
      return writeJson(response, errorStatus(error), mcpError(id, code, error?.message ?? "Internal error", { aide_code: error?.code ?? null }));
    }
  }

  async #callMcpTool(name, args) {
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new TypeError("MCP tool arguments must be an object.");
    if (name === "aide_submit") {
      return this.runtime.enqueue(requiredString(args.message, "message"), submitOptions(args.options, args.strategy, args.crossfire, args.decompose, args.constraints, args.semantic_acceptance), { clientRequestId: args.client_request_id ?? null });
    }
    if (name === "aide_status") return this.runtime.status(requiredString(args.task_id, "task_id"));
    if (name === "aide_respond") {
      requiredString(args.interaction_id, "interaction_id");
      if (!Object.hasOwn(args, "response")) throw new TypeError("response is required.");
      return this.runtime.respond(args.interaction_id, args.response, optionsObject(args.options));
    }
    if (name === "aide_steer") return this.runtime.steerTask(requiredString(args.task_id, "task_id"), requiredString(args.message, "message"));
    if (name === "aide_cancel") return this.runtime.cancelTask(requiredString(args.task_id, "task_id"));
    if (name === "aide_recoveries") return { recoveries: await this.runtime.recoveries() };
    if (name === "aide_routing_history") return { history: await this.runtime.routingHistory({ limit: args.limit ?? 100 }) };
    if (name === "aide_recover") {
      return this.runtime.recoverTask(requiredString(args.task_id, "task_id"), {
        action: requiredString(args.action, "action"),
        quiescent: args.quiescent,
      });
    }
    throw httpError("AIDE_MCP_TOOL_NOT_FOUND", `Unknown AIDE MCP tool: ${name}`, 404);
  }
}
