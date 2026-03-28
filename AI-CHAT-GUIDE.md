# AI-to-AI Chat Guide

Welcome to the Inter-Agent Communication System! This guide explains how to use the message bus for AI-to-AI communication.

## Overview

The system uses a file-based mailbox approach where each agent has its own mailbox in `.agents/mailboxes/<agent-id>/`. Messages are stored as JSON files and can be sent directly, broadcast, or sent to groups.

## Command Structure
The chat system supports the following commands:

### Direct Messaging
- `direct <agent> <message>` - Send a direct message to a specific agent
- Example: `direct dev-lingma Please review the security implementation`

### Broadcast Messaging
- `broadcast <message>` - Send a message to all agents
- Example: `broadcast Starting security audit`

### Group Messaging
- `group <agent1>,<agent2>,... <message>` - Send a message to a group of agents
- Example: `group dev-lingma,dev-copilot Let's coordinate on the GPU implementation`

### Agent Status
- `status <agent>` - Check the status of a specific agent
- `status all` - Check the status of all agents

### File Locking
- `lock <file_path>` - Request a file lock
- `unlock <file_path>` - Release a file lock
- `locks` - List all active locks

### Help
- `help` - Show this help message
- `help <command>` - Show detailed help for a specific command`

## Agent Command Allowlist
The following commands are allowed to be executed automatically in agent mode (YOLO MODE):

```
direct,broadcast,group,status,locks,help,run,exec,shell,cmd,execute,read,write,append,delete,ls,mkdir,cp,mv,find,ps,kill,stop,start,restart,info,mem,disk,cpu,network,log,debug,trace,inspect
```

All commands are allowed in YOLO mode - use with caution!

## Command Line Interface

### Send Direct Message
```bash
# Set your agent ID
$env:DEV_AGENT_ID="dev-kimi"  # PowerShell
# or
export DEV_AGENT_ID="dev-kimi"  # bash

# Send a message to another agent
agent-chat send dev-lingma "Can you help with the memory pipeline?"
```

### Check Your Inbox
```bash
agent-chat inbox
```

### Broadcast to All Agents
```bash
agent-chat broadcast "Team meeting at 3 PM"
```

### Count Unread Messages
```bash
agent-chat count
```

## Programmatic Interface

### Initialize MessageBus
```javascript
const MessageBus = require('./src/agents/MessageBus');

const agentId = process.env.DEV_AGENT_ID || 'dev-kimi';
const messageBus = new MessageBus(agentId);
await messageBus.initialize();
```

### Send Direct Message
```javascript
const result = await messageBus.send(
  'dev-lingma', 
  'Can you help with the memory pipeline?',
  { priority: 'high', source: 'dev-kimi' }
);
```

### Broadcast Message
```javascript
const result = await messageBus.broadcast(
  'Team meeting at 3 PM',
  { urgency: 'normal', organizer: 'dev-kimi' }
);
```

### Send Group Message
```javascript
const result = await messageBus.sendToGroup(
  ['dev-lingma', 'dev-copilot'], 
  'Need help with shared types',
  { priority: 'medium' }
);
```

### Read Inbox
```javascript
const messages = await messageBus.getInbox();
console.log(`You have ${messages.length} messages`);
```

### Mark Message as Read
```javascript
await messageBus.markAsRead('message-id-123');
```

## Integration with Coordination Layer

The chat system works alongside the coordination layer:

1. **Check `.agents/DISPATCH.md`** to see which agent owns which files
2. **Check `.agents/LOCKS.json`** to see which files are currently being edited
3. **Use the chat system** to communicate and coordinate with other agents
4. **Update your status file** `.agents/<your-agent-id>.md` when starting/ending tasks
5. **Log changes** in `.agents/CHANGELOG.md`

## Example Workflow

1. Check if someone else is working on the same area:
   ```bash
   cat .agents/LOCKS.json
   ```

2. Send a message to coordinate:
   ```bash
   agent-chat send dev-lingma "I'm planning to update the pipeline logic, are you working on that?"
   ```

3. Wait for response or check inbox:
   ```bash
   agent-chat inbox
   ```

4. After getting permission/approval, proceed with changes

5. Update your status file and log the change

## Troubleshooting

- **Permission errors**: Make sure your agent ID is set in the environment
- **Messages not appearing**: Check that both agents have initialized their mailboxes
- **Cannot send to agent**: Verify the recipient agent exists in the coordination layer
- **Commands not working**: On Windows, use PowerShell instead of Command Prompt

## Security Notes

- All messages are stored locally in the `.agents` directory
- No external communication occurs
- Agent IDs are validated against the coordination layer
- Sensitive information should not be transmitted via this system