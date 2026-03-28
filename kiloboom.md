# Kilo: Full-Stack Specialist with Credential Management

Let's upgrade Kilo to be your complete full-stack assistant with secure credential storage!

## Project Structure

```
kilo-extension/
├── src/
│   ├── extension.ts
│   ├── agent/
│   │   ├── KiloAgent.ts
│   │   ├── SystemPrompts.ts
│   │   └── Skills.ts
│   ├── browser/
│   │   ├── BrowserController.ts
│   │   ├── BrowserTools.ts
│   │   └── SiteAdapters/
│   │       ├── OracleAdapter.ts
│   │       ├── CockpitAdapter.ts
│   │       └── BaseAdapter.ts
│   ├── backend/
│   │   ├── DatabaseTools.ts
│   │   ├── APITools.ts
│   │   ├── ServerTools.ts
│   │   └── DockerTools.ts
│   ├── frontend/
│   │   ├── ComponentTools.ts
│   │   ├── StyleTools.ts
│   │   └── FrameworkTools.ts
│   ├── credentials/
│   │   ├── CredentialManager.ts
│   │   └── EncryptionService.ts
│   └── tools/
│       ├── filesystem.ts
│       └── terminal.ts
├── package.json
└── README.md
```

## Step 1: Secure Credential Manager

Create `src/credentials/EncryptionService.ts`:

```typescript
import * as crypto from 'crypto';
import * as vscode from 'vscode';

export class EncryptionService {
  private algorithm = 'aes-256-gcm';
  private keyLength = 32;
  private ivLength = 16;
  private saltLength = 64;
  private tagLength = 16;

  constructor(private context: vscode.ExtensionContext) {}

  private async getMasterKey(): Promise<Buffer> {
    // Use VS Code's secret storage for the master key
    let masterKey = await this.context.secrets.get('kilo-master-key');
    
    if (!masterKey) {
      // Generate a new master key
      masterKey = crypto.randomBytes(this.keyLength).toString('hex');
      await this.context.secrets.store('kilo-master-key', masterKey);
    }
    
    return Buffer.from(masterKey, 'hex');
  }

  private deriveKey(masterKey: Buffer, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(masterKey, salt, 100000, this.keyLength, 'sha512');
  }

  async encrypt(plaintext: string): Promise<string> {
    const masterKey = await this.getMasterKey();
    const salt = crypto.randomBytes(this.saltLength);
    const iv = crypto.randomBytes(this.ivLength);
    const key = this.deriveKey(masterKey, salt);

    const cipher = crypto.createCipheriv(this.algorithm, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();

    // Combine: salt + iv + tag + encrypted
    const combined = Buffer.concat([salt, iv, tag, encrypted]);
    return combined.toString('base64');
  }

  async decrypt(encryptedData: string): Promise<string> {
    const masterKey = await this.getMasterKey();
    const combined = Buffer.from(encryptedData, 'base64');

    // Extract components
    const salt = combined.subarray(0, this.saltLength);
    const iv = combined.subarray(this.saltLength, this.saltLength + this.ivLength);
    const tag = combined.subarray(
      this.saltLength + this.ivLength,
      this.saltLength + this.ivLength + this.tagLength
    );
    const encrypted = combined.subarray(this.saltLength + this.ivLength + this.tagLength);

    const key = this.deriveKey(masterKey, salt);
    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);

    return decrypted.toString('utf8');
  }
}
```

Create `src/credentials/CredentialManager.ts`:

```typescript
import * as vscode from 'vscode';
import { EncryptionService } from './EncryptionService';

export interface Credential {
  id: string;
  name: string;
  type: 'web' | 'database' | 'ssh' | 'api' | 'oracle' | 'cockpit';
  url?: string;
  host?: string;
  port?: number;
  username: string;
  password?: string;
  apiKey?: string;
  sshKey?: string;
  database?: string;
  sid?: string; // Oracle SID
  serviceName?: string; // Oracle Service Name
  additionalFields?: Record<string, string>;
  lastUsed?: Date;
  tags?: string[];
}

interface StoredCredentials {
  version: number;
  credentials: { [id: string]: string }; // Encrypted credential JSON
}

export class CredentialManager {
  private encryption: EncryptionService;
  private credentialsKey = 'kilo-credentials';
  private cache: Map<string, Credential> = new Map();

  constructor(private context: vscode.ExtensionContext) {
    this.encryption = new EncryptionService(context);
  }

  async initialize(): Promise<void> {
    // Load and decrypt all credentials into cache
    const stored = this.context.globalState.get<StoredCredentials>(this.credentialsKey);
    
    if (stored) {
      for (const [id, encryptedCred] of Object.entries(stored.credentials)) {
        try {
          const decrypted = await this.encryption.decrypt(encryptedCred);
          this.cache.set(id, JSON.parse(decrypted));
        } catch (error) {
          console.error(`Failed to decrypt credential ${id}:`, error);
        }
      }
    }
  }

  async save(credential: Credential): Promise<void> {
    // Generate ID if not provided
    if (!credential.id) {
      credential.id = `cred_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Encrypt the credential
    const encrypted = await this.encryption.encrypt(JSON.stringify(credential));

    // Get existing stored credentials
    const stored = this.context.globalState.get<StoredCredentials>(this.credentialsKey) || {
      version: 1,
      credentials: {}
    };

    // Add/update the credential
    stored.credentials[credential.id] = encrypted;

    // Save back to storage
    await this.context.globalState.update(this.credentialsKey, stored);

    // Update cache
    this.cache.set(credential.id, credential);
  }

  async get(id: string): Promise<Credential | undefined> {
    return this.cache.get(id);
  }

  async getByName(name: string): Promise<Credential | undefined> {
    for (const cred of this.cache.values()) {
      if (cred.name.toLowerCase() === name.toLowerCase()) {
        return cred;
      }
    }
    return undefined;
  }

  async getByType(type: Credential['type']): Promise<Credential[]> {
    return Array.from(this.cache.values()).filter(c => c.type === type);
  }

  async getByUrl(url: string): Promise<Credential | undefined> {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    for (const cred of this.cache.values()) {
      if (cred.url) {
        try {
          const credUrlObj = new URL(cred.url);
          if (credUrlObj.hostname === hostname) {
            return cred;
          }
        } catch {}
      }
      if (cred.host === hostname) {
        return cred;
      }
    }
    return undefined;
  }

  async getAll(): Promise<Credential[]> {
    return Array.from(this.cache.values());
  }

  async delete(id: string): Promise<void> {
    const stored = this.context.globalState.get<StoredCredentials>(this.credentialsKey);
    
    if (stored && stored.credentials[id]) {
      delete stored.credentials[id];
      await this.context.globalState.update(this.credentialsKey, stored);
      this.cache.delete(id);
    }
  }

  async updateLastUsed(id: string): Promise<void> {
    const cred = this.cache.get(id);
    if (cred) {
      cred.lastUsed = new Date();
      await this.save(cred);
    }
  }

  // List credentials without exposing passwords (for display)
  listSafe(): { id: string; name: string; type: string; url?: string; username: string }[] {
    return Array.from(this.cache.values()).map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      url: c.url || c.host,
      username: c.username
    }));
  }
}
```

## Step 2: Credential Tools for Agent

Create `src/credentials/CredentialTools.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { CredentialManager, Credential } from './CredentialManager';
import * as vscode from 'vscode';

export class CredentialTools {
  constructor(private credentialManager: CredentialManager) {}

  getToolDefinitions(): Anthropic.Tool[] {
    return [
      {
        name: 'credential_save',
        description: 'Save credentials for a service (web app, database, API, etc.). The password will be encrypted.',
        input_schema: {
          type: 'object' as const,
          properties: {
            name: {
              type: 'string',
              description: 'Friendly name for this credential (e.g., "Production Oracle", "Dev Cockpit")'
            },
            type: {
              type: 'string',
              enum: ['web', 'database', 'ssh', 'api', 'oracle', 'cockpit'],
              description: 'Type of credential'
            },
            url: {
              type: 'string',
              description: 'URL for web services'
            },
            host: {
              type: 'string',
              description: 'Hostname for databases/SSH'
            },
            port: {
              type: 'number',
              description: 'Port number'
            },
            username: {
              type: 'string',
              description: 'Username'
            },
            password: {
              type: 'string',
              description: 'Password'
            },
            database: {
              type: 'string',
              description: 'Database name (for database connections)'
            },
            sid: {
              type: 'string',
              description: 'Oracle SID'
            },
            serviceName: {
              type: 'string',
              description: 'Oracle Service Name'
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for organization (e.g., ["production", "oracle"])'
            }
          },
          required: ['name', 'type', 'username']
        }
      },
      {
        name: 'credential_list',
        description: 'List all saved credentials (passwords are hidden).',
        input_schema: {
          type: 'object' as const,
          properties: {
            type: {
              type: 'string',
              enum: ['web', 'database', 'ssh', 'api', 'oracle', 'cockpit'],
              description: 'Filter by type (optional)'
            }
          },
          required: []
        }
      },
      {
        name: 'credential_get',
        description: 'Get credentials by name or ID to use for login/connection.',
        input_schema: {
          type: 'object' as const,
          properties: {
            name: {
              type: 'string',
              description: 'Name of the credential'
            },
            id: {
              type: 'string',
              description: 'ID of the credential (alternative to name)'
            }
          },
          required: []
        }
      },
      {
        name: 'credential_delete',
        description: 'Delete a saved credential.',
        input_schema: {
          type: 'object' as const,
          properties: {
            id: {
              type: 'string',
              description: 'ID of the credential to delete'
            },
            name: {
              type: 'string',
              description: 'Name of the credential to delete (alternative to ID)'
            }
          },
          required: []
        }
      },
      {
        name: 'credential_find_for_url',
        description: 'Find saved credentials that match a URL.',
        input_schema: {
          type: 'object' as const,
          properties: {
            url: {
              type: 'string',
              description: 'URL to find credentials for'
            }
          },
          required: ['url']
        }
      }
    ];
  }

  async executeTool(name: string, input: any): Promise<any> {
    switch (name) {
      case 'credential_save': {
        // Ask for confirmation before saving
        const confirm = await vscode.window.showWarningMessage(
          `Save credentials for "${input.name}"?`,
          'Yes', 'No'
        );
        
        if (confirm !== 'Yes') {
          return { success: false, message: 'User cancelled' };
        }

        const credential: Credential = {
          id: '',
          name: input.name,
          type: input.type,
          url: input.url,
          host: input.host,
          port: input.port,
          username: input.username,
          password: input.password,
          database: input.database,
          sid: input.sid,
          serviceName: input.serviceName,
          tags: input.tags
        };

        await this.credentialManager.save(credential);
        return { 
          success: true, 
          message: `Credentials saved for "${input.name}"`,
          id: credential.id
        };
      }

      case 'credential_list': {
        let creds = this.credentialManager.listSafe();
        if (input.type) {
          creds = creds.filter(c => c.type === input.type);
        }
        return { success: true, credentials: creds };
      }

      case 'credential_get': {
        let cred: Credential | undefined;
        
        if (input.id) {
          cred = await this.credentialManager.get(input.id);
        } else if (input.name) {
          cred = await this.credentialManager.getByName(input.name);
        }

        if (!cred) {
          return { success: false, error: 'Credential not found' };
        }

        await this.credentialManager.updateLastUsed(cred.id);
        return { success: true, credential: cred };
      }

      case 'credential_delete': {
        let cred: Credential | undefined;
        
        if (input.id) {
          cred = await this.credentialManager.get(input.id);
        } else if (input.name) {
          cred = await this.credentialManager.getByName(input.name);
        }

        if (!cred) {
          return { success: false, error: 'Credential not found' };
        }

        const confirm = await vscode.window.showWarningMessage(
          `Delete credentials for "${cred.name}"?`,
          'Yes', 'No'
        );
        
        if (confirm !== 'Yes') {
          return { success: false, message: 'User cancelled' };
        }

        await this.credentialManager.delete(cred.id);
        return { success: true, message: `Deleted credentials for "${cred.name}"` };
      }

      case 'credential_find_for_url': {
        const cred = await this.credentialManager.getByUrl(input.url);
        if (cred) {
          return { success: true, credential: cred };
        }
        return { success: false, message: 'No saved credentials for this URL' };
      }

      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  }
}
```

## Step 3: Backend Tools

Create `src/backend/DatabaseTools.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class DatabaseTools {
  getToolDefinitions(): Anthropic.Tool[] {
    return [
      {
        name: 'db_query_oracle',
        description: 'Execute a SQL query against an Oracle database using SQLPlus.',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: {
              type: 'string',
              description: 'SQL query to execute'
            },
            connectionString: {
              type: 'string',
              description: 'Oracle connection string (user/password@host:port/service)'
            }
          },
          required: ['query', 'connectionString']
        }
      },
      {
        name: 'db_query_postgres',
        description: 'Execute a SQL query against a PostgreSQL database.',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: {
              type: 'string',
              description: 'SQL query to execute'
            },
            host: { type: 'string' },
            port: { type: 'number', description: 'Default: 5432' },
            database: { type: 'string' },
            username: { type: 'string' },
            password: { type: 'string' }
          },
          required: ['query', 'host', 'database', 'username', 'password']
        }
      },
      {
        name: 'db_query_mysql',
        description: 'Execute a SQL query against a MySQL/MariaDB database.',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: {
              type: 'string',
              description: 'SQL query to execute'
            },
            host: { type: 'string' },
            port: { type: 'number', description: 'Default: 3306' },
            database: { type: 'string' },
            username: { type: 'string' },
            password: { type: 'string' }
          },
          required: ['query', 'host', 'database', 'username', 'password']
        }
      },
      {
        name: 'db_list_tables',
        description: 'List all tables in a database.',
        input_schema: {
          type: 'object' as const,
          properties: {
            dbType: {
              type: 'string',
              enum: ['oracle', 'postgres', 'mysql'],
              description: 'Database type'
            },
            connectionInfo: {
              type: 'object',
              description: 'Connection information'
            }
          },
          required: ['dbType', 'connectionInfo']
        }
      },
      {
        name: 'db_describe_table',
        description: 'Get the structure/schema of a table.',
        input_schema: {
          type: 'object' as const,
          properties: {
            tableName: { type: 'string' },
            dbType: {
              type: 'string',
              enum: ['oracle', 'postgres', 'mysql']
            },
            connectionInfo: { type: 'object' }
          },
          required: ['tableName', 'dbType', 'connectionInfo']
        }
      },
      {
        name: 'db_explain_query',
        description: 'Get the execution plan for a query.',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string' },
            dbType: {
              type: 'string',
              enum: ['oracle', 'postgres', 'mysql']
            },
            connectionInfo: { type: 'object' }
          },
          required: ['query', 'dbType', 'connectionInfo']
        }
      }
    ];
  }

  async executeTool(name: string, input: any): Promise<any> {
    try {
      switch (name) {
        case 'db_query_oracle':
          return await this.queryOracle(input.query, input.connectionString);
        
        case 'db_query_postgres':
          return await this.queryPostgres(input);
        
        case 'db_query_mysql':
          return await this.queryMySQL(input);
        
        case 'db_list_tables':
          return await this.listTables(input.dbType, input.connectionInfo);
        
        case 'db_describe_table':
          return await this.describeTable(input.tableName, input.dbType, input.connectionInfo);
        
        case 'db_explain_query':
          return await this.explainQuery(input.query, input.dbType, input.connectionInfo);
        
        default:
          return { success: false, error: `Unknown tool: ${name}` };
      }
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  private async queryOracle(query: string, connectionString: string): Promise<any> {
    // Using SQLPlus CLI
    const sqlplusScript = `
SET PAGESIZE 50000
SET LINESIZE 32767
SET FEEDBACK OFF
SET HEADING ON
SET COLSEP '|'
${query};
EXIT;
`;
    
    const { stdout, stderr } = await execAsync(
      `echo "${sqlplusScript}" | sqlplus -S ${connectionString}`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    if (stderr) {
      return { success: false, error: stderr };
    }

    // Parse the output into structured data
    const lines = stdout.trim().split('\n').filter(l => l.trim());
    const results = this.parseTableOutput(lines);

    return { success: true, results, rowCount: results.length };
  }

  private async queryPostgres(input: any): Promise<any> {
    const { query, host, port = 5432, database, username, password } = input;
    
    const env = { ...process.env, PGPASSWORD: password };
    const cmd = `psql -h ${host} -p ${port} -U ${username} -d ${database} -c "${query.replace(/"/g, '\\"')}" --csv`;
    
    const { stdout, stderr } = await execAsync(cmd, { env, maxBuffer: 10 * 1024 * 1024 });

    if (stderr && !stderr.includes('NOTICE')) {
      return { success: false, error: stderr };
    }

    const results = this.parseCSV(stdout);
    return { success: true, results, rowCount: results.length };
  }

  private async queryMySQL(input: any): Promise<any> {
    const { query, host, port = 3306, database, username, password } = input;
    
    const cmd = `mysql -h ${host} -P ${port} -u ${username} -p${password} ${database} -e "${query.replace(/"/g, '\\"')}" --batch`;
    
    const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });

    if (stderr) {
      return { success: false, error: stderr };
    }

    const results = this.parseTSV(stdout);
    return { success: true, results, rowCount: results.length };
  }

  private async listTables(dbType: string, connectionInfo: any): Promise<any> {
    let query: string;
    
    switch (dbType) {
      case 'oracle':
        query = "SELECT table_name FROM user_tables ORDER BY table_name";
        return await this.queryOracle(query, connectionInfo.connectionString);
      
      case 'postgres':
        query = "SELECT tablename FROM pg_tables WHERE schemaname = 'public'";
        return await this.queryPostgres({ ...connectionInfo, query });
      
      case 'mysql':
        query = "SHOW TABLES";
        return await this.queryMySQL({ ...connectionInfo, query });
      
      default:
        return { success: false, error: `Unsupported database type: ${dbType}` };
    }
  }

  private async describeTable(tableName: string, dbType: string, connectionInfo: any): Promise<any> {
    let query: string;
    
    switch (dbType) {
      case 'oracle':
        query = `SELECT column_name, data_type, nullable, data_length FROM user_tab_columns WHERE table_name = '${tableName.toUpperCase()}' ORDER BY column_id`;
        return await this.queryOracle(query, connectionInfo.connectionString);
      
      case 'postgres':
        query = `SELECT column_name, data_type, is_nullable, character_maximum_length FROM information_schema.columns WHERE table_name = '${tableName}'`;
        return await this.queryPostgres({ ...connectionInfo, query });
      
      case 'mysql':
        query = `DESCRIBE ${tableName}`;
        return await this.queryMySQL({ ...connectionInfo, query });
      
      default:
        return { success: false, error: `Unsupported database type: ${dbType}` };
    }
  }

  private async explainQuery(query: string, dbType: string, connectionInfo: any): Promise<any> {
    let explainQuery: string;
    
    switch (dbType) {
      case 'oracle':
        explainQuery = `EXPLAIN PLAN FOR ${query};\nSELECT * FROM TABLE(DBMS_XPLAN.DISPLAY)`;
        return await this.queryOracle(explainQuery, connectionInfo.connectionString);
      
      case 'postgres':
        explainQuery = `EXPLAIN ANALYZE ${query}`;
        return await this.queryPostgres({ ...connectionInfo, query: explainQuery });
      
      case 'mysql':
        explainQuery = `EXPLAIN ${query}`;
        return await this.queryMySQL({ ...connectionInfo, query: explainQuery });
      
      default:
        return { success: false, error: `Unsupported database type: ${dbType}` };
    }
  }

  private parseTableOutput(lines: string[]): any[] {
    if (lines.length < 2) return [];
    
    const headers = lines[0].split('|').map(h => h.trim());
    const results: any[] = [];
    
    for (let i = 2; i < lines.length; i++) { // Skip header and separator
      const values = lines[i].split('|').map(v => v.trim());
      const row: any = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx];
      });
      results.push(row);
    }
    
    return results;
  }

  private parseCSV(output: string): any[] {
    const lines = output.trim().split('\n');
    if (lines.length < 1) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const results: any[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const row: any = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx];
      });
      results.push(row);
    }
    
    return results;
  }

  private parseTSV(output: string): any[] {
    const lines = output.trim().split('\n');
    if (lines.length < 1) return [];
    
    const headers = lines[0].split('\t').map(h => h.trim());
    const results: any[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split('\t').map(v => v.trim());
      const row: any = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx];
      });
      results.push(row);
    }
    
    return results;
  }
}
```

Create `src/backend/DockerTools.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class DockerTools {
  getToolDefinitions(): Anthropic.Tool[] {
    return [
      {
        name: 'docker_ps',
        description: 'List running Docker containers.',
        input_schema: {
          type: 'object' as const,
          properties: {
            all: {
              type: 'boolean',
              description: 'Show all containers (including stopped)'
            }
          },
          required: []
        }
      },
      {
        name: 'docker_logs',
        description: 'Get logs from a Docker container.',
        input_schema: {
          type: 'object' as const,
          properties: {
            container: {
              type: 'string',
              description: 'Container name or ID'
            },
            tail: {
              type: 'number',
              description: 'Number of lines to show (default: 100)'
            },
            since: {
              type: 'string',
              description: 'Show logs since timestamp (e.g., "1h", "30m")'
            }
          },
          required: ['container']
        }
      },
      {
        name: 'docker_exec',
        description: 'Execute a command inside a Docker container.',
        input_schema: {
          type: 'object' as const,
          properties: {
            container: { type: 'string' },
            command: { type: 'string' }
          },
          required: ['container', 'command']
        }
      },
      {
        name: 'docker_start',
        description: 'Start a stopped container.',
        input_schema: {
          type: 'object' as const,
          properties: {
            container: { type: 'string' }
          },
          required: ['container']
        }
      },
      {
        name: 'docker_stop',
        description: 'Stop a running container.',
        input_schema: {
          type: 'object' as const,
          properties: {
            container: { type: 'string' }
          },
          required: ['container']
        }
      },
      {
        name: 'docker_restart',
        description: 'Restart a container.',
        input_schema: {
          type: 'object' as const,
          properties: {
            container: { type: 'string' }
          },
          required: ['container']
        }
      },
      {
        name: 'docker_compose_up',
        description: 'Start services defined in docker-compose.yml.',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: {
              type: 'string',
              description: 'Path to docker-compose.yml directory'
            },
            services: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific services to start (optional)'
            },
            detach: {
              type: 'boolean',
              description: 'Run in background (default: true)'
            }
          },
          required: ['path']
        }
      },
      {
        name: 'docker_compose_down',
        description: 'Stop and remove containers defined in docker-compose.yml.',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string' },
            volumes: {
              type: 'boolean',
              description: 'Remove volumes too'
            }
          },
          required: ['path']
        }
      },
      {
        name: 'docker_images',
        description: 'List Docker images.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      },
      {
        name: 'docker_stats',
        description: 'Get resource usage statistics for containers.',
        input_schema: {
          type: 'object' as const,
          properties: {
            container: {
              type: 'string',
              description: 'Specific container (optional, shows all if not provided)'
            }
          },
          required: []
        }
      }
    ];
  }

  async executeTool(name: string, input: any): Promise<any> {
    try {
      switch (name) {
        case 'docker_ps': {
          const flag = input.all ? '-a' : '';
          const { stdout } = await execAsync(`docker ps ${flag} --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"`);
          return { success: true, containers: this.parseDockerTable(stdout) };
        }

        case 'docker_logs': {
          const tail = input.tail || 100;
          const since = input.since ? `--since ${input.since}` : '';
          const { stdout } = await execAsync(`docker logs --tail ${tail} ${since} ${input.container}`);
          return { success: true, logs: stdout };
        }

        case 'docker_exec': {
          const { stdout, stderr } = await execAsync(`docker exec ${input.container} ${input.command}`);
          return { success: true, output: stdout, error: stderr };
        }

        case 'docker_start': {
          await execAsync(`docker start ${input.container}`);
          return { success: true, message: `Container ${input.container} started` };
        }

        case 'docker_stop': {
          await execAsync(`docker stop ${input.container}`);
          return { success: true, message: `Container ${input.container} stopped` };
        }

        case 'docker_restart': {
          await execAsync(`docker restart ${input.container}`);
          return { success: true, message: `Container ${input.container} restarted` };
        }

        case 'docker_compose_up': {
          const detach = input.detach !== false ? '-d' : '';
          const services = input.services?.join(' ') || '';
          const { stdout } = await execAsync(`cd ${input.path} && docker-compose up ${detach} ${services}`);
          return { success: true, output: stdout };
        }

        case 'docker_compose_down': {
          const volumes = input.volumes ? '-v' : '';
          const { stdout } = await execAsync(`cd ${input.path} && docker-compose down ${volumes}`);
          return { success: true, output: stdout };
        }

        case 'docker_images': {
          const { stdout } = await execAsync('docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}"');
          return { success: true, images: this.parseDockerTable(stdout) };
        }

        case 'docker_stats': {
          const container = input.container || '';
          const { stdout } = await execAsync(`docker stats --no-stream ${container} --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"`);
          return { success: true, stats: this.parseDockerTable(stdout) };
        }

        default:
          return { success: false, error: `Unknown tool: ${name}` };
      }
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  private parseDockerTable(output: string): any[] {
    const lines = output.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(/\s{2,}/).map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const results: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(/\s{2,}/).map(v => v.trim());
      const row: any = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx];
      });
      results.push(row);
    }

    return results;
  }
}
```

Create `src/backend/APITools.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';

export class APITools {
  getToolDefinitions(): Anthropic.Tool[] {
    return [
      {
        name: 'api_request',
        description: 'Make an HTTP request to an API endpoint.',
        input_schema: {
          type: 'object' as const,
          properties: {
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
              description: 'HTTP method'
            },
            url: {
              type: 'string',
              description: 'Full URL to request'
            },
            headers: {
              type: 'object',
              description: 'HTTP headers'
            },
            body: {
              type: 'object',
              description: 'Request body (for POST/PUT/PATCH)'
            },
            auth: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['basic', 'bearer', 'api-key'] },
                username: { type: 'string' },
                password: { type: 'string' },
                token: { type: 'string' },
                apiKey: { type: 'string' },
                headerName: { type: 'string' }
              }
            }
          },
          required: ['method', 'url']
        }
      },
      {
        name: 'api_health_check',
        description: 'Check if an API endpoint is responding.',
        input_schema: {
          type: 'object' as const,
          properties: {
            url: { type: 'string' },
            expectedStatus: { 
              type: 'number',
              description: 'Expected HTTP status code (default: 200)'
            }
          },
          required: ['url']
        }
      },
      {
        name: 'api_graphql',
        description: 'Execute a GraphQL query.',
        input_schema: {
          type: 'object' as const,
          properties: {
            url: { type: 'string' },
            query: { type: 'string' },
            variables: { type: 'object' },
            headers: { type: 'object' }
          },
          required: ['url', 'query']
        }
      }
    ];
  }

  async executeTool(name: string, input: any): Promise<any> {
    try {
      switch (name) {
        case 'api_request': {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...input.headers
          };

          // Handle authentication
          if (input.auth) {
            switch (input.auth.type) {
              case 'basic':
                const basicAuth = Buffer.from(`${input.auth.username}:${input.auth.password}`).toString('base64');
                headers['Authorization'] = `Basic ${basicAuth}`;
                break;
              case 'bearer':
                headers['Authorization'] = `Bearer ${input.auth.token}`;
                break;
              case 'api-key':
                const headerName = input.auth.headerName || 'X-API-Key';
                headers[headerName] = input.auth.apiKey;
                break;
            }
          }

          const response = await fetch(input.url, {
            method: input.method,
            headers,
            body: input.body ? JSON.stringify(input.body) : undefined
          });

          const contentType = response.headers.get('content-type');
          let data: any;
          
          if (contentType?.includes('application/json')) {
            data = await response.json();
          } else {
            data = await response.text();
          }

          return {
            success: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            data
          };
        }

        case 'api_health_check': {
          const start = Date.now();
          const response = await fetch(input.url, { method: 'GET' });
          const duration = Date.now() - start;
          
          const expectedStatus = input.expectedStatus || 200;
          const healthy = response.status === expectedStatus;

          return {
            success: true,
            healthy,
            status: response.status,
            responseTime: `${duration}ms`
          };
        }

        case 'api_graphql': {
          const response = await fetch(input.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...input.headers
            },
            body: JSON.stringify({
              query: input.query,
              variables: input.variables || {}
            })
          });

          const data = await response.json();
          
          return {
            success: !data.errors,
            data: data.data,
            errors: data.errors
          };
        }

        default:
          return { success: false, error: `Unknown tool: ${name}` };
      }
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
}
```

## Step 4: Frontend Tools

Create `src/frontend/ComponentTools.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs/promises';
import * as path from 'path';

export class ComponentTools {
  getToolDefinitions(): Anthropic.Tool[] {
    return [
      {
        name: 'component_create',
        description: 'Create a new frontend component with proper structure.',
        input_schema: {
          type: 'object' as const,
          properties: {
            name: {
              type: 'string',
              description: 'Component name (e.g., "UserCard")'
            },
            framework: {
              type: 'string',
              enum: ['react', 'vue', 'svelte', 'angular'],
              description: 'Frontend framework'
            },
            path: {
              type: 'string',
              description: 'Directory to create the component in'
            },
            typescript: {
              type: 'boolean',
              description: 'Use TypeScript (default: true)'
            },
            styling: {
              type: 'string',
              enum: ['css', 'scss', 'tailwind', 'styled-components', 'css-modules'],
              description: 'Styling approach'
            },
            props: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string' },
                  required: { type: 'boolean' },
                  default: { type: 'string' }
                }
              },
              description: 'Component props'
            },
            description: {
              type: 'string',
              description: 'What the component should do'
            }
          },
          required: ['name', 'framework', 'path']
        }
      },
      {
        name: 'component_analyze',
        description: 'Analyze an existing component and suggest improvements.',
        input_schema: {
          type: 'object' as const,
          properties: {
            filePath: {
              type: 'string',
              description: 'Path to the component file'
            }
          },
          required: ['filePath']
        }
      },
      {
        name: 'component_generate_tests',
        description: 'Generate test file for a component.',
        input_schema: {
          type: 'object' as const,
          properties: {
            componentPath: { type: 'string' },
            testFramework: {
              type: 'string',
              enum: ['jest', 'vitest', 'testing-library', 'cypress'],
              description: 'Testing framework'
            }
          },
          required: ['componentPath']
        }
      },
      {
        name: 'component_extract',
        description: 'Extract a reusable component from existing code.',
        input_schema: {
          type: 'object' as const,
          properties: {
            sourcePath: { type: 'string' },
            startLine: { type: 'number' },
            endLine: { type: 'number' },
            newComponentName: { type: 'string' }
          },
          required: ['sourcePath', 'startLine', 'endLine', 'newComponentName']
        }
      }
    ];
  }

  async executeTool(name: string, input: any): Promise<any> {
    switch (name) {
      case 'component_create':
        return await this.createComponent(input);
      
      case 'component_analyze':
        return await this.analyzeComponent(input.filePath);
      
      case 'component_generate_tests':
        return await this.generateTests(input);
      
      case 'component_extract':
        return await this.extractComponent(input);
      
      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  }

  private async createComponent(input: any): Promise<any> {
    const { name, framework, path: basePath, typescript = true, styling = 'css', props = [] } = input;
    
    const ext = typescript ? 'tsx' : 'jsx';
    const componentDir = path.join(basePath, name);
    
    // Create component directory
    await fs.mkdir(componentDir, { recursive: true });

    let componentCode: string;
    let styleCode: string = '';
    
    switch (framework) {
      case 'react':
        componentCode = this.generateReactComponent(name, props, typescript, styling);
        break;
      case 'vue':
        componentCode = this.generateVueComponent(name, props, typescript, styling);
        break;
      case 'svelte':
        componentCode = this.generateSvelteComponent(name, props, typescript);
        break;
      default:
        return { success: false, error: `Unsupported framework: ${framework}` };
    }

    // Write files
    const files: string[] = [];
    
    const componentFile = framework === 'vue' ? `${name}.vue` : 
                          framework === 'svelte' ? `${name}.svelte` : 
                          `${name}.${ext}`;
    
    await fs.writeFile(path.join(componentDir, componentFile), componentCode);
    files.push(componentFile);

    // Create style file if not using Tailwind or styled-components
    if (!['tailwind', 'styled-components'].includes(styling)) {
      const styleExt = styling === 'scss' ? 'scss' : 
                       styling === 'css-modules' ? 'module.css' : 'css';
      styleCode = this.generateStyles(name, styling);
      await fs.writeFile(path.join(componentDir, `${name}.${styleExt}`), styleCode);
      files.push(`${name}.${styleExt}`);
    }

    // Create index file
    const indexCode = `export { default } from './${name}';\nexport * from './${name}';\n`;
    await fs.writeFile(path.join(componentDir, `index.${typescript ? 'ts' : 'js'}`), indexCode);
    files.push(`index.${typescript ? 'ts' : 'js'}`);

    return {
      success: true,
      message: `Created component ${name}`,
      path: componentDir,
      files
    };
  }

  private generateReactComponent(name: string, props: any[], typescript: boolean, styling: string): string {
    const propsInterface = typescript && props.length > 0 ? `
interface ${name}Props {
${props.map(p => `  ${p.name}${p.required ? '' : '?'}: ${p.type};`).join('\n')}
}
` : '';

    const propsArg = typescript && props.length > 0 ? `{ ${props.map(p => p.name).join(', ')} }: ${name}Props` : 'props';
    
    const styleImport = styling === 'css-modules' ? `import styles from './${name}.module.css';` :
                        styling === 'styled-components' ? `import styled from 'styled-components';` :
                        styling !== 'tailwind' ? `import './${name}.css';` : '';

    return `import React from 'react';
${styleImport}
${propsInterface}
const ${name}: React.FC${typescript && props.length > 0 ? `<${name}Props>` : ''} = (${propsArg}) => {
  return (
    <div className="${styling === 'css-modules' ? 'styles.container' : name.toLowerCase()}">
      <h2>${name} Component</h2>
      {/* Component content */}
    </div>
  );
};

export default ${name};
`;
  }

  private generateVueComponent(name: string, props: any[], typescript: boolean, styling: string): string {
    const propsCode = props.length > 0 ? props.map(p => 
      `  ${p.name}: { type: ${p.type}, required: ${p.required || false}${p.default ? `, default: ${p.default}` : ''} }`
    ).join(',\n') : '';

    return `<template>
  <div class="${name.toLowerCase()}">
    <h2>${name} Component</h2>
    <!-- Component content -->
  </div>
</template>

<script${typescript ? ' lang="ts"' : ''}>
export default {
  name: '${name}',
  props: {
${propsCode}
  },
  setup(props) {
    return {};
  }
};
</script>

<style${styling === 'scss' ? ' lang="scss"' : ''} scoped>
.${name.toLowerCase()} {
  /* Styles */
}
</style>
`;
  }

  private generateSvelteComponent(name: string, props: any[], typescript: boolean): string {
    const propsCode = props.map(p => 
      `  export let ${p.name}${typescript ? `: ${p.type}` : ''}${p.default ? ` = ${p.default}` : ''};`
    ).join('\n');

    return `<script${typescript ? ' lang="ts"' : ''}>
${propsCode}
</script>

<div class="${name.toLowerCase()}">
  <h2>${name} Component</h2>
  <!-- Component content -->
</div>

<style>
  .${name.toLowerCase()} {
    /* Styles */
  }
</style>
`;
  }

  private generateStyles(name: string, styling: string): string {
    return `.${name.toLowerCase()} {
  /* Container styles */
}

.${name.toLowerCase()} h2 {
  /* Heading styles */
}
`;
  }

  private async analyzeComponent(filePath: string): Promise<any> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      
      const analysis = {
        lines: content.split('\n').length,
        hasTypeScript: filePath.endsWith('.tsx') || filePath.endsWith('.ts'),
        hasTests: false,
        suggestions: [] as string[],
        complexity: 'low' as 'low' | 'medium' | 'high'
      };

      // Check for common issues
      if (content.includes('any')) {
        analysis.suggestions.push('Consider replacing "any" types with specific types');
      }
      if (content.split('useState').length > 5) {
        analysis.suggestions.push('Consider using useReducer for complex state management');
      }
      if (content.split('useEffect').length > 3) {
        analysis.suggestions.push('Multiple useEffect hooks - consider consolidating or creating custom hooks');
      }
      if (!content.includes('memo') && analysis.lines > 100) {
        analysis.suggestions.push('Consider using React.memo for performance optimization');
      }

      // Estimate complexity
      if (analysis.lines > 300 || content.split('useEffect').length > 5) {
        analysis.complexity = 'high';
      } else if (analysis.lines > 100) {
        analysis.complexity = 'medium';
      }

      return { success: true, analysis };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  private async generateTests(input: any): Promise<any> {
    try {
      const { componentPath, framework, testType = 'unit' } = input;

      let testContent = '';
      let testFileName = '';

      if (framework === 'react') {
        if (testType === 'unit') {
          testContent = `import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, describe } from 'vitest';
import ${input.componentName} from './${input.componentName}';

// Mock any external dependencies
jest.mock('../utils/api', () => ({
  fetchData: jest.fn(),
}));

describe('${input.componentName}', () => {
  test('renders without crashing', () => {
    render(<${input.componentName} />);
    expect(screen.getByRole('generic')).toBeInTheDocument();
  });

  test('handles props correctly', () => {
    const testProps = {
      title: 'Test Title',
      onClick: jest.fn(),
    };
    render(<${input.componentName} {...testProps} />);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  test('responds to user interactions', () => {
    const handleClick = jest.fn();
    render(<${input.componentName} onClick={handleClick} />);
    const element = screen.getByRole('button');
    fireEvent.click(element);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});`;
          testFileName = `${input.componentName}.test.tsx`;
        } else if (testType === 'integration') {
          testContent = `import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, describe } from 'vitest';
import ${input.componentName} from './${input.componentName}';

describe('${input.componentName} Integration', () => {
  test('integrates with user workflow', async () => {
    const user = userEvent.setup();

    render(<${input.componentName} />);

    // Test full user interaction flow
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByText(/success/i)).toBeInTheDocument();
    });
  });

  test('handles error states gracefully', async () => {
    // Mock an error condition
    render(<${input.componentName} />);

    // Trigger error condition
    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
  });
});`;
          testFileName = `${input.componentName}.integration.test.tsx`;
        }
      } else if (framework === 'vue') {
        testContent = `import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ${input.componentName} from './${input.componentName}.vue';

describe('${input.componentName}', () => {
  it('renders properly', () => {
    const wrapper = mount(${input.componentName}, {
      props: {
        title: 'Test Title'
      }
    });
    expect(wrapper.text()).toContain('Test Title');
  });

  it('handles user interactions', async () => {
    const wrapper = mount(${input.componentName});
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted()).toHaveProperty('click');
  });
});`;
        testFileName = `${input.componentName}.test.js`;
      }

      return {
        success: true,
        testContent,
        testFileName,
        testType,
        framework
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  private async extractComponent(input: any): Promise<any> {
    try {
      const { sourceCode, componentName, framework } = input;

      // Analyze the source code to extract component structure
      const analysis = {
        props: [] as Array<{name: string, type: string, required: boolean}>,
        methods: [] as string[],
        computed: [] as string[],
        dependencies: [] as string[],
        template: '',
        styles: '',
        complexity: 'low' as 'low' | 'medium' | 'high'
      };

      if (framework === 'react') {
        // Extract props from TypeScript interface or PropTypes
        const propsMatch = sourceCode.match(/interface\s+\w+Props\s*{([^}]*)}/);
        if (propsMatch) {
          const propsBlock = propsMatch[1];
          const propMatches = propsBlock.match(/(\w+):\s*([^;]+)/g) || [];
          analysis.props = propMatches.map(prop => {
            const [name, type] = prop.split(':').map(s => s.trim());
            return {
              name,
              type: type.replace('?', '').trim(),
              required: !type.includes('?')
            };
          });
        }

        // Extract methods (functions inside component)
        const methodMatches = sourceCode.match(/const\s+(\w+)\s*=\s*\([^)]*\)\s*=>/g) || [];
        analysis.methods = methodMatches.map(match =>
          match.match(/const\s+(\w+)\s*=/)?.[1] || ''
        ).filter(Boolean);

        // Extract dependencies (imports)
        const importMatches = sourceCode.match(/import\s+.*from\s+['"]([^'"]+)['"]/g) || [];
        analysis.dependencies = importMatches.map(match =>
          match.match(/from\s+['"]([^'"]+)['"]/)?.[1] || ''
        ).filter(Boolean);

        // Estimate complexity
        if (sourceCode.split('\n').length > 100 || analysis.methods.length > 5) {
          analysis.complexity = 'high';
        } else if (sourceCode.split('\n').length > 50 || analysis.methods.length > 2) {
          analysis.complexity = 'medium';
        }

      } else if (framework === 'vue') {
        // Extract props from Vue component
        const propsMatch = sourceCode.match(/props:\s*{([^}]*)}/);
        if (propsMatch) {
          const propsBlock = propsMatch[1];
          const propMatches = propsBlock.match(/(\w+):\s*{([^}]*)}/g) || [];
          analysis.props = propMatches.map(prop => {
            const [name, typeBlock] = prop.split(':').map(s => s.trim());
            const type = typeBlock.match(/type:\s*(\w+)/)?.[1] || 'any';
            const required = typeBlock.includes('required: true');
            return { name, type, required };
          });
        }

        // Extract methods
        const methodsMatch = sourceCode.match(/methods:\s*{([^}]*)}/);
        if (methodsMatch) {
          const methodsBlock = methodsMatch[1];
          const methodMatches = methodsBlock.match(/(\w+)\s*\(/g) || [];
          analysis.methods = methodMatches.map(match => match.replace('(', '').trim());
        }

        // Extract computed properties
        const computedMatch = sourceCode.match(/computed:\s*{([^}]*)}/);
        if (computedMatch) {
          const computedBlock = computedMatch[1];
          const computedMatches = computedBlock.match(/(\w+)\s*\(/g) || [];
          analysis.computed = computedMatches.map(match => match.replace('(', '').trim());
        }
      }

      // Extract template (simplified)
      if (framework === 'react') {
        const jsxMatch = sourceCode.match(/return\s*\(\s*<[^>]*>[\s\S]*?<\/[^>]*>\s*\)/);
        analysis.template = jsxMatch ? jsxMatch[0] : 'JSX template extracted';
      } else if (framework === 'vue') {
        const templateMatch = sourceCode.match(/<template>([\s\S]*?)<\/template>/);
        analysis.template = templateMatch ? templateMatch[1].trim() : 'Vue template extracted';
      }

      return {
        success: true,
        componentName,
        framework,
        analysis,
        extractedAt: new Date().toISOString()
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
}
```

## Step 5: Site-Specific Adapters

Create `src/browser/SiteAdapters/OracleAdapter.ts`:

```typescript
import { BrowserController, PageState } from '../BrowserController';

export class OracleAdapter {
  constructor(private browser: BrowserController) {}

  async detectOracleUI(): Promise<'apex' | 'em' | 'sql-developer-web' | 'ords' | 'unknown'> {
    const state = await this.browser.getPageState();
    const url = state.url.toLowerCase();

    if (url.includes('apex')) return 'apex';
    if (url.includes('em') || url.includes('enterprise-manager')) return 'em';
    if (url.includes('sql-developer')) return 'sql-developer-web';
    if (url.includes('ords')) return 'ords';
    return 'unknown';
  }

  async describeForAccessibility(): Promise<string> {
    const state = await this.browser.getPageState();
    const uiType = await this.detectOracleUI();
    
    let description = `# Oracle ${uiType.toUpperCase()} Interface\n`;
    description += `URL: ${state.url}\n\n`;

    // Oracle-specific element detection
    const oracleElements = await this.browser['activePage']?.evaluate(() => {
      const elements: any = {
        navigationTabs: [],
        datagrids: [],
        forms: [],
        buttons: [],
        alerts: []
      };

      // APEX-specific selectors
      document.querySelectorAll('.a-IRR-table, .a-IG').forEach((grid, i) => {
        const headers = Array.from(grid.querySelectorAll('th')).map(th => th.textContent?.trim());
        const rowCount = grid.querySelectorAll('tbody tr').length;
        elements.datagrids.push({ index: i, headers, rowCount });
      });

      // Navigation regions
      document.querySelectorAll('.t-NavigationBar-item, .t-Tabs-item').forEach(tab => {
        elements.navigationTabs.push(tab.textContent?.trim());
      });

      // Buttons
      document.querySelectorAll('.t-Button, .apex_disabled button, button.a-Button').forEach(btn => {
        const text = (btn as HTMLElement).textContent?.trim();
        if (text) elements.buttons.push(text);
      });

      // Alerts/Messages
      document.querySelectorAll('.t-Alert, .apex-page-success, .apex-page-error').forEach(alert => {
        elements.alerts.push((alert as HTMLElement).textContent?.trim());
      });

      return elements;
    });

    if (oracleElements) {
      if (oracleElements.alerts.length > 0) {
        description += `## ⚠️ ALERTS/MESSAGES:\n`;
        oracleElements.alerts.forEach((a: string) => description += `- ${a}\n`);
        description += '\n';
      }

      if (oracleElements.navigationTabs.length > 0) {
        description += `## NAVIGATION:\n`;
        description += oracleElements.navigationTabs.join(' | ') + '\n\n';
      }

      if (oracleElements.datagrids.length > 0) {
        description += `## DATA GRIDS:\n`;
        oracleElements.datagrids.forEach((grid: any) => {
          description += `### Grid ${grid.index + 1} (${grid.rowCount} rows)\n`;
          description += `Columns: ${grid.headers.join(', ')}\n`;
        });
        description += '\n';
      }

      if (oracleElements.buttons.length > 0) {
        description += `## AVAILABLE ACTIONS:\n`;
        oracleElements.buttons.forEach((b: string) => description += `- [Button] ${b}\n`);
      }
    }

    return description;
  }

  async navigateToSection(sectionName: string): Promise<void> {
    await this.browser.clickByText(sectionName);
  }

  async runApexQuery(sql: string): Promise<any> {
    // For APEX SQL Workshop
    await this.browser.fill('textarea.sql-editor, #sql-commands', sql);
    await this.browser.clickByText('Run');
    
    // Wait for results
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return this.browser.getPageState();
  }

  async exportData(format: 'csv' | 'excel' = 'csv'): Promise<void> {
    // Look for export buttons common in Oracle UIs
    const exportSelectors = [
      `button:has-text("Download")`,
      `button:has-text("Export")`,
      `.a-IRR-button--actions`,
      `#apexir_ACTIONSMENU`
    ];

    for (const sel of exportSelectors) {
      try {
        await this.browser.click(sel);
        await this.browser.clickByText(format === 'csv' ? 'CSV' : 'Excel');
        return;
      } catch {}
    }
  }
}
```

Create `src/browser/SiteAdapters/CockpitAdapter.ts`:

```typescript
import { BrowserController } from '../BrowserController';

export class CockpitAdapter {
  constructor(private browser: BrowserController) {}

  async describeForAccessibility(): Promise<string> {
    const state = await this.browser.getPageState();
    
    let description = `# Cockpit Server Management\n`;
    description += `URL: ${state.url}\n\n`;

    const cockpitData = await this.browser['activePage']?.evaluate(() => {
      const data: any = {
        hostname: document.querySelector('.ct-machine-name, .machine-link')?.textContent?.trim(),
        navigation: [],
        systemInfo: {},
        services: [],
        alerts: []
      };

      // Navigation items
      document.querySelectorAll('.pf-c-nav__item, .sidebar-item').forEach(item => {
        const text = (item as HTMLElement).textContent?.trim();
        const active = item.classList.contains('pf-m-current') || item.classList.contains('active');
        if (text) data.navigation.push({ text, active });
      });

      // System info cards
      document.querySelectorAll('.ct-overview-card, .pf-c-card').forEach(card => {
        const title = card.querySelector('.pf-c-card__title, h2')?.textContent?.trim();
        const value = card.querySelector('.pf-c-card__body, .value')?.textContent?.trim();
        if (title && value) {
          data.systemInfo[title] = value;
        }
      });

      // Service status
      document.querySelectorAll('.service-unit, .ct-listing-item').forEach(svc => {
        const name = svc.querySelector('.service-name, .ct-listing-title')?.textContent?.trim();
        const status = svc.querySelector('.service-status, .ct-listing-status')?.textContent?.trim();
        if (name) data.services.push({ name, status });
      });

      // Alerts
      document.querySelectorAll('.pf-c-alert, .ct-alert').forEach(alert => {
        data.alerts.push((alert as HTMLElement).textContent?.trim());
      });

      return data;
    });

    if (cockpitData) {
      if (cockpitData.hostname) {
        description += `## Server: ${cockpitData.hostname}\n\n`;
      }

      if (cockpitData.alerts.length > 0) {
        description += `## ⚠️ ALERTS:\n`;
        cockpitData.alerts.forEach((a: string) => description += `- ${a}\n`);
        description += '\n';
      }

      if (Object.keys(cockpitData.systemInfo).length > 0) {
        description += `## SYSTEM STATUS:\n`;
        for (const [key, value] of Object.entries(cockpitData.systemInfo)) {
          description += `- ${key}: ${value}\n`;
        }
        description += '\n';
      }

      if (cockpitData.navigation.length > 0) {
        description += `## NAVIGATION:\n`;
        cockpitData.navigation.forEach((nav: any) => {
          description += `- ${nav.active ? '→ ' : ''}${nav.text}\n`;
        });
        description += '\n';
      }

      if (cockpitData.services.length > 0) {
        description += `## SERVICES:\n`;
        cockpitData.services.slice(0, 10).forEach((svc: any) => {
          const icon = svc.status?.toLowerCase().includes('running') ? '✅' : 
                       svc.status?.toLowerCase().includes('stopped') ? '🔴' : '⚪';
          description += `${icon} ${svc.name}: ${svc.status || 'unknown'}\n`;
        });
        if (cockpitData.services.length > 10) {
          description += `... and ${cockpitData.services.length - 10} more services\n`;
        }
      }
    }

    return description;
  }

  async navigateTo(section: string): Promise<void> {
    const sectionMap: Record<string, string> = {
      'overview': 'Overview',
      'logs': 'Logs',
      'storage': 'Storage',
      'network': 'Networking',
      'services': 'Services',
      'terminal': 'Terminal',
      'users': 'Accounts',
      'updates': 'Software Updates',
      'podman': 'Podman Containers',
      'docker': 'Podman Containers'
    };

    const targetText = sectionMap[section.toLowerCase()] || section;
    await this.browser.clickByText(targetText);
  }

  async restartService(serviceName: string): Promise<void> {
    // Navigate to services if not there
    await this.navigateTo('services');
    
    // Find and click the service
    await this.browser.fill('input[type="search"], .service-search', serviceName);
    await this.browser.clickByText(serviceName);
    
    // Click restart
    await this.browser.clickByText('Restart');
  }

  async viewLogs(service?: string, lines: number = 100): Promise<string> {
    await this.navigateTo('logs');
    
    if (service) {
      // Filter by service
      await this.browser.fill('input.logs-filter, input[type="search"]', service);
    }

    // Get log content
    const state = await this.browser.getPageState();
    const logElement = await this.browser['activePage']?.$('.logs-content, .journal-content, pre');
    
    if (logElement) {
      const logs = await logElement.textContent();
      return logs || 'No logs found';
    }
    
    return 'Could not retrieve logs';
  }
}
```

## Step 6: Full-Stack Agent with Everything Combined

Create `src/agent/KiloAgent.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import * as vscode from 'vscode';
import { BrowserTools } from '../browser/BrowserTools';
import { CredentialManager } from '../credentials/CredentialManager';
import { CredentialTools } from '../credentials/CredentialTools';
import { DatabaseTools } from '../backend/DatabaseTools';
import { DockerTools } from '../backend/DockerTools';
import { APITools } from '../backend/APITools';
import { ComponentTools } from '../frontend/ComponentTools';
import { OracleAdapter } from '../browser/SiteAdapters/OracleAdapter';
import { CockpitAdapter } from '../browser/SiteAdapters/CockpitAdapter';

const SYSTEM_PROMPT = `You are Kilo, an expert full-stack developer assistant designed specifically to help a user with 50% vision loss. 
You are their eyes and hands for complex enterprise UIs like Oracle and Cockpit.

## YOUR CORE MISSION
Help the user navigate, understand, and work with web applications and development tasks they cannot easily see.

## ACCESSIBILITY GUIDELINES (CRITICAL)
1. ALWAYS describe what you see in clear, concise language
2. Announce errors and success messages PROMINENTLY
3. Read tables and data grids row by row when asked
4. Confirm actions BEFORE and AFTER performing them
5. Use numbered lists for multiple options so user can say "option 2"
6. Summarize complex pages into key sections
7. Alert immediately if something looks wrong or unexpected

## YOUR CAPABILITIES

### Frontend Development
- Create React, Vue, Svelte, Angular components
- Analyze and refactor frontend code
- Implement responsive designs with proper accessibility
- Work with Tailwind, styled-components, CSS modules
- Generate component tests

### Backend Development  
- Query Oracle, PostgreSQL, MySQL databases
- Manage Docker containers and compose stacks
- Make API requests and test endpoints
- Analyze server logs and performance

### Browser Automation
- Open and navigate web pages
- Fill forms and click buttons
- Read and interpret page content
- Handle logins with saved credentials
- Work with Oracle APEX, Enterprise Manager
- Manage servers via Cockpit

### Credential Management
- Securely save and retrieve credentials
- Auto-detect credentials for URLs
- Never expose passwords in responses

## WORKING WITH ORACLE
- Oracle UIs are notoriously complex - always describe the current context
- For data grids, announce column headers first, then read rows
- Watch for and announce validation errors
- Guide through multi-step wizards

## WORKING WITH COCKPIT
- Start with system overview status
- Announce service health clearly (running/stopped)
- Read logs with most recent entries first
- Confirm before restart actions

## RESPONSE STYLE
- Lead with the most important information
- Use clear section headers
- Keep sentences short and direct
- Avoid unnecessary technical jargon unless specifically asked
- Always end with "What would you like me to do next?" when appropriate

Remember: You are not just an assistant - you are the user's trusted eyes in complex interfaces.`;

export class KiloAgent {
  private client: Anthropic;
  private credentialManager: CredentialManager;
  private browserTools: BrowserTools;
  private credentialTools: CredentialTools;
  private databaseTools: DatabaseTools;
  private dockerTools: DockerTools;
  private apiTools: APITools;
  private componentTools: ComponentTools;
  private conversationHistory: Anthropic.MessageParam[] = [];
  private outputChannel: vscode.OutputChannel;

  constructor(
    apiKey: string,
    private context: vscode.ExtensionContext
  ) {
    this.client = new Anthropic({ apiKey });
    this.credentialManager = new CredentialManager(context);
    this.browserTools = new BrowserTools();
    this.credentialTools = new CredentialTools(this.credentialManager);
    this.databaseTools = new DatabaseTools();
    this.dockerTools = new DockerTools();
    this.apiTools = new APITools();
    this.componentTools = new ComponentTools();
    this.outputChannel = vscode.window.createOutputChannel('Kilo Agent');
  }

  async initialize(): Promise<void> {
    await this.credentialManager.initialize();
    this.log('Kilo Agent initialized');
  }

  private getAllTools(): Anthropic.Tool[] {
    return [
      ...this.browserTools.getToolDefinitions(),
      ...this.credentialTools.getToolDefinitions(),
      ...this.databaseTools.getToolDefinitions(),
      ...this.dockerTools.getToolDefinitions(),
      ...this.apiTools.getToolDefinitions(),
      ...this.componentTools.getToolDefinitions()
    ];
  }

  async processMessage(userMessage: string): Promise<string> {
    this.conversationHistory.push({
      role: 'user',
      content: userMessage
    });

    let response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8096,
      system: SYSTEM_PROMPT,
      tools: this.getAllTools(),
      messages: this.conversationHistory
    });

    // Agentic loop - continue until no more tool calls
    while (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type === 'tool_use') {
          this.log(`Executing tool: ${block.name}`);
          
          let result: any;
          const toolName = block.name;
          const toolInput = block.input as Record<string, unknown>;

          // Route to appropriate tool handler
          if (toolName.startsWith('browser_')) {
            // Check for saved credentials before login
            if (toolName === 'browser_open' && toolInput.url) {
              const savedCred = await this.credentialManager.getByUrl(toolInput.url as string);
              if (savedCred) {
                this.log(`Found saved credentials for ${savedCred.name}`);
              }
            }
            result = await this.browserTools.executeTool(toolName, toolInput);
          } else if (toolName.startsWith('credential_')) {
            result = await this.credentialTools.executeTool(toolName, toolInput);
          } else if (toolName.startsWith('db_')) {
            result = await this.databaseTools.executeTool(toolName, toolInput);
          } else if (toolName.startsWith('docker_')) {
            result = await this.dockerTools.executeTool(toolName, toolInput);
          } else if (toolName.startsWith('api_')) {
            result = await this.apiTools.executeTool(toolName, toolInput);
          } else if (toolName.startsWith('component_')) {
            result = await this.componentTools.executeTool(toolName, toolInput);
          } else {
            result = { success: false, error: `Unknown tool category: ${toolName}` };
          }

          this.log(`Tool result: ${JSON.stringify(result).substring(0, 200)}...`);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result)
          });
        }
      }

      // Add assistant response and tool results to history
      this.conversationHistory.push({
        role: 'assistant',
        content: response.content
      });

      this.conversationHistory.push({
        role: 'user',
        content: toolResults
      });

      // Continue the conversation
      response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8096,
        system: SYSTEM_PROMPT,
        tools: this.getAllTools(),
        messages: this.conversationHistory
      });
    }

    // Extract final text response
    const textContent = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    this.conversationHistory.push({
      role: 'assistant',
      content: response.content
    });

    return textContent;
  }

  async clearHistory(): Promise<void> {
    this.conversationHistory = [];
    this.log('Conversation history cleared');
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
  }
}
```

## Step 7: Update Extension Entry Point

`src/extension.ts`:

```typescript
import * as vscode from 'vscode';
import { KiloAgent } from './agent/KiloAgent';

let agent: KiloAgent;
let chatPanel: vscode.WebviewPanel | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('kilo');
  const apiKey = config.get<string>('anthropicApiKey') || process.env.ANTHROPIC_API_KEY || '';

  agent = new KiloAgent(apiKey, context);
  await agent.initialize();

  // Main chat command
  context.subscriptions.push(
    vscode.commands.registerCommand('kilo.chat', async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'What would you like Kilo to help you with?',
        placeHolder: 'e.g., "Open my Oracle database and show me the users table"'
      });

      if (input) {
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'Kilo is working...',
          cancellable: false
        }, async () => {
          const response = await agent.processMessage(input);
          
          // Show response in output channel for full detail
          const outputChannel = vscode.window.createOutputChannel('Kilo Response');
          outputChannel.clear();
          outputChannel.appendLine(response);
          outputChannel.show();
          
          // Also show notification summary
          const summary = response.split('\n')[0];
          vscode.window.showInformationMessage(summary);
        });
      }
    })
  );

  // Quick action: Save credentials
  context.subscriptions.push(
    vscode.commands.registerCommand('kilo.saveCredentials', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Credential name (e.g., "Production Oracle")' });
      if (!name) return;

      const type = await vscode.window.showQuickPick(
        ['oracle', 'cockpit', 'database', 'web', 'api', 'ssh'],
        { placeHolder: 'Credential type' }
      ) as any;
      if (!type) return;

      const url = await vscode.window.showInputBox({ prompt: 'URL or hostname' });
      const username = await vscode.window.showInputBox({ prompt: 'Username' });
      const password = await vscode.window.showInputBox({ prompt: 'Password', password: true });

      if (username && password) {
        await agent.processMessage(
          `Save credentials: name="${name}", type="${type}", url="${url}", username="${username}", password="${password}"`
        );
        vscode.window.showInformationMessage(`Credentials saved for ${name}`);
      }
    })
  );

  // Quick action: Open Cockpit
  context.subscriptions.push(
    vscode.commands.registerCommand('kilo.openCockpit', async () => {
      const url = await vscode.window.showInputBox({
        prompt: 'Cockpit URL',
        value: 'https://localhost:9090'
      });
      
      if (url) {
        const response = await agent.processMessage(
          `Open Cockpit at ${url}. Check if I have saved credentials for it and log in automatically. Then describe the system status.`
        );
        vscode.window.showInformationMessage(response.split('\n')[0]);
      }
    })
  );

  // Quick action: Open Oracle
  context.subscriptions.push(
    vscode.commands.registerCommand('kilo.openOracle', async () => {
      const url = await vscode.window.showInputBox({ prompt: 'Oracle URL (APEX, EM, or ORDS)' });
      
      if (url) {
        const response = await agent.processMessage(
          `Open Oracle at ${url}. Check if I have saved credentials and log in. Describe what you see and what I can do.`
        );
        vscode.window.showInformationMessage(response.split('\n')[0]);
      }
    })
  );

  // Quick action: Query database
  context.subscriptions.push(
    vscode.commands.registerCommand('kilo.queryDatabase', async () => {
      const credName = await vscode.window.showInputBox({ prompt: 'Which saved database credentials to use?' });
      const query = await vscode.window.showInputBox({ prompt: 'SQL query to run' });
      
      if (credName && query) {
        const response = await agent.processMessage(
          `Get my saved credentials called "${credName}" and run this query: ${query}. Read me the results clearly.`
        );
        
        const outputChannel = vscode.window.createOutputChannel('Query Results');
        outputChannel.clear();
        outputChannel.appendLine(response);
        outputChannel.show();
      }
    })
  );

  // Quick action: Docker status
  context.subscriptions.push(
    vscode.commands.registerCommand('kilo.dockerStatus', async () => {
      const response = await agent.processMessage(
        'List all Docker containers and their status. Tell me if any need attention.'
      );
      vscode.window.showInformationMessage(response);
    })
  );

  vscode.window.showInformationMessage('Kilo Full-Stack Assistant is ready!');
}

export function deactivate() {
  // Cleanup
}
```

## Step 8: Package.json Updates

```json
{
  "name": "kilo-fullstack-assistant",
  "displayName": "Kilo - Full-Stack AI Assistant",
  "description": "AI-powered full-stack development assistant with browser automation and accessibility focus",
  "version": "1.0.0",
  "engines": {
    "vscode": "^1.80.0"
  },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      { "command": "kilo.chat", "title": "Kilo: Chat" },
      { "command": "kilo.saveCredentials", "title": "Kilo: Save Credentials" },
      { "command": "kilo.openCockpit", "title": "Kilo: Open Cockpit" },
      { "command": "kilo.openOracle", "title": "Kilo: Open Oracle" },
      { "command": "kilo.queryDatabase", "title": "Kilo: Query Database" },
      { "command": "kilo.dockerStatus", "title": "Kilo: Docker Status" }
    ],
    "configuration": {
      "title": "Kilo",
      "properties": {
        "kilo.anthropicApiKey": {
          "type": "string",
          "default": "",
          "description": "Anthropic API key for Claude"
        }
      }
    },
    "keybindings": [
      {
        "command": "kilo.chat",
        "key": "ctrl+shift+k",
        "mac": "cmd+shift+k"
      }
    ]
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "playwright": "^1.40.0",
    "node-fetch": "^2.7.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.80.0",
    "typescript": "^5.0.0",
    "esbuild": "^0.19.0"
  }
}
```

## Usage Examples

### Save and Use Credentials
```
User: "Save my Oracle credentials - name it 'Production DB', the URL is https://oracle.company.com/apex, username is admin"
Kilo: "I'll save those credentials. Please provide the password securely."
[VS Code password prompt appears]
Kilo: "Credentials saved for 'Production DB'. I'll use these automatically when you access that URL."
```

### Full-Stack Workflow
```
User: "Open my production Oracle, check the USERS table for anyone created today, then check if the auth service container is running"

Kilo: "I'll help you with that. Let me:
1. Open Oracle using your saved 'Production DB' credentials
2. Query the USERS table
3. Check Docker containers

Opening Oracle now...
[Logs in automatically]

I'm on the Oracle APEX home page. Navigating to SQL Workshop...
Running query: SELECT * FROM USERS WHERE CREATED_DATE = TRUNC(SYSDATE)

## Query Results:
Found 3 new users today:
| ID | USERNAME | EMAIL | CREATED_DATE |
| 1042 | john.smith | john@email.com | 2024-01-15 |
| 1043 | jane.doe | jane@email.com | 2024-01-15 |
| 1044 | bob.wilson | bob@email.com | 2024-01-15 |

Now checking Docker...

## Docker Containers:
✅ auth-service: Running (Up 3 days)
✅ api-gateway: Running (Up 3 days)  
⚠️ logging-service: Exited (1 hour ago)

The auth service is running fine, but I notice the logging service has stopped. 
Would you like me to restart it?"
```

This gives you a complete full-stack assistant that's your "Gordon Ramsay" of development - handling frontend, backend, databases, Docker, and web automation while keeping everything accessible! 🎯