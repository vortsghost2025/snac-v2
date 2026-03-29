/**
 * Agent Chat CLI Handler
 * Processes command-line interactions with the MessageBus
 */

const MessageBus = require('./MessageBus');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Define the command allowlist for agent mode
const AGENT_COMMAND_ALLOWLIST = [
  'direct',
  'broadcast', 
  'group',
  'status',
  'locks',
  'help',
  'run',
  'exec',
  'shell',
  'cmd',
  'execute',
  'read',
  'write',
  'append',
  'delete',
  'ls',
  'mkdir',
  'cp',
  'mv',
  'find',
  'ps',
  'kill',
  'stop',
  'start',
  'restart',
  'info',
  'mem',
  'disk',
  'cpu',
  'network',
  'log',
  'debug',
  'trace',
  'inspect'
];

class AgentChatCLI {
  constructor(agentId) {
    this.agentId = agentId;
    this.mailboxDir = path.join(__dirname, '../../.agents/mailboxes');
    this.dispatchFile = path.join(__dirname, '../../.agents/DISPATCH.md');
    this.locksFile = path.join(__dirname, '../../.agents/LOCKS.json');
    this.changelogFile = path.join(__dirname, '../../.agents/CHANGELOG.md');
  }

  async initialize() {
    await fs.mkdir(this.mailboxDir, { recursive: true });
    await fs.mkdir(path.join(this.mailboxDir, this.agentId), { recursive: true });
  }

  isAllowedCommand(command) {
    return AGENT_COMMAND_ALLOWLIST.includes(command.toLowerCase());
  }

  async processCommand(input) {
    if (!input || typeof input !== 'string') {
      return { success: false, message: 'Invalid input' };
    }

    const parts = input.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    
    if (!this.isAllowedCommand(command)) {
      return { 
        success: false, 
        message: `Command '${command}' not allowed in agent mode. Allowed commands: ${AGENT_COMMAND_ALLOWLIST.join(', ')}` 
      };
    }

    switch (command) {
      case 'direct':
        return await this.sendDirect(parts.slice(1));
      case 'broadcast':
        return await this.sendBroadcast(parts.slice(1));
      case 'group':
        return await this.sendGroup(parts.slice(1));
      case 'status':
        return await this.checkStatus(parts.slice(1));
      case 'locks':
        return await this.listLocks();
      case 'help':
        return await this.showHelp(parts.slice(1));
      case 'run':
      case 'exec':
      case 'shell':
      case 'cmd':
      case 'execute':
        return await this.executeCommand(parts.slice(1));
      case 'read':
        return await this.readFile(parts.slice(1));
      case 'write':
        return await this.writeFile(parts.slice(1));
      case 'append':
        return await this.appendFile(parts.slice(1));
      case 'delete':
        return await this.deleteFile(parts.slice(1));
      case 'ls':
        return await this.listFiles(parts.slice(1));
      case 'mkdir':
        return await this.makeDirectory(parts.slice(1));
      case 'cp':
        return await this.copyFile(parts.slice(1));
      case 'mv':
        return await this.moveFile(parts.slice(1));
      case 'find':
        return await this.findFiles(parts.slice(1));
      case 'ps':
        return await this.listProcesses();
      case 'kill':
        return await this.killProcess(parts.slice(1));
      case 'stop':
        return await this.stopService(parts.slice(1));
      case 'start':
        return await this.startService(parts.slice(1));
      case 'restart':
        return await this.restartService(parts.slice(1));
      case 'info':
        return await this.systemInfo();
      case 'mem':
        return await this.memoryUsage();
      case 'disk':
        return await this.diskUsage();
      case 'cpu':
        return await this.cpuUsage();
      case 'network':
        return await this.networkStatus();
      case 'log':
        return await this.addToLog(parts.slice(1));
      case 'debug':
        return await this.debugComponent(parts.slice(1));
      case 'trace':
        return await this.traceOperation(parts.slice(1));
      case 'inspect':
        return await this.inspectObject(parts.slice(1));
      default:
        return { 
          success: false, 
          message: `Unknown command: ${command}. Use 'help' for available commands.` 
        };
    }
  }

  async sendDirect(args) {
    if (args.length < 2) {
      return { success: false, message: 'Usage: direct <agent> <message>' };
    }

    const [recipient, ...messageParts] = args;
    const message = messageParts.join(' ');

    if (!recipient || !message) {
      return { success: false, message: 'Invalid recipient or message' };
    }

    const validRecipients = await this.getValidAgents();
    if (!validRecipients.includes(recipient)) {
      return { success: false, message: `Invalid recipient: ${recipient}` };
    }

    const envelope = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      from: this.agentId,
      to: recipient,
      type: 'direct',
      message: message,
      timestamp: Date.now(),
      from_cli: true
    };

    await this.deliverMessage(envelope, recipient);
    return { success: true, message: `Message sent to ${recipient}` };
  }

  async checkStatus(args) {
    if (args.length === 0) {
      return { success: false, message: 'Usage: status <agent> or status all' };
    }

    if (args[0] === 'all') {
      const agents = await this.getValidAgents();
      const statuses = [];

      for (const agent of agents) {
        const status = await this.getAgentStatus(agent);
        statuses.push(status);
      }

      return { success: true, message: 'Status for all agents', data: statuses };
    } else {
      const agent = args[0];
      const validRecipients = await this.getValidAgents();

      if (!validRecipients.includes(agent)) {
        return { success: false, message: `Invalid agent: ${agent}` };
      }

      const status = await this.getAgentStatus(agent);
      return { success: true, message: `Status for ${agent}`, data: status };
    }
  }

  async sendBroadcast(args) {
    if (args.length === 0) {
      return { success: false, message: 'Usage: broadcast <message>' };
    }

    const message = args.join(' ');
    const validRecipients = await this.getValidAgents();

    const envelope = {
      id: `${Date.now()}-broadcast-${Math.random().toString(36).substr(2, 5)}`,
      from: this.agentId,
      to: 'all',
      type: 'broadcast',
      message: message,
      timestamp: Date.now(),
      from_cli: true
    };

    for (const recipient of validRecipients) {
      if (recipient !== this.agentId) {
        await this.deliverMessage(envelope, recipient);
      }
    }

    return { success: true, message: 'Broadcast message sent to all agents' };
  }

  async sendGroup(args) {
    if (args.length < 2) {
      return { success: false, message: 'Usage: group <agent1>,<agent2> <message>' };
    }
    const recipients = args[0].split(',');
    const message = args.slice(1).join(' ');
    const validRecipients = await this.getValidAgents();
    for (const r of recipients) {
      if (!validRecipients.includes(r)) {
        return { success: false, message: `Invalid recipient: ${r}` };
      }
    }
    for (const r of recipients) {
      await this.deliverMessage({
        id: `${Date.now()}-group-${Math.random().toString(36).substr(2, 5)}`,
        from: this.agentId, to: r, type: 'group',
        message, timestamp: Date.now(), from_cli: true
      }, r);
    }
    return { success: true, message: `Group message sent to ${recipients.join(', ')}` };
  }

  async listLocks() {
    try {
      const locksData = await fs.readFile(this.locksFile, 'utf8');
      const locks = JSON.parse(locksData);
      
      if (!locks.locks || Object.keys(locks.locks).length === 0) {
        return { success: true, message: 'No active locks' };
      }

      let message = 'Active locks:\n';
      for (const [lockPath, lockInfo] of Object.entries(locks.locks)) {
        message += `- ${lockPath}: owned by ${lockInfo.owner} (since ${new Date(lockInfo.since).toISOString()})\n`;
      }

      return { success: true, message: message };
    } catch (err) {
      return { success: false, message: `Error reading locks: ${err.message}` };
    }
  }

  async showHelp(args) {
    if (args.length === 0) {
      const helpText = `
AI-to-AI Chat Commands:
- direct <agent> <message>     Send a direct message to an agent
- broadcast <message>         Send a message to all agents
- group <agent1>,<agent2> <msg> Send a message to a group of agents
- status <agent>              Check status of an agent
- status all                  Check status of all agents
- locks                       List all active file locks
- help                        Show this help message
- help <command>              Show detailed help for a command

Allowed commands in agent mode: ${AGENT_COMMAND_ALLOWLIST.join(', ')}
      `;
      return { success: true, message: helpText };
    } else {
      const command = args[0].toLowerCase();
      switch (command) {
        case 'direct':
          return { success: true, message: 'Usage: direct <agent> <message>\nSend a direct message to a specific agent.' };
        case 'broadcast':
          return { success: true, message: 'Usage: broadcast <message>\nSend a message to all agents.' };
        case 'group':
          return { success: true, message: "Usage: group <agent1>,<agent2>,... <message>\nSend a message to a group of agents." };
        case 'status':
          return { success: true, message: 'Usage: status <agent> or status all\nCheck the status of an agent or all agents' };
        case 'locks':
          return { success: true, message: 'Usage: locks\nList all active file locks' };
        default:
          return { success: false, message: `No detailed help available for command: ${command}` };
      }
    }
  }

  // Stub implementations for system commands (not yet implemented)
  async executeCommand(args) {
    // SECURITY: Shell execution is disabled until proper sandboxing is implemented
    return { success: false, message: 'Command execution is disabled for security. Implement sandboxed execution before enabling.' };
  }

  async readFile(args) {
    return { success: true, message: `File read not fully implemented yet. Would read: ${args.join(' ')}` };
  }

  async writeFile(args) {
    return { success: true, message: `File write not fully implemented yet. Would write to: ${args.join(' ')}` };
  }

  async appendFile(args) {
    return { success: true, message: `File append not fully implemented yet. Would append to: ${args.join(' ')}` };
  }

  async deleteFile(args) {
    return { success: true, message: `File deletion not fully implemented yet. Would delete: ${args.join(' ')}` };
  }

  async listFiles(args) {
    return { success: true, message: `File listing not fully implemented yet. Would list: ${args.join(' ')}` };
  }

  async makeDirectory(args) {
    return { success: true, message: `Directory creation not fully implemented yet. Would create: ${args.join(' ')}` };
  }

  async copyFile(args) {
    return { success: true, message: `File copying not fully implemented yet. Would copy: ${args.join(' ')}` };
  }

  async moveFile(args) {
    return { success: true, message: `File moving not fully implemented yet. Would move: ${args.join(' ')}` };
  }

  async findFiles(args) {
    return { success: true, message: `File finding not fully implemented yet. Would find: ${args.join(' ')}` };
  }

  async listProcesses() {
    return { success: true, message: 'Process listing not fully implemented yet.' };
  }

  async killProcess(args) {
    return { success: true, message: `Process killing not fully implemented yet. Would kill: ${args.join(' ')}` };
  }

  async stopService(args) {
    return { success: true, message: `Service stopping not fully implemented yet. Would stop: ${args.join(' ')}` };
  }

  async startService(args) {
    return { success: true, message: `Service starting not fully implemented yet. Would start: ${args.join(' ')}` };
  }

  async restartService(args) {
    return { success: true, message: `Service restarting not fully implemented yet. Would restart: ${args.join(' ')}` };
  }

  async systemInfo() {
    return { success: true, message: 'System information not fully implemented yet.' };
  }

  async memoryUsage() {
    return { success: true, message: 'Memory usage not fully implemented yet.' };
  }

  async diskUsage() {
    return { success: true, message: 'Disk usage not fully implemented yet.' };
  }

  async cpuUsage() {
    return { success: true, message: 'CPU usage not fully implemented yet.' };
  }

  async networkStatus() {
    return { success: true, message: 'Network status not fully implemented yet.' };
  }

  async addToLog(args) {
    return { success: true, message: `Adding to log not fully implemented yet. Would log: ${args.join(' ')}` };
  }

  async debugComponent(args) {
    return { success: true, message: `Component debugging not fully implemented yet. Would debug: ${args.join(' ')}` };
  }

  async traceOperation(args) {
    return { success: true, message: `Operation tracing not fully implemented yet. Would trace: ${args.join(' ')}` };
  }

  async inspectObject(args) {
    return { success: true, message: `Object inspection not fully implemented yet. Would inspect: ${args.join(' ')}` };
  }

  async deliverMessage(envelope, recipient) {
    const recipientMailboxDir = path.join(this.mailboxDir, recipient);
    await fs.mkdir(recipientMailboxDir, { recursive: true });

    const filename = path.join(
      recipientMailboxDir, 
      `${envelope.id}.json`
    );

    await fs.writeFile(filename, JSON.stringify(envelope, null, 2));
  }

  async getValidAgents() {
    try {
      const dispatchContent = await fs.readFile(this.dispatchFile, 'utf8');
      const agentMatches = dispatchContent.match(/`([^`]+)`\s+\|/g);
      
      if (!agentMatches) return [];
      
      return agentMatches
        .map(match => match.replace(/`\s*\|\s*$/, '').replace(/`/g, ''))
        .filter(id => id.startsWith('dev-'));
    } catch (err) {
      console.error('Error reading dispatch file:', err);
      return [];
    }
  }

  async getAgentStatus(agentId) {
    try {
      const statusFile = path.join(__dirname, `../../.agents/${agentId}.md`);
      const content = await fs.readFile(statusFile, 'utf8');
      
      const statusMatch = content.match(/## Current Status: (.+)/);
      const status = statusMatch ? statusMatch[1] : 'Unknown';
      
      return {
        agent: agentId,
        status: status,
        lastUpdated: 'Unknown'
      };
    } catch (err)      {
      return {
        agent: agentId,
        status: 'Error reading status',
        lastUpdated: 'Unknown',
        error: err.message
      };
    }
  }
}

// Determine agent ID from environment or default
const agentId = process.env.DEV_AGENT_ID || 'dev-kimi';
const cli = new AgentChatCLI(agentId);

async function main() {
  await cli.initialize();
  
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log('Usage: node agent-chat-cli.js <command> [args...]');
    return;
  }

  if (!cli.isAllowedCommand(command)) {
    console.log(`Command '${command}' not allowed in agent mode.`);
    return;
  }

  const result = await cli.processCommand(args.join(' '));
  
  if (result.success) {
    console.log(result.message);
    if (result.data) {
      console.log(JSON.stringify(result.data, null, 2));
    }
  } else {
    console.log(`Error: ${result.message}`);
  }
}

process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
