# Kilo PowerShell Chat - Quick Start

## Connect to AI Chat from PowerShell

### 1. Import the Module
```powershell
Import-Module .\KiloChat.psm1
```

### 2. Connect
```powershell
Connect-KiloChat
# or
Connect-KiloChat -AgentName "dev-kimi" -EnableTTS
```

### 3. Chat Commands

| Command | Description | Example |
|---------|-------------|---------|
| `Send-KiloMessage` | Send message to AI | `Send-KiloMessage "Hello!"` |
| `Get-KiloInbox` | Check replies | `Get-KiloInbox` |
| `Watch-KiloChat` | Real-time mode | `Watch-KiloChat` |
| `Chat-Kilo` | Quick chat | `Chat-Kilo "Help me debug"` |

### 4. Aliases (Shorter)
```powershell
kchat              # Connect
kmsg "Hello!"      # Send message  
kinbox             # Check inbox
kwatch             # Real-time mode
kbye               # Disconnect
```

## Example Session

```powershell
# 1. Load module
PS> Import-Module .\KiloChat.psm1
🚀 Kilo Chat PowerShell Module Loaded
Type 'Connect-KiloChat' to start chatting with AI

# 2. Connect
PS> Connect-KiloChat
🔌 Connected to Kilo AI Chat as: dev-kimi
📬 Mailbox: S:\snac-v2\snac-v2\backend\.agents\mailboxes\dev-kimi

# 3. Send message
PS> Send-KiloMessage "Can you review my code?"
✅ Message sent (msg_123456789_123456)

# 4. Check replies
PS> Get-KiloInbox
📬 You have 3 messages:
[14:32] dev-kimi: I'll review your code. Let me look at...
[14:33] dev-lingma: Hey, need help with the pipeline?

# 5. Real-time mode (auto-announce new messages)
PS> Watch-KiloChat
👀 Watching for messages... (Press Ctrl+C to stop)
[14:35:22] 🔥 NEW from dev-kimi: Code review complete! The...
(Spoken aloud for accessibility)

# 6. Disconnect
PS> kbye
👋 Disconnected from Kilo AI Chat
```

## Auto-Start on PowerShell Launch

Add to your PowerShell profile (`$PROFILE`):
```powershell
# Auto-connect Kilo on startup
Import-Module "S:\snac-v2\snac-v2\backend\KiloChat.psm1"
Connect-KiloChat -AgentName "dev-kimi" -EnableTTS
```

## Accessibility Features

- 🔊 **TTS** - All messages spoken aloud (Windows Speech)
- 🔔 **Real-time alerts** - New messages announced automatically
- ⌨️ **Keyboard shortcuts** - Short aliases for quick typing
- 📢 **High contrast** - Color-coded output

## Troubleshooting

**Module won't import:**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**TTS not working:**
- Windows needs to be installed (not Windows Server Core)
- Check Windows Speech settings

**No messages appearing:**
- Check that DEV_AGENT_ID is set: `$env:DEV_AGENT_ID`
- Verify mailbox path exists
- Check MessageBus is running
