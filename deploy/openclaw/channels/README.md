# OpenClaw Messaging Channels

This directory contains integrations for messaging platforms that provide public access to OpenClaw's Trust Network.

## Supported Channels

- Telegram

## Adding a New Channel

To add a new messaging channel (e.g., Discord, WhatsApp):

1. Create a `<channel-name>.yaml` config file following the pattern in `telegram.yaml`
2. Create a `<channel-name>-handler.js` handler file
3. Implement the `handleMessage(bot, msg)` function
4. Add the channel to the main channel loader

## Telegram Bot Setup

### 1. Create a Telegram Bot

1. Open Telegram and search for @BotFather
2. Send `/newbot` command
3. Follow the prompts to name your bot
4. Copy the bot token (e.g., `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Add Token to .env

Add the token to your environment file:

```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

For webhook mode, also add:

```bash
TELEGRAM_WEBHOOK_SECRET=your_secret_here
```

### 3. Configure the Bot

Edit `telegram.yaml` to set your preferred mode:

```yaml
mode: "webhook"  # or "polling"
```

For webhook mode, set your public URL:

```yaml
webhook:
  url: "https://your-domain.com/webhook"
```

### 4. Test with curl

Verify your bot is working:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getMe"
```

Send a test message:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -d "chat_id=YOUR_CHAT_ID" \
  -d "text=Hello from OpenClaw!"
```

Get your chat ID (send a message to your bot, then):

```bash
curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
```

### 5. Start the Handler

```bash
node deploy/openclaw/channels/telegram-handler.js
```

## Available Commands

Once the bot is running, users can send:

| Command | Description |
|---------|-------------|
| `/ask <question>` | Ask a question to the Trust Network |
| `/status` | Show system health status |
| `/agents` | List available agents |
| `/help` | Show help information |

## Example Conversation

```
User: /help
Bot: *OpenClaw Telegram Bot*

Available commands:
/ask <question> - Ask a question to the Trust Network
/status - Show system health status
/agents - List available agents
/help - Show this help message

User: /ask What is the current ETH gas price?
Bot: 🔄 Processing your query...
Bot: *Answer*

The current ETH gas price is approximately 15-20 Gwei depending on network demand.

Confidence: 95.0%

User: /status
Bot: *System Status*

Gateway: ✅ Connected
Uptime: 2h 15m
Active Agents: 5
```

## Rate Limiting

Default rate limit: 10 requests per user per minute. This prevents abuse while allowing legitimate use. Adjust in `telegram.yaml`:

```yaml
rate_limit:
  max_requests: 10
  window_ms: 60000
```

## Security Notes

- Never commit bot tokens to version control
- Use environment variables for sensitive data
- Set a webhook secret for verification
- Consider enabling bot privacy mode via @BotFather