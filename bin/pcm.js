#!/usr/bin/env node

/**
 * PCM CLI - Persistent Cognitive Mesh Command Line
 * Usage: node bin/pcm.js <command> [args]
 */

const path = require("path");
const fs = require("fs");

// Load PCM
const Mesh = require("../we/pcm/Mesh");

const COMMANDS = {
  bootstrap: cmd_bootstrap,
  think: cmd_think,
  status: cmd_status,
  blip: cmd_blip,
  pipeline: cmd_pipeline,
  help: cmd_help
};

// Global mesh instance
let mesh = null;

async function getMesh() {
  if (mesh) return mesh;
  mesh = new Mesh({
    hotPath: process.env.PCM_HOT || "./memory/hot.json",
    warmPath: process.env.PCM_WARM || "./memory/warm.db",
    coldPath: process.env.PCM_COLD || "./memory/cold",
    maxAgents: parseInt(process.env.PCM_AGENTS) || 10,
    blipSecret: process.env.PCM_BLIP_SECRET
  });
  await mesh.init({ agentCount: parseInt(process.env.PCM_AGENTS) || 10 });
  return mesh;
}

// === COMMANDS ===

async function cmd_bootstrap(args) {
  const sub = args[0];

  if (sub === "generate" || sub === "gen") {
    const m = await getMesh();
    const blip = m.bootstrap.generateBlip();
    console.log(JSON.stringify(blip, null, 2));
    return;
  }

  if (sub === "admit" || sub === "in") {
    if (!args[1] || !args[2]) {
      console.error("Usage: pcm bootstrap admit <agentJson> --blip <code>");
      process.exit(1);
    }
    const agentSpec = JSON.parse(args[1]);
    const blipCode = args.find(a => a.startsWith("--blip="))?.split("=")[1] || args.find(a => a === "--blip") ? args[args.indexOf("--blip") + 1] : null;
    const m = await getMesh();
    const result = await m.bootstrap.blipIn(agentSpec, blipCode);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (sub === "status") {
    const m = await getMesh();
    console.log(JSON.stringify(m.bootstrap.getStatus(), null, 2));
    return;
  }

  // Default: bootstrap from file
  const filePath = args[0] || process.env.PCM_BOOTSTRAP_FILE;
  if (!filePath) {
    console.error("Usage: pcm bootstrap <file.md>");
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error("File not found:", filePath);
    process.exit(1);
  }
  const m = await getMesh();
  console.log("Bootstrapping from", filePath + "...");
  const result = await m.bootstrap(filePath);
  console.log("Bootstrap complete:", JSON.stringify(result, null, 2));
}

async function cmd_think(args) {
  const input = args.join(" ");
  if (!input) {
    console.error("Usage: pcm think \"your question here\"");
    process.exit(1);
  }
  const m = await getMesh();
  console.log("Thinking...");
  const result = await m.think(input);
  console.log(JSON.stringify(result, null, 2));
}

async function cmd_status(args) {
  const m = await getMesh();
  const status = m.getStatus();
  console.log(JSON.stringify(status, null, 2));
}

async function cmd_blip(args) {
  const sub = args[0];
  const m = await getMesh();

  if (sub === "generate" || sub === "gen") {
    const blip = m.bootstrap.generateBlip();
    console.log(JSON.stringify(blip, null, 2));
    return;
  }

  if (sub === "validate") {
    const code = args[1];
    const valid = m.bootstrap.validateBlip(code);
    console.log(valid ? "Valid" : "Invalid");
    return;
  }

  console.log("Usage: pcm blip generate|validate <code>");
}

async function cmd_pipeline(args) {
  const sub = args[0];
  if (sub === "list") {
    console.log("Available: medical, weather, satellite, cdc");
    return;
  }

  const m = await getMesh();
  const pipelineName = sub || "medical";
  const input = args.slice(1).join(" ");

  // Initialize pipeline if needed
  if (!m.pipelines.pipelines.has(pipelineName)) {
    if (pipelineName === "medical") m.pipelines.medical();
    else if (pipelineName === "weather") m.pipelines.weather();
    else if (pipelineName === "satellite") m.pipelines.satellite();
    else if (pipelineName === "cdc") m.pipelines.epidemiology();
    else { console.error("Unknown pipeline:", pipelineName); process.exit(1); }
  }

  console.log("Running pipeline:", pipelineName);
  const result = await m.pipelines.run(pipelineName, input);
  console.log(JSON.stringify(result, null, 2));
}

async function cmd_help(args) {
  console.log(`
PCM - Persistent Cognitive Mesh CLI

Usage: pcm <command> [args]

Commands:
  bootstrap [file.md]   Bootstrap from markdown file
  bootstrap generate       Generate a blip code for agent onboarding
  bootstrap admit <json>   Admit new agent via blip
  bootstrap status         Show bootstrap status

  think <text>           Ask the mesh a question

  status                  Show mesh status

  blip generate           Generate blip code
  blip validate <code>    Validate blip code

  pipeline <name> <input>  Run a domain pipeline
  pipeline list           List available pipelines

  help                   Show this help

Environment Variables:
  PCM_AGENTS            Number of agents (default: 10)
  PCM_BLIP_SECRET       Secret for blip authentication
  PCM_BOOTSTRAP_FILE    Default bootstrap file
  PCM_HOT, PCM_WARM, PCM_COLD  Storage paths
`);
}

// === MAIN ===

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || "help";

  if (cmd === "-h" || cmd === "--help") {
    await cmd_help([]);
    return;
  }

  const handler = COMMANDS[cmd];
  if (!handler) {
    console.error("Unknown command:", cmd);
    console.error("Run \"pcm help\" for usage");
    process.exit(1);
  }

  try {
    await handler(args.slice(1));
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }

  // Graceful shutdown
  if (mesh) await mesh.shutdown();
}

main();
