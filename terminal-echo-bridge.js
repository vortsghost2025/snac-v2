/**
 * Terminal Echo Bridge - Accessibility Helper
 * Captures terminal output and speaks it for vision-impaired users
 */

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const os = require('os');

const CONFIG = {
  port: 7777,
  speakCommand: os.platform() === 'win32' 
    ? (text) => `powershell -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${text.replace(/'/g, "''")}')"`
    : os.platform() === 'darwin'
    ? (text) => `say "${text.replace(/"/g, '\\"')}"`
    : (text) => `espeak "${text.replace(/"/g, '\\"')}" 2>/dev/null || echo "${text}"`,
  maxHistory: 1000,
  truncateLength: 150
};

class TerminalEchoBridge {
  constructor() {
    this.sessions = new Map();
    this.history = [];
    this.speaking = false;
    this.speechQueue = [];
    this.server = null;
  }

  async start() {
    console.log('🔊 Terminal Echo Bridge starting...');
    this.speak('Terminal Echo Bridge started');
    
    this.server = net.createServer((socket) => {
      this.handleConnection(socket);
    });

    this.server.listen(CONFIG.port, () => {
      const msg = `Terminal Echo Bridge listening on port ${CONFIG.port}`;
      console.log(msg);
      this.speak(msg);
    });
  }

  handleConnection(socket) {
    const sessionId = `session_${Date.now()}`;
    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      lines.forEach(line => {
        if (line.trim()) {
          this.processLine(line.trim(), sessionId);
        }
      });
    });
  }

  processLine(line, sessionId) {
    this.speak(line);
    console.log(`[${sessionId}] ${line}`);
  }

  speak(text) {
    const speakText = text.length > CONFIG.truncateLength 
      ? text.substring(0, CONFIG.truncateLength) + ', truncated' 
      : text;

    this.speechQueue.push(speakText);
    if (!this.speaking) {
      this.processSpeechQueue();
    }
  }

  async processSpeechQueue() {
    this.speaking = true;
    while (this.speechQueue.length > 0) {
      const text = this.speechQueue.shift();
      const cmd = CONFIG.speakCommand(text);
      try {
        const proc = spawn(cmd, { shell: true, stdio: 'pipe' });
        await new Promise((resolve) => {
          proc.on('close', resolve);
          setTimeout(resolve, 5000);
        });
      } catch (err) {}
      await new Promise(r => setTimeout(r, 100));
    }
    this.speaking = false;
  }
}

const bridge = new TerminalEchoBridge();
bridge.start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  bridge.speak('Terminal Echo Bridge stopped');
  process.exit(0);
});
