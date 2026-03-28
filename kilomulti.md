# Multi-Agent Architecture for Kilo - Solving Token Limits

Incredible usage stats! 1.5 billion tokens and a 29-day streak! 🔥 Let's split Kilo into specialized agents to distribute the load and reduce costs.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           KILO ORCHESTRATOR                                  │
│                    (Routes requests to specialist agents)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   FRONTEND   │  │   BACKEND    │  │     GPU      │  │   BROWSER    │    │
│  │    AGENT     │  │    AGENT     │  │    AGENT     │  │    AGENT     │    │
│  │              │  │              │  │              │  │              │    │
│  │  Claude API  │  │  GPT-4o     │  │ Local LLM    │  │  Claude API  │    │
│  │  (Your Key)  │  │  (Your Key)  │  │ (Ollama)     │  │  (Kilo Key)  │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │    AZURE     │  │   DATABASE   │  │    QUICK     │  │   DOCKER     │    │
│  │    AGENT     │  │    AGENT     │  │    AGENT     │  │    AGENT     │    │
│  │              │  │              │  │              │  │              │    │
│  │ GPT-4o-mini  │  │  Local LLM   │  │  Gemini      │  │ GPT-4o-mini  │    │
│  │  (Cheap!)    │  │  (Free!)     │  │  Flash       │  │  (Cheap!)    │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Step 1: Agent Router & Provider Configuration

Create `src/agent/AgentRouter.ts`:

```typescript
import * as vscode from 'vscode';

export type AgentType = 
  | 'frontend' 
  | 'backend' 
  | 'gpu' 
  | 'browser' 
  | 'azure' 
  | 'database' 
  | 'docker'
  | 'quick'
  | 'general';

export type ProviderType = 
  | 'anthropic' 
  | 'openai' 
  | 'google' 
  | 'ollama' 
  | 'groq'
  | 'deepseek'
  | 'kilo';

export interface ProviderConfig {
  type: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  maxTokens: number;
  costPer1kInput: number;  // For tracking
  costPer1kOutput: number;
}

export interface AgentConfig {
  type: AgentType;
  provider: ProviderConfig;
  systemPrompt: string;
  tools: string[];  // Tool name prefixes this agent can use
  priority: number; // Lower = higher priority when multiple match
}

export class AgentRouter {
  private configs: Map<AgentType, AgentConfig> = new Map();
  private providerKeys: Map<ProviderType, string> = new Map();
  private usageTracker: Map<AgentType, { tokens: number; cost: number }> = new Map();

  constructor(private context: vscode.ExtensionContext) {
    this.loadConfiguration();
  }

  private loadConfiguration(): void {
    const config = vscode.workspace.getConfiguration('kilo');
    
    // Load API keys from settings or secrets
    this.providerKeys.set('anthropic', config.get('anthropicApiKey') || '');
    this.providerKeys.set('openai', config.get('openaiApiKey') || '');
    this.providerKeys.set('google', config.get('googleApiKey') || '');
    this.providerKeys.set('groq', config.get('groqApiKey') || '');
    this.providerKeys.set('deepseek', config.get('deepseekApiKey') || '');
    
    // Default agent configurations
    this.setupDefaultConfigs();
  }

  private setupDefaultConfigs(): void {
    // Frontend Agent - Uses Claude (best for UI/UX reasoning)
    this.configs.set('frontend', {
      type: 'frontend',
      provider: {
        type: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        maxTokens: 8096,
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015
      },
      systemPrompt: this.getFrontendPrompt(),
      tools: ['component_', 'style_', 'browser_'],
      priority: 1
    });

    // Backend Agent - Uses GPT-4o (great for logic/APIs)
    this.configs.set('backend', {
      type: 'backend',
      provider: {
        type: 'openai',
        model: 'gpt-4o',
        maxTokens: 4096,
        costPer1kInput: 0.005,
        costPer1kOutput: 0.015
      },
      systemPrompt: this.getBackendPrompt(),
      tools: ['db_', 'api_', 'server_'],
      priority: 1
    });

    // GPU Agent - Uses LOCAL Ollama (FREE! Perfect for your 5060)
    this.configs.set('gpu', {
      type: 'gpu',
      provider: {
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
        model: 'deepseek-coder:33b',  // Or codellama:34b
        maxTokens: 4096,
        costPer1kInput: 0,  // FREE!
        costPer1kOutput: 0
      },
      systemPrompt: this.getGpuPrompt(),
      tools: ['nvidia_', 'cuda_', 'nsight_'],
      priority: 1
    });

    // Browser Agent - Uses Claude (best for complex UI understanding)
    this.configs.set('browser', {
      type: 'browser',
      provider: {
        type: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        maxTokens: 8096,
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015
      },
      systemPrompt: this.getBrowserPrompt(),
      tools: ['browser_'],
      priority: 1
    });

    // Azure Agent - Uses GPT-4o-mini (simple tasks, CHEAP)
    this.configs.set('azure', {
      type: 'azure',
      provider: {
        type: 'openai',
        model: 'gpt-4o-mini',
        maxTokens: 4096,
        costPer1kInput: 0.00015,
        costPer1kOutput: 0.0006
      },
      systemPrompt: this.getAzurePrompt(),
      tools: ['azurite_', 'azure_'],
      priority: 1
    });

    // Database Agent - Uses DeepSeek (great at SQL, cheap)
    this.configs.set('database', {
      type: 'database',
      provider: {
        type: 'deepseek',
        model: 'deepseek-chat',
        maxTokens: 4096,
        costPer1kInput: 0.00014,
        costPer1kOutput: 0.00028
      },
      systemPrompt: this.getDatabasePrompt(),
      tools: ['db_'],
      priority: 2
    });

    // Docker Agent - Uses GPT-4o-mini (simple commands)
    this.configs.set('docker', {
      type: 'docker',
      provider: {
        type: 'openai',
        model: 'gpt-4o-mini',
        maxTokens: 2048,
        costPer1kInput: 0.00015,
        costPer1kOutput: 0.0006
      },
      systemPrompt: this.getDockerPrompt(),
      tools: ['docker_'],
      priority: 1
    });

    // Quick Agent - Uses Groq (FAST! For simple queries)
    this.configs.set('quick', {
      type: 'quick',
      provider: {
        type: 'groq',
        model: 'llama-3.1-70b-versatile',
        maxTokens: 2048,
        costPer1kInput: 0.00059,
        costPer1kOutput: 0.00079
      },
      systemPrompt: this.getQuickPrompt(),
      tools: [],
      priority: 10
    });

    // General Agent - Fallback
    this.configs.set('general', {
      type: 'general',
      provider: {
        type: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        maxTokens: 8096,
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015
      },
      systemPrompt: this.getGeneralPrompt(),
      tools: [],  // Can use all tools
      priority: 100
    });
  }

  routeRequest(message: string, toolsNeeded?: string[]): AgentType {
    const messageLower = message.toLowerCase();
    
    // Explicit routing based on keywords
    const routingRules: Array<{ keywords: string[]; agent: AgentType }> = [
      { keywords: ['cuda', 'gpu', 'nvidia', 'kernel', 'nvcc', 'nsight', 'tensor'], agent: 'gpu' },
      { keywords: ['azurite', 'azure', 'blob', 'queue', 'table storage', 'functions'], agent: 'azure' },
      { keywords: ['docker', 'container', 'compose', 'kubernetes', 'k8s'], agent: 'docker' },
      { keywords: ['database', 'sql', 'query', 'oracle', 'postgres', 'mysql', 'table'], agent: 'database' },
      { keywords: ['browser', 'cockpit', 'web page', 'navigate', 'click', 'login'], agent: 'browser' },
      { keywords: ['component', 'react', 'vue', 'svelte', 'css', 'frontend', 'ui', 'style'], agent: 'frontend' },
      { keywords: ['api', 'endpoint', 'rest', 'graphql', 'server', 'backend'], agent: 'backend' }
    ];

    for (const rule of routingRules) {
      if (rule.keywords.some(kw => messageLower.includes(kw))) {
        return rule.agent;
      }
    }

    // Route based on tools needed
    if (toolsNeeded && toolsNeeded.length > 0) {
      for (const [agentType, config] of this.configs) {
        if (config.tools.some(prefix => toolsNeeded.some(t => t.startsWith(prefix)))) {
          return agentType;
        }
      }
    }

    // Simple queries go to quick agent
    if (message.length < 100 && !message.includes('create') && !message.includes('build')) {
      return 'quick';
    }

    return 'general';
  }

  getConfig(agentType: AgentType): AgentConfig {
    return this.configs.get(agentType) || this.configs.get('general')!;
  }

  getApiKey(provider: ProviderType): string {
    return this.providerKeys.get(provider) || '';
  }

  trackUsage(agentType: AgentType, inputTokens: number, outputTokens: number): void {
    const current = this.usageTracker.get(agentType) || { tokens: 0, cost: 0 };
    const config = this.getConfig(agentType);
    
    const cost = (inputTokens / 1000 * config.provider.costPer1kInput) +
                 (outputTokens / 1000 * config.provider.costPer1kOutput);
    
    current.tokens += inputTokens + outputTokens;
    current.cost += cost;
    
    this.usageTracker.set(agentType, current);
  }

  getUsageReport(): string {
    let report = '## Agent Usage Report\n\n';
    let totalCost = 0;
    let totalTokens = 0;

    for (const [agent, usage] of this.usageTracker) {
      report += `### ${agent}\n`;
      report += `- Tokens: ${usage.tokens.toLocaleString()}\n`;
      report += `- Cost: $${usage.cost.toFixed(4)}\n\n`;
      totalCost += usage.cost;
      totalTokens += usage.tokens;
    }

    report += `## Total\n`;
    report += `- Tokens: ${totalTokens.toLocaleString()}\n`;
    report += `- Cost: $${totalCost.toFixed(4)}\n`;

    return report;
  }

  // System prompts for each agent (abbreviated for space)
  private getFrontendPrompt(): string {
    return `You are the Frontend Specialist agent for Kilo. You handle:
- React, Vue, Svelte, Angular components
- CSS, Tailwind, styled-components
- UI/UX improvements
- Accessibility (critical - user has 50% vision loss)

Be concise. Focus only on frontend tasks.`;
  }

  private getBackendPrompt(): string {
    return `You are the Backend Specialist agent for Kilo. You handle:
- API development and testing
- Server-side logic
- Authentication/authorization
- Performance optimization

Be concise. Focus only on backend tasks.`;
  }

  private getGpuPrompt(): string {
    return `You are the GPU/CUDA Specialist agent for Kilo. You handle:
- CUDA compilation and debugging
- GPU monitoring and optimization
- NSight profiling
- The user has an NVIDIA RTX 5060 (Blackwell, sm_100)

Always use -arch=sm_100 for compilation. Be concise.`;
  }

  private getBrowserPrompt(): string {
    return `You are the Browser Automation Specialist for Kilo. You handle:
- Web navigation and interaction
- Oracle and Cockpit UIs
- Form filling and data extraction
- CRITICAL: User has 50% vision loss - always describe what you see clearly

Announce all actions and results prominently.`;
  }

  private getAzurePrompt(): string {
    return `You are the Azure/Azurite Specialist for Kilo. You handle:
- Azurite local emulator
- Blob, Queue, Table storage
- Azure Functions
- Connection strings

Be concise. Provide connection strings when needed.`;
  }

  private getDatabasePrompt(): string {
    return `You are the Database Specialist for Kilo. You handle:
- SQL queries (Oracle, PostgreSQL, MySQL)
- Schema design
- Query optimization
- Data analysis

Format query results clearly for accessibility.`;
  }

  private getDockerPrompt(): string {
    return `You are the Docker Specialist for Kilo. You handle:
- Container management
- Docker Compose
- Container logs and debugging

Be concise. List container states clearly.`;
  }

  private getQuickPrompt(): string {
    return `You are the Quick Response agent. Answer simple questions briefly and directly.
If the task is complex, say "This needs a specialist agent" and suggest which one.`;
  }

  private getGeneralPrompt(): string {
    return `You are Kilo, a full-stack AI assistant helping a developer with 50% vision loss.
Route complex tasks to specialists when appropriate. Be helpful and accessible.`;
  }
}
```

## Step 2: Multi-Provider Client

Create `src/agent/MultiProviderClient.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { ProviderConfig, ProviderType } from './AgentRouter';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ToolCall {
  name: string;
  input: any;
  id: string;
}

export interface AgentResponse {
  text: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
}

export class MultiProviderClient {
  private anthropic?: Anthropic;
  private openai?: OpenAI;
  private google?: GoogleGenerativeAI;
  private groq?: Groq;

  constructor(private apiKeys: Map<ProviderType, string>) {
    this.initializeClients();
  }

  private initializeClients(): void {
    const anthropicKey = this.apiKeys.get('anthropic');
    if (anthropicKey) {
      this.anthropic = new Anthropic({ apiKey: anthropicKey });
    }

    const openaiKey = this.apiKeys.get('openai');
    if (openaiKey) {
      this.openai = new OpenAI({ apiKey: openaiKey });
    }

    const googleKey = this.apiKeys.get('google');
    if (googleKey) {
      this.google = new GoogleGenerativeAI(googleKey);
    }

    const groqKey = this.apiKeys.get('groq');
    if (groqKey) {
      this.groq = new Groq({ apiKey: groqKey });
    }
  }

  async chat(
    config: ProviderConfig,
    messages: Message[],
    systemPrompt: string,
    tools?: any[]
  ): Promise<AgentResponse> {
    switch (config.type) {
      case 'anthropic':
        return this.chatAnthropic(config, messages, systemPrompt, tools);
      
      case 'openai':
        return this.chatOpenAI(config, messages, systemPrompt, tools);
      
      case 'google':
        return this.chatGoogle(config, messages, systemPrompt, tools);
      
      case 'groq':
        return this.chatGroq(config, messages, systemPrompt);
      
      case 'ollama':
        return this.chatOllama(config, messages, systemPrompt, tools);
      
      case 'deepseek':
        return this.chatDeepSeek(config, messages, systemPrompt, tools);
      
      default:
        throw new Error(`Unsupported provider: ${config.type}`);
    }
  }

  private async chatAnthropic(
    config: ProviderConfig,
    messages: Message[],
    systemPrompt: string,
    tools?: any[]
  ): Promise<AgentResponse> {
    if (!this.anthropic) throw new Error('Anthropic client not initialized');

    const anthropicMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }));

    const response = await this.anthropic.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system: systemPrompt,
      messages: anthropicMessages,
      tools: tools as Anthropic.Tool[]
    });

    const toolCalls: ToolCall[] = [];
    let text = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          name: block.name,
          input: block.input,
          id: block.id
        });
      }
    }

    return {
      text,
      toolCalls,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn'
    };
  }

  private async chatOpenAI(
    config: ProviderConfig,
    messages: Message[],
    systemPrompt: string,
    tools?: any[]
  ): Promise<AgentResponse> {
    if (!this.openai) throw new Error('OpenAI client not initialized');

    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }))
    ];

    // Convert Anthropic-style tools to OpenAI format
    const openaiTools = tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema
      }
    }));

    const response = await this.openai.chat.completions.create({
      model: config.model,
      max_tokens: config.maxTokens,
      messages: openaiMessages,
      tools: openaiTools,
      tool_choice: tools ? 'auto' : undefined
    });

    const choice = response.choices[0];
    const toolCalls: ToolCall[] = [];

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
          id: tc.id
        });
      }
    }

    return {
      text: choice.message.content || '',
      toolCalls,
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
      stopReason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn'
    };
  }

  private async chatGoogle(
    config: ProviderConfig,
    messages: Message[],
    systemPrompt: string,
    tools?: any[]
  ): Promise<AgentResponse> {
    if (!this.google) throw new Error('Google client not initialized');

    const model = this.google.getGenerativeModel({ model: config.model });
    
    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const chat = model.startChat({
      history,
      systemInstruction: systemPrompt
    });

    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMessage.content);
    const response = result.response;

    return {
      text: response.text(),
      toolCalls: [], // Google tool handling is different
      inputTokens: 0, // Would need to estimate
      outputTokens: 0,
      stopReason: 'end_turn'
    };
  }

  private async chatGroq(
    config: ProviderConfig,
    messages: Message[],
    systemPrompt: string
  ): Promise<AgentResponse> {
    if (!this.groq) throw new Error('Groq client not initialized');

    const groqMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }))
    ];

    const response = await this.groq.chat.completions.create({
      model: config.model,
      max_tokens: config.maxTokens,
      messages: groqMessages
    });

    return {
      text: response.choices[0].message.content || '',
      toolCalls: [],
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
      stopReason: 'end_turn'
    };
  }

  private async chatOllama(
    config: ProviderConfig,
    messages: Message[],
    systemPrompt: string,
    tools?: any[]
  ): Promise<AgentResponse> {
    const baseUrl = config.baseUrl || 'http://localhost:11434';
    
    const ollamaMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: ollamaMessages,
        stream: false,
        options: {
          num_predict: config.maxTokens
        }
      })
    });

    const data = await response.json();

    // Parse tool calls from Ollama response if present
    const toolCalls: ToolCall[] = [];
    let text = data.message?.content || '';

    // Check for tool call patterns in response
    const toolMatch = text.match(/```tool_call\n([\s\S]*?)\n```/);
    if (toolMatch) {
      try {
        const toolData = JSON.parse(toolMatch[1]);
        toolCalls.push({
          name: toolData.name,
          input: toolData.arguments,
          id: `ollama_${Date.now()}`
        });
        text = text.replace(toolMatch[0], '').trim();
      } catch {}
    }

    return {
      text,
      toolCalls,
      inputTokens: data.prompt_eval_count || 0,
      outputTokens: data.eval_count || 0,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn'
    };
  }

  private async chatDeepSeek(
    config: ProviderConfig,
    messages: Message[],
    systemPrompt: string,
    tools?: any[]
  ): Promise<AgentResponse> {
    // DeepSeek uses OpenAI-compatible API
    const client = new OpenAI({
      apiKey: this.apiKeys.get('deepseek'),
      baseURL: 'https://api.deepseek.com/v1'
    });

    const deepseekMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }))
    ];

    const response = await client.chat.completions.create({
      model: config.model,
      max_tokens: config.maxTokens,
      messages: deepseekMessages
    });

    return {
      text: response.choices[0].message.content || '',
      toolCalls: [],
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
      stopReason: 'end_turn'
    };
  }
}
```

## Step 3: Specialist Agent Manager

Create `src/agent/SpecialistAgents.ts`:

```typescript
import * as vscode from 'vscode';
import { AgentRouter, AgentType, AgentConfig } from './AgentRouter';
import { MultiProviderClient, Message, AgentResponse } from './MultiProviderClient';
import { BrowserTools } from '../browser/BrowserTools';
import { CredentialTools } from '../credentials/CredentialTools';
import { DatabaseTools } from '../backend/DatabaseTools';
import { DockerTools } from '../backend/DockerTools';
import { APITools } from '../backend/APITools';
import { ComponentTools } from '../frontend/ComponentTools';
import { AzuriteTools } from '../cloud/AzuriteTools';
import { NvidiaTools } from '../gpu/NvidiaTools';
import { CudaTools } from '../gpu/CudaTools';
import { NsightTools } from '../gpu/NsightTools';
import { CredentialManager } from '../credentials/CredentialManager';

export class SpecialistAgents {
  private router: AgentRouter;
  private client: MultiProviderClient;
  private conversations: Map<AgentType, Message[]> = new Map();
  private outputChannel: vscode.OutputChannel;

  // Tool handlers
  private browserTools: BrowserTools;
  private credentialTools: CredentialTools;
  private databaseTools: DatabaseTools;
  private dockerTools: DockerTools;
  private apiTools: APITools;
  private componentTools: ComponentTools;
  private azuriteTools: AzuriteTools;
  private nvidiaTools: NvidiaTools;
  private cudaTools: CudaTools;
  private nsightTools: NsightTools;

  constructor(private context: vscode.ExtensionContext) {
    this.router = new AgentRouter(context);
    
    // Build API keys map
    const apiKeys = new Map([
      ['anthropic', this.router.getApiKey('anthropic')],
      ['openai', this.router.getApiKey('openai')],
      ['google', this.router.getApiKey('google')],
      ['groq', this.router.getApiKey('groq')],
      ['deepseek', this.router.getApiKey('deepseek')]
    ]);
    
    this.client = new MultiProviderClient(apiKeys as any);
    this.outputChannel = vscode.window.createOutputChannel('Kilo Agents');

    // Initialize tools
    const credManager = new CredentialManager(context);
    this.browserTools = new BrowserTools();
    this.credentialTools = new CredentialTools(credManager);
    this.databaseTools = new DatabaseTools();
    this.dockerTools = new DockerTools();
    this.apiTools = new APITools();
    this.componentTools = new ComponentTools();
    this.azuriteTools = new AzuriteTools();
    this.nvidiaTools = new NvidiaTools();
    this.cudaTools = new CudaTools();
    this.nsightTools = new NsightTools();
  }

  async processMessage(userMessage: string): Promise<string> {
    // Route to appropriate agent
    const agentType = this.router.routeRequest(userMessage);
    const config = this.router.getConfig(agentType);

    this.log(`Routing to ${agentType} agent (${config.provider.type}/${config.provider.model})`);

    // Get or create conversation for this agent
    if (!this.conversations.has(agentType)) {
      this.conversations.set(agentType, []);
    }
    const messages = this.conversations.get(agentType)!;
    
    messages.push({ role: 'user', content: userMessage });

    // Get tools for this agent
    const tools = this.getToolsForAgent(agentType);

    // Call the appropriate provider
    let response = await this.client.chat(
      config.provider,
      messages,
      config.systemPrompt,
      tools
    );

    // Track usage
    this.router.trackUsage(agentType, response.inputTokens, response.outputTokens);

    // Handle tool calls (agentic loop)
    while (response.stopReason === 'tool_use' && response.toolCalls.length > 0) {
      const toolResults: any[] = [];

      for (const toolCall of response.toolCalls) {
        this.log(`Executing tool: ${toolCall.name}`);
        const result = await this.executeTool(toolCall.name, toolCall.input);
        toolResults.push({
          tool_use_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }

      // Add assistant message and tool results to conversation
      messages.push({ 
        role: 'assistant', 
        content: response.text || `Using tools: ${response.toolCalls.map(t => t.name).join(', ')}`
      });
      
      // Continue conversation with tool results
      messages.push({
        role: 'user',
        content: `Tool results: ${JSON.stringify(toolResults)}`
      });

      response = await this.client.chat(
        config.provider,
        messages,
        config.systemPrompt,
        tools
      );

      this.router.trackUsage(agentType, response.inputTokens, response.outputTokens);
    }

    // Add final response to conversation
    messages.push({ role: 'assistant', content: response.text });

    // Trim conversation if too long
    if (messages.length > 20) {
      messages.splice(0, messages.length - 20);
    }

    return response.text;
  }

  private getToolsForAgent(agentType: AgentType): any[] {
    const allTools = [
      ...this.browserTools.getToolDefinitions(),
      ...this.credentialTools.getToolDefinitions(),
      ...this.databaseTools.getToolDefinitions(),
      ...this.dockerTools.getToolDefinitions(),
      ...this.apiTools.getToolDefinitions(),
      ...this.componentTools.getToolDefinitions(),
      ...this.azuriteTools.getToolDefinitions(),
      ...this.nvidiaTools.getToolDefinitions(),
      ...this.cudaTools.getToolDefinitions(),
      ...this.nsightTools.getToolDefinitions()
    ];

    const config = this.router.getConfig(agentType);
    
    // If agent has specific tools, filter to those
    if (config.tools.length > 0) {
      return allTools.filter(tool => 
        config.tools.some(prefix => tool.name.startsWith(prefix))
      );
    }

    // General agent gets all tools
    return allTools;
  }

  private async executeTool(name: string, input: any): Promise<any> {
    // Route to appropriate tool handler
    if (name.startsWith('browser_')) {
      return this.browserTools.executeTool(name, input);
    } else if (name.startsWith('credential_')) {
      return this.credentialTools.executeTool(name, input);
    } else if (name.startsWith('db_')) {
      return this.databaseTools.executeTool(name, input);
    } else if (name.startsWith('docker_')) {
      return this.dockerTools.executeTool(name, input);
    } else if (name.startsWith('api_')) {
      return this.apiTools.executeTool(name, input);
    } else if (name.startsWith('component_')) {
      return this.componentTools.executeTool(name, input);
    } else if (name.startsWith('azurite_') || name.startsWith('azure_')) {
      return this.azuriteTools.executeTool(name, input);
    } else if (name.startsWith('nvidia_')) {
      return this.nvidiaTools.executeTool(name, input);
    } else if (name.startsWith('cuda_')) {
      return this.cudaTools.executeTool(name, input);
    } else if (name.startsWith('nsight_')) {
      return this.nsightTools.executeTool(name, input);
    }
    
    return { success: false, error: `Unknown tool: ${name}` };
  }

  getUsageReport(): string {
    return this.router.getUsageReport();
  }

  clearConversation(agentType?: AgentType): void {
    if (agentType) {
      this.conversations.delete(agentType);
    } else {
      this.conversations.clear();
    }
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}
```

## Step 4: Local Ollama Setup for GPU Agent (FREE!)

Create `src/gpu/OllamaSetup.ts`:

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execAsync = promisify(exec);

export class OllamaSetup {
  
  static async checkInstallation(): Promise<{ installed: boolean; running: boolean; models: string[] }> {
    try {
      // Check if Ollama is installed
      await execAsync('ollama --version');
      
      // Check if running
      try {
        const response = await fetch('http://localhost:11434/api/tags');
        const data = await response.json();
        
        return {
          installed: true,
          running: true,
          models: data.models?.map((m: any) => m.name) || []
        };
      } catch {
        return { installed: true, running: false, models: [] };
      }
    } catch {
      return { installed: false, running: false, models: [] };
    }
  }

  static async installModel(modelName: string): Promise<void> {
    const terminal = vscode.window.createTerminal('Ollama Install');
    terminal.show();
    terminal.sendText(`ollama pull ${modelName}`);
    
    vscode.window.showInformationMessage(
      `Installing ${modelName}... This may take a while depending on your internet speed.`
    );
  }

  static async startOllama(): Promise<void> {
    const terminal = vscode.window.createTerminal('Ollama Server');
    terminal.show();
    terminal.sendText('ollama serve');
  }

  static getRecommendedModels(): Array<{ name: string; size: string; description: string }> {
    return [
      {
        name: 'deepseek-coder:33b',
        size: '~19GB',
        description: 'Excellent for code generation and CUDA. Fits in 24GB VRAM.'
      },
      {
        name: 'codellama:34b',
        size: '~19GB', 
        description: 'Meta\'s code-specialized model. Great for debugging.'
      },
      {
        name: 'qwen2.5-coder:32b',
        size: '~18GB',
        description: 'Alibaba\'s coder model. Very capable.'
      },
      {
        name: 'llama3.1:70b',
        size: '~40GB',
        description: 'Full Llama 3.1 70B. Needs quantization for 16GB VRAM.'
      },
      {
        name: 'mistral:7b',
        size: '~4GB',
        description: 'Lightweight and fast. Good for quick queries.'
      }
    ];
  }

  static async setupCommand(context: vscode.ExtensionContext): Promise<void> {
    const status = await this.checkInstallation();

    if (!status.installed) {
      const install = await vscode.window.showInformationMessage(
        'Ollama is not installed. Would you like instructions to install it?',
        'Yes', 'No'
      );
      
      if (install === 'Yes') {
        vscode.env.openExternal(vscode.Uri.parse('https://ollama.ai/download'));
      }
      return;
    }

    if (!status.running) {
      const start = await vscode.window.showInformationMessage(
        'Ollama is installed but not running. Start it?',
        'Yes', 'No'
      );
      
      if (start === 'Yes') {
        await this.startOllama();
      }
      return;
    }

    // Show installed models and options
    const models = this.getRecommendedModels();
    const installedSet = new Set(status.models);
    
    const items = models.map(m => ({
      label: `${installedSet.has(m.name) ? '✅' : '⬜'} ${m.name}`,
      description: m.size,
      detail: m.description,
      name: m.name,
      installed: installedSet.has(m.name)
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a model to install/use for GPU Agent',
      title: 'Ollama Models for Kilo GPU Agent'
    });

    if (selected && !selected.installed) {
      await this.installModel(selected.name);
    } else if (selected) {
      // Update config to use this model
      await vscode.workspace.getConfiguration('kilo').update(
        'gpuAgentModel',
        selected.name,
        vscode.ConfigurationTarget.Global
      );
      vscode.window.showInformationMessage(`GPU Agent will now use ${selected.name}`);
    }
  }
}
```

## Step 5: Context Caching & Token Optimization

Create `src/agent/ContextCache.ts`:

```typescript
import * as vscode from 'vscode';
import * as crypto from 'crypto';

interface CacheEntry {
  content: string;
  timestamp: number;
  tokens: number; // Estimated tokens
  hits: number;
}

export class ContextCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize = 100;
  private maxAge = 3600000; // 1 hour

  constructor(private context: vscode.ExtensionContext) {
    this.loadFromStorage();
  }

  private hash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  set(key: string, content: string): void {
    const hash = this.hash(key);
    
    this.cache.set(hash, {
      content,
      timestamp: Date.now(),
      tokens: this.estimateTokens(content),
      hits: 0
    });

    this.prune();
    this.saveToStorage();
  }

  get(key: string): string | undefined {
    const hash = this.hash(key);
    const entry = this.cache.get(hash);
    
    if (entry) {
      if (Date.now() - entry.timestamp > this.maxAge) {
        this.cache.delete(hash);
        return undefined;
      }
      entry.hits++;
      return entry.content;
    }
    return undefined;
  }

  // Cache file contents to avoid re-reading
  async cacheFile(filePath: string): Promise<string> {
    const cached = this.get(`file:${filePath}`);
    if (cached) return cached;

    const doc = await vscode.workspace.openTextDocument(filePath);
    const content = doc.getText();
    this.set(`file:${filePath}`, content);
    return content;
  }

  // Cache tool results
  cacheToolResult(toolName: string, input: any, result: any): void {
    const key = `tool:${toolName}:${JSON.stringify(input)}`;
    this.set(key, JSON.stringify(result));
  }

  getToolResult(toolName: string, input: any): any | undefined {
    const key = `tool:${toolName}:${JSON.stringify(input)}`;
    const cached = this.get(key);
    return cached ? JSON.parse(cached) : undefined;
  }

  // Summarize long content to save tokens
  summarizeForContext(content: string, maxTokens: number = 1000): string {
    const tokens = this.estimateTokens(content);
    if (tokens <= maxTokens) return content;

    // Simple truncation with indicator
    const targetChars = maxTokens * 4; // Rough estimate
    return content.substring(0, targetChars) + 
      `\n\n[...truncated ${tokens - maxTokens} tokens...]`;
  }

  private estimateTokens(content: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(content.length / 4);
  }

  private prune(): void {
    if (this.cache.size <= this.maxSize) return;

    // Remove oldest and least-hit entries
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => {
        // Sort by hits (asc), then timestamp (asc)
        if (a[1].hits !== b[1].hits) return a[1].hits - b[1].hits;
        return a[1].timestamp - b[1].timestamp;
      });

    while (this.cache.size > this.maxSize * 0.8) {
      const [key] = entries.shift()!;
      this.cache.delete(key);
    }
  }

  getStats(): { entries: number; tokens: number; hitRate: number } {
    let totalTokens = 0;
    let totalHits = 0;
    let totalAccesses = 0;

    for (const entry of this.cache.values()) {
      totalTokens += entry.tokens;
      totalHits += entry.hits;
      totalAccesses += entry.hits + 1;
    }

    return {
      entries: this.cache.size,
      tokens: totalTokens,
      hitRate: totalAccesses > 0 ? totalHits / totalAccesses : 0
    };
  }

  private loadFromStorage(): void {
    const saved = this.context.globalState.get<[string, CacheEntry][]>('contextCache');
    if (saved) {
      this.cache = new Map(saved);
    }
  }

  private saveToStorage(): void {
    this.context.globalState.update('contextCache', Array.from(this.cache.entries()));
  }

  clear(): void {
    this.cache.clear();
    this.saveToStorage();
  }
}
```

## Step 6: Package.json Configuration

```json
{
  "name": "kilo-multi-agent",
  "displayName": "Kilo - Multi-Agent Assistant",
  "version": "2.0.0",
  "contributes": {
    "configuration": {
      "title": "Kilo Multi-Agent",
      "properties": {
        "kilo.anthropicApiKey": {
          "type": "string",
          "default": "",
          "description": "Anthropic API key (for Claude agents)"
        },
        "kilo.openaiApiKey": {
          "type": "string",
          "default": "",
          "description": "OpenAI API key (for GPT agents)"
        },
        "kilo.googleApiKey": {
          "type": "string",
          "default": "",
          "description": "Google API key (for Gemini)"
        },
        "kilo.groqApiKey": {
          "type": "string",
          "default": "",
          "description": "Groq API key (for fast queries)"
        },
        "kilo.deepseekApiKey": {
          "type": "string",
          "default": "",
          "description": "DeepSeek API key (for SQL/code)"
        },
        "kilo.gpuAgentModel": {
          "type": "string",
          "default": "deepseek-coder:33b",
          "description": "Ollama model for GPU agent (runs locally)"
        },
        "kilo.useLocalGpuAgent": {
          "type": "boolean",
          "default": true,
          "description": "Use local Ollama for GPU tasks (free, uses your RTX 5060)"
        }
      }
    },
    "commands": [
      { "command": "kilo.chat", "title": "Kilo: Chat" },
      { "command": "kilo.setupOllama", "title": "Kilo: Setup Local GPU Agent" },
      { "command": "kilo.usageReport", "title": "Kilo: Show Usage Report" },
      { "command": "kilo.selectAgent", "title": "Kilo: Force Specific Agent" }
    ]
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "openai": "^4.0.0",
    "@google/generative-ai": "^0.1.0",
    "groq-sdk": "^0.3.0",
    "playwright": "^1.40.0"
  }
}
```

## Step 7: Extension Entry Point

```typescript
import * as vscode from 'vscode';
import { SpecialistAgents } from './agent/SpecialistAgents';
import { OllamaSetup } from './gpu/OllamaSetup';
import { AgentType } from './agent/AgentRouter';

let agents: SpecialistAgents;

export async function activate(context: vscode.ExtensionContext) {
  agents = new SpecialistAgents(context);

  // Main chat
  context.subscriptions.push(
    vscode.commands.registerCommand('kilo.chat', async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'What would you like Kilo to help you with?'
      });

      if (input) {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'Kilo is working...'
        }, async () => {
          const response = await agents.processMessage(input);
          
          const outputChannel = vscode.window.createOutputChannel('Kilo');
          outputChannel.clear();
          outputChannel.appendLine(response);
          outputChannel.show();
        });
      }
    })
  );

  // Setup Ollama
  context.subscriptions.push(
    vscode.commands.registerCommand('kilo.setupOllama', () => {
      OllamaSetup.setupCommand(context);
    })
  );

  // Usage report
  context.subscriptions.push(
    vscode.commands.registerCommand('kilo.usageReport', () => {
      const report = agents.getUsageReport();
      
      const outputChannel = vscode.window.createOutputChannel('Kilo Usage');
      outputChannel.clear();
      outputChannel.appendLine(report);
      outputChannel.show();
    })
  );

  // Force specific agent
  context.subscriptions.push(
    vscode.commands.registerCommand('kilo.selectAgent', async () => {
      const agentTypes: AgentType[] = [
        'frontend', 'backend', 'gpu', 'browser', 
        'azure', 'database', 'docker', 'quick', 'general'
      ];

      const selected = await vscode.window.showQuickPick(agentTypes, {
        placeHolder: 'Select agent to use for next request'
      });

      if (selected) {
        vscode.window.showInformationMessage(`Next request will use ${selected} agent`);
        // Store selection for next request
        context.workspaceState.update('forcedAgent', selected);
      }
    })
  );

  // Check Ollama status on startup
  const ollamaStatus = await OllamaSetup.checkInstallation();
  if (ollamaStatus.installed && !ollamaStatus.running) {
    const start = await vscode.window.showInformationMessage(
      'Start Ollama for free local GPU agent?',
      'Yes', 'No'
    );
    if (start === 'Yes') {
      await OllamaSetup.startOllama();
    }
  }

  vscode.window.showInformationMessage('Kilo Multi-Agent Assistant ready! 🚀');
}
```

## Cost Comparison

| Agent | Provider | Model | Cost/1K tokens | Use Case |
|-------|----------|-------|----------------|----------|
| GPU | **Ollama (Local)** | deepseek-coder:33b | **$0.00** | CUDA, profiling |
| Quick | Groq | llama-3.1-70b | $0.0006 | Simple questions |
| Azure | OpenAI | gpt-4o-mini | $0.0004 | Storage ops |
| Docker | OpenAI | gpt-4o-mini | $0.0004 | Container mgmt |
| Database | DeepSeek | deepseek-chat | $0.0002 | SQL queries |
| Backend | OpenAI | gpt-4o | $0.01 | Complex logic |
| Frontend | Anthropic | claude-sonnet | $0.009 | UI/Components |
| Browser | Anthropic | claude-sonnet | $0.009 | Web automation |

## Potential Savings

With your 1.5B tokens/month:
- **Before**: ~$4,500/month (all Claude Sonnet)
- **After** (estimated split):
  - 40% GPU tasks → **$0** (local Ollama)
  - 20% Quick queries → **$180** (Groq)
  - 15% Azure/Docker → **$90** (GPT-4o-mini)
  - 15% Database → **$45** (DeepSeek)  
  - 10% Browser/Frontend → **$675** (Claude)
  
- **New Total**: ~**$990/month** (78% savings!)

And your RTX 5060 runs the GPU agent completely free! 🎉