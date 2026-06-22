#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TopvisorApiClient } from "./api-client.js";
import { registerCoreTools } from "./tools/core.js";

const server = new McpServer({
  name: "topvisor-mcp",
  version: "1.0.0",
});

// Client is constructed unconditionally — creds are validated lazily
// only when a tool that makes an actual API call is invoked.
// This allows tools/list and topvisor_services to work without credentials.
const client = new TopvisorApiClient();

registerCoreTools(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);
