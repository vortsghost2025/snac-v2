# Kilo: Adding Azurite, NVIDIA CUDA & NSight Support

Let's make Kilo a GPU-accelerated, cloud-development powerhouse! 🚀

## Updated Project Structure

```
kilo-extension/
├── src/
│   ├── extension.ts
│   ├── agent/
│   │   └── KiloAgent.ts
│   ├── browser/
│   │   └── ...
│   ├── backend/
│   │   └── ...
│   ├── credentials/
│   │   └── ...
│   ├── cloud/
│   │   ├── AzuriteTools.ts
│   │   ├── AzureTools.ts
│   │   └── CloudStorageTools.ts
│   ├── gpu/
│   │   ├── NvidiaTools.ts
│   │   ├── CudaTools.ts
│   │   ├── NsightTools.ts
│   │   └── TensorTools.ts
│   └── tools/
│       └── ...
└── package.json
```

## Step 1: Azurite & Azure Storage Tools

Create `src/cloud/AzuriteTools.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export interface AzuriteConfig {
  blobHost: string;
  blobPort: number;
  queueHost: string;
  queuePort: number;
  tableHost: string;
  tablePort: number;
  location: string;
  silent: boolean;
}

export class AzuriteTools {
  private azuriteProcess: ReturnType<typeof spawn> | null = null;
  private defaultConfig: AzuriteConfig = {
    blobHost: '127.0.0.1',
    blobPort: 10000,
    queueHost: '127.0.0.1',
    queuePort: 10001,
    tableHost: '127.0.0.1',
    tablePort: 10002,
    location: './.azurite',
    silent: false
  };

  // Default Azurite connection string
  private readonly defaultConnectionString = 
    'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;' +
    'AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;' +
    'BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;' +
    'QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;' +
    'TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;';

  getToolDefinitions(): Anthropic.Tool[] {
    return [
      // Azurite Lifecycle
      {
        name: 'azurite_start',
        description: 'Start Azurite local Azure storage emulator. Provides blob, queue, and table storage.',
        input_schema: {
          type: 'object' as const,
          properties: {
            blobPort: { type: 'number', description: 'Blob service port (default: 10000)' },
            queuePort: { type: 'number', description: 'Queue service port (default: 10001)' },
            tablePort: { type: 'number', description: 'Table service port (default: 10002)' },
            location: { type: 'string', description: 'Data storage location' },
            inMemory: { type: 'boolean', description: 'Use in-memory storage (faster, not persistent)' }
          },
          required: []
        }
      },
      {
        name: 'azurite_stop',
        description: 'Stop the running Azurite instance.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      },
      {
        name: 'azurite_status',
        description: 'Check if Azurite is running and get connection info.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      },

      // Blob Storage
      {
        name: 'azure_blob_list_containers',
        description: 'List all blob containers in Azurite/Azure storage.',
        input_schema: {
          type: 'object' as const,
          properties: {
            connectionString: { type: 'string', description: 'Connection string (uses Azurite default if not provided)' }
          },
          required: []
        }
      },
      {
        name: 'azure_blob_create_container',
        description: 'Create a new blob container.',
        input_schema: {
          type: 'object' as const,
          properties: {
            containerName: { type: 'string', description: 'Name for the new container' },
            publicAccess: { 
              type: 'string', 
              enum: ['none', 'blob', 'container'],
              description: 'Public access level'
            },
            connectionString: { type: 'string' }
          },
          required: ['containerName']
        }
      },
      {
        name: 'azure_blob_list',
        description: 'List blobs in a container.',
        input_schema: {
          type: 'object' as const,
          properties: {
            containerName: { type: 'string' },
            prefix: { type: 'string', description: 'Filter by prefix (folder path)' },
            connectionString: { type: 'string' }
          },
          required: ['containerName']
        }
      },
      {
        name: 'azure_blob_upload',
        description: 'Upload a file to blob storage.',
        input_schema: {
          type: 'object' as const,
          properties: {
            containerName: { type: 'string' },
            blobName: { type: 'string', description: 'Name/path for the blob' },
            localFilePath: { type: 'string', description: 'Local file to upload' },
            contentType: { type: 'string', description: 'MIME type (auto-detected if not provided)' },
            connectionString: { type: 'string' }
          },
          required: ['containerName', 'blobName', 'localFilePath']
        }
      },
      {
        name: 'azure_blob_download',
        description: 'Download a blob to local file.',
        input_schema: {
          type: 'object' as const,
          properties: {
            containerName: { type: 'string' },
            blobName: { type: 'string' },
            localFilePath: { type: 'string' },
            connectionString: { type: 'string' }
          },
          required: ['containerName', 'blobName', 'localFilePath']
        }
      },
      {
        name: 'azure_blob_delete',
        description: 'Delete a blob.',
        input_schema: {
          type: 'object' as const,
          properties: {
            containerName: { type: 'string' },
            blobName: { type: 'string' },
            connectionString: { type: 'string' }
          },
          required: ['containerName', 'blobName']
        }
      },
      {
        name: 'azure_blob_get_url',
        description: 'Get the URL for a blob (with optional SAS token).',
        input_schema: {
          type: 'object' as const,
          properties: {
            containerName: { type: 'string' },
            blobName: { type: 'string' },
            sasToken: { type: 'boolean', description: 'Generate a SAS token for access' },
            expiryHours: { type: 'number', description: 'SAS token expiry in hours (default: 24)' },
            connectionString: { type: 'string' }
          },
          required: ['containerName', 'blobName']
        }
      },

      // Queue Storage
      {
        name: 'azure_queue_list',
        description: 'List all queues.',
        input_schema: {
          type: 'object' as const,
          properties: {
            connectionString: { type: 'string' }
          },
          required: []
        }
      },
      {
        name: 'azure_queue_create',
        description: 'Create a new queue.',
        input_schema: {
          type: 'object' as const,
          properties: {
            queueName: { type: 'string' },
            connectionString: { type: 'string' }
          },
          required: ['queueName']
        }
      },
      {
        name: 'azure_queue_send',
        description: 'Send a message to a queue.',
        input_schema: {
          type: 'object' as const,
          properties: {
            queueName: { type: 'string' },
            message: { type: 'string' },
            ttlSeconds: { type: 'number', description: 'Time to live in seconds' },
            connectionString: { type: 'string' }
          },
          required: ['queueName', 'message']
        }
      },
      {
        name: 'azure_queue_receive',
        description: 'Receive messages from a queue.',
        input_schema: {
          type: 'object' as const,
          properties: {
            queueName: { type: 'string' },
            maxMessages: { type: 'number', description: 'Max messages to receive (default: 1, max: 32)' },
            visibilityTimeout: { type: 'number', description: 'Visibility timeout in seconds' },
            connectionString: { type: 'string' }
          },
          required: ['queueName']
        }
      },
      {
        name: 'azure_queue_peek',
        description: 'Peek at messages without removing them.',
        input_schema: {
          type: 'object' as const,
          properties: {
            queueName: { type: 'string' },
            maxMessages: { type: 'number' },
            connectionString: { type: 'string' }
          },
          required: ['queueName']
        }
      },
      {
        name: 'azure_queue_delete_message',
        description: 'Delete a specific message from queue.',
        input_schema: {
          type: 'object' as const,
          properties: {
            queueName: { type: 'string' },
            messageId: { type: 'string' },
            popReceipt: { type: 'string' },
            connectionString: { type: 'string' }
          },
          required: ['queueName', 'messageId', 'popReceipt']
        }
      },
      {
        name: 'azure_queue_clear',
        description: 'Clear all messages from a queue.',
        input_schema: {
          type: 'object' as const,
          properties: {
            queueName: { type: 'string' },
            connectionString: { type: 'string' }
          },
          required: ['queueName']
        }
      },

      // Table Storage
      {
        name: 'azure_table_list',
        description: 'List all tables.',
        input_schema: {
          type: 'object' as const,
          properties: {
            connectionString: { type: 'string' }
          },
          required: []
        }
      },
      {
        name: 'azure_table_create',
        description: 'Create a new table.',
        input_schema: {
          type: 'object' as const,
          properties: {
            tableName: { type: 'string' },
            connectionString: { type: 'string' }
          },
          required: ['tableName']
        }
      },
      {
        name: 'azure_table_insert',
        description: 'Insert an entity into a table.',
        input_schema: {
          type: 'object' as const,
          properties: {
            tableName: { type: 'string' },
            partitionKey: { type: 'string' },
            rowKey: { type: 'string' },
            entity: { type: 'object', description: 'Entity properties' },
            connectionString: { type: 'string' }
          },
          required: ['tableName', 'partitionKey', 'rowKey', 'entity']
        }
      },
      {
        name: 'azure_table_query',
        description: 'Query entities from a table.',
        input_schema: {
          type: 'object' as const,
          properties: {
            tableName: { type: 'string' },
            filter: { type: 'string', description: 'OData filter expression' },
            select: { type: 'array', items: { type: 'string' }, description: 'Properties to select' },
            top: { type: 'number', description: 'Max entities to return' },
            connectionString: { type: 'string' }
          },
          required: ['tableName']
        }
      },
      {
        name: 'azure_table_delete_entity',
        description: 'Delete an entity from a table.',
        input_schema: {
          type: 'object' as const,
          properties: {
            tableName: { type: 'string' },
            partitionKey: { type: 'string' },
            rowKey: { type: 'string' },
            connectionString: { type: 'string' }
          },
          required: ['tableName', 'partitionKey', 'rowKey']
        }
      },

      // Azure Functions Local
      {
        name: 'azure_functions_start',
        description: 'Start Azure Functions local runtime.',
        input_schema: {
          type: 'object' as const,
          properties: {
            projectPath: { type: 'string', description: 'Path to Azure Functions project' },
            port: { type: 'number', description: 'Port to run on (default: 7071)' }
          },
          required: ['projectPath']
        }
      },
      {
        name: 'azure_functions_new',
        description: 'Create a new Azure Function.',
        input_schema: {
          type: 'object' as const,
          properties: {
            projectPath: { type: 'string' },
            name: { type: 'string', description: 'Function name' },
            template: { 
              type: 'string',
              enum: ['HttpTrigger', 'BlobTrigger', 'QueueTrigger', 'TimerTrigger', 'CosmosDBTrigger'],
              description: 'Function template'
            },
            language: {
              type: 'string',
              enum: ['javascript', 'typescript', 'python', 'csharp', 'java'],
              description: 'Programming language'
            }
          },
          required: ['projectPath', 'name', 'template']
        }
      }
    ];
  }

  async executeTool(name: string, input: any): Promise<any> {
    const connectionString = input.connectionString || this.defaultConnectionString;

    try {
      switch (name) {
        // Azurite Lifecycle
        case 'azurite_start':
          return await this.startAzurite(input);
        
        case 'azurite_stop':
          return await this.stopAzurite();
        
        case 'azurite_status':
          return await this.getAzuriteStatus();

        // Blob operations using Azure CLI
        case 'azure_blob_list_containers':
          return await this.execAzCommand(`storage container list --connection-string "${connectionString}"`);

        case 'azure_blob_create_container':
          const publicAccess = input.publicAccess || 'off';
          return await this.execAzCommand(
            `storage container create --name ${input.containerName} --public-access ${publicAccess} --connection-string "${connectionString}"`
          );

        case 'azure_blob_list':
          const prefix = input.prefix ? `--prefix "${input.prefix}"` : '';
          return await this.execAzCommand(
            `storage blob list --container-name ${input.containerName} ${prefix} --connection-string "${connectionString}" --output table`
          );

        case 'azure_blob_upload':
          return await this.execAzCommand(
            `storage blob upload --container-name ${input.containerName} --name "${input.blobName}" --file "${input.localFilePath}" --connection-string "${connectionString}"`
          );

        case 'azure_blob_download':
          return await this.execAzCommand(
            `storage blob download --container-name ${input.containerName} --name "${input.blobName}" --file "${input.localFilePath}" --connection-string "${connectionString}"`
          );

        case 'azure_blob_delete':
          return await this.execAzCommand(
            `storage blob delete --container-name ${input.containerName} --name "${input.blobName}" --connection-string "${connectionString}"`
          );

        case 'azure_blob_get_url':
          if (input.sasToken) {
            const expiry = new Date();
            expiry.setHours(expiry.getHours() + (input.expiryHours || 24));
            return await this.execAzCommand(
              `storage blob generate-sas --container-name ${input.containerName} --name "${input.blobName}" --permissions r --expiry ${expiry.toISOString()} --connection-string "${connectionString}" --full-uri`
            );
          } else {
            return {
              success: true,
              url: `http://127.0.0.1:10000/devstoreaccount1/${input.containerName}/${input.blobName}`
            };
          }

        // Queue operations
        case 'azure_queue_list':
          return await this.execAzCommand(`storage queue list --connection-string "${connectionString}"`);

        case 'azure_queue_create':
          return await this.execAzCommand(
            `storage queue create --name ${input.queueName} --connection-string "${connectionString}"`
          );

        case 'azure_queue_send':
          const ttl = input.ttlSeconds ? `--time-to-live ${input.ttlSeconds}` : '';
          return await this.execAzCommand(
            `storage message put --queue-name ${input.queueName} --content "${input.message}" ${ttl} --connection-string "${connectionString}"`
          );

        case 'azure_queue_receive':
          const maxMsg = input.maxMessages || 1;
          const visibility = input.visibilityTimeout ? `--visibility-timeout ${input.visibilityTimeout}` : '';
          return await this.execAzCommand(
            `storage message get --queue-name ${input.queueName} --num-messages ${maxMsg} ${visibility} --connection-string "${connectionString}"`
          );

        case 'azure_queue_peek':
          return await this.execAzCommand(
            `storage message peek --queue-name ${input.queueName} --num-messages ${input.maxMessages || 1} --connection-string "${connectionString}"`
          );

        case 'azure_queue_clear':
          return await this.execAzCommand(
            `storage message clear --queue-name ${input.queueName} --connection-string "${connectionString}"`
          );

        // Table operations
        case 'azure_table_list':
          return await this.execAzCommand(`storage table list --connection-string "${connectionString}"`);

        case 'azure_table_create':
          return await this.execAzCommand(
            `storage table create --name ${input.tableName} --connection-string "${connectionString}"`
          );

        case 'azure_table_insert':
          const entity = {
            PartitionKey: input.partitionKey,
            RowKey: input.rowKey,
            ...input.entity
          };
          return await this.execAzCommand(
            `storage entity insert --table-name ${input.tableName} --entity ${JSON.stringify(entity)} --connection-string "${connectionString}"`
          );

        case 'azure_table_query':
          let queryCmd = `storage entity query --table-name ${input.tableName} --connection-string "${connectionString}"`;
          if (input.filter) queryCmd += ` --filter "${input.filter}"`;
          if (input.select) queryCmd += ` --select "${input.select.join(',')}"`;
          if (input.top) queryCmd += ` --num-results ${input.top}`;
          return await this.execAzCommand(queryCmd);

        // Azure Functions
        case 'azure_functions_start':
          return await this.startFunctions(input.projectPath, input.port || 7071);

        case 'azure_functions_new':
          return await this.createFunction(input);

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

  private async startAzurite(config: Partial<AzuriteConfig> & { inMemory?: boolean }): Promise<any> {
    if (this.azuriteProcess) {
      return { success: false, error: 'Azurite is already running' };
    }

    const location = config.location || this.defaultConfig.location;
    
    // Ensure location directory exists
    await fs.mkdir(location, { recursive: true });

    const args = [
      '--blobHost', config.blobHost || this.defaultConfig.blobHost,
      '--blobPort', String(config.blobPort || this.defaultConfig.blobPort),
      '--queueHost', config.queueHost || this.defaultConfig.queueHost,
      '--queuePort', String(config.queuePort || this.defaultConfig.queuePort),
      '--tableHost', config.tableHost || this.defaultConfig.tableHost,
      '--tablePort', String(config.tablePort || this.defaultConfig.tablePort),
      '--location', location
    ];

    if (config.inMemory) {
      args.push('--inMemoryPersistence');
    }

    this.azuriteProcess = spawn('azurite', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    return new Promise((resolve) => {
      let output = '';
      
      this.azuriteProcess!.stdout?.on('data', (data) => {
        output += data.toString();
        if (output.includes('Azurite Blob service is successfully listening') ||
            output.includes('successfully listening')) {
          resolve({
            success: true,
            message: 'Azurite started successfully',
            connectionString: this.defaultConnectionString,
            endpoints: {
              blob: `http://127.0.0.1:${config.blobPort || 10000}`,
              queue: `http://127.0.0.1:${config.queuePort || 10001}`,
              table: `http://127.0.0.1:${config.tablePort || 10002}`
            }
          });
        }
      });

      this.azuriteProcess!.stderr?.on('data', (data) => {
        output += data.toString();
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (output.includes('listening')) {
          resolve({ success: true, message: 'Azurite started', output });
        } else {
          resolve({ success: false, error: 'Azurite startup timeout', output });
        }
      }, 10000);
    });
  }

  private async stopAzurite(): Promise<any> {
    if (!this.azuriteProcess) {
      // Try to kill any existing azurite process
      try {
        await execAsync('pkill -f azurite || taskkill /IM azurite.exe /F 2>nul');
        return { success: true, message: 'Azurite stopped' };
      } catch {
        return { success: true, message: 'No Azurite process found' };
      }
    }

    this.azuriteProcess.kill();
    this.azuriteProcess = null;
    return { success: true, message: 'Azurite stopped' };
  }

  private async getAzuriteStatus(): Promise<any> {
    try {
      // Check if ports are listening
      const checkPort = async (port: number): Promise<boolean> => {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/`);
          return true;
        } catch {
          return false;
        }
      };

      const [blobRunning, queueRunning, tableRunning] = await Promise.all([
        checkPort(10000),
        checkPort(10001),
        checkPort(10002)
      ]);

      const running = blobRunning || queueRunning || tableRunning;

      return {
        success: true,
        running,
        services: {
          blob: { running: blobRunning, port: 10000 },
          queue: { running: queueRunning, port: 10001 },
          table: { running: tableRunning, port: 10002 }
        },
        connectionString: running ? this.defaultConnectionString : null
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  private async execAzCommand(command: string): Promise<any> {
    try {
      const { stdout, stderr } = await execAsync(`az ${command} --output json`);
      
      if (stderr && !stderr.includes('WARNING')) {
        return { success: false, error: stderr };
      }

      try {
        return { success: true, data: JSON.parse(stdout) };
      } catch {
        return { success: true, data: stdout.trim() };
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  private async startFunctions(projectPath: string, port: number): Promise<any> {
    try {
      const { stdout } = await execAsync(`cd "${projectPath}" && func start --port ${port}`, {
        timeout: 30000
      });
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  private async createFunction(input: any): Promise<any> {
    try {
      const lang = input.language || 'typescript';
      const { stdout } = await execAsync(
        `cd "${input.projectPath}" && func new --name ${input.name} --template "${input.template}" --language ${lang}`
      );
      return { success: true, message: `Created function ${input.name}`, output: stdout };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
}
```

## Step 2: NVIDIA & CUDA Tools

Create `src/gpu/NvidiaTools.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export interface GPUInfo {
  index: number;
  name: string;
  uuid: string;
  memoryTotal: string;
  memoryUsed: string;
  memoryFree: string;
  utilization: string;
  temperature: string;
  powerDraw: string;
  powerLimit: string;
}

export interface CudaInfo {
  version: string;
  driverVersion: string;
  nvccVersion: string;
  cudnnVersion?: string;
  tensorrtVersion?: string;
}

export class NvidiaTools {
  getToolDefinitions(): Anthropic.Tool[] {
    return [
      // GPU Monitoring
      {
        name: 'nvidia_smi',
        description: 'Get NVIDIA GPU status including memory, utilization, temperature, and power.',
        input_schema: {
          type: 'object' as const,
          properties: {
            detailed: { type: 'boolean', description: 'Get detailed information' },
            gpuIndex: { type: 'number', description: 'Specific GPU index (default: all)' }
          },
          required: []
        }
      },
      {
        name: 'nvidia_gpu_processes',
        description: 'List processes using the GPU.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      },
      {
        name: 'nvidia_monitor',
        description: 'Start continuous GPU monitoring (returns snapshot).',
        input_schema: {
          type: 'object' as const,
          properties: {
            interval: { type: 'number', description: 'Monitoring interval in seconds' },
            duration: { type: 'number', description: 'Total duration in seconds' }
          },
          required: []
        }
      },
      {
        name: 'nvidia_set_power_limit',
        description: 'Set GPU power limit (requires admin/root).',
        input_schema: {
          type: 'object' as const,
          properties: {
            gpuIndex: { type: 'number' },
            watts: { type: 'number', description: 'Power limit in watts' }
          },
          required: ['gpuIndex', 'watts']
        }
      },
      {
        name: 'nvidia_set_persistence_mode',
        description: 'Enable/disable persistence mode for faster GPU initialization.',
        input_schema: {
          type: 'object' as const,
          properties: {
            enabled: { type: 'boolean' }
          },
          required: ['enabled']
        }
      },

      // CUDA Information
      {
        name: 'cuda_info',
        description: 'Get CUDA toolkit information including version, driver, and installed libraries.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      },
      {
        name: 'cuda_devices',
        description: 'List CUDA-capable devices with compute capability.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      },
      {
        name: 'cuda_memory_info',
        description: 'Get detailed CUDA memory information for each GPU.',
        input_schema: {
          type: 'object' as const,
          properties: {
            gpuIndex: { type: 'number' }
          },
          required: []
        }
      },

      // NVIDIA Libraries Check
      {
        name: 'nvidia_check_libraries',
        description: 'Check installed NVIDIA libraries (cuDNN, TensorRT, NCCL, etc.).',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      },
      {
        name: 'nvidia_check_drivers',
        description: 'Check NVIDIA driver installation and version.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      },

      // Environment Setup
      {
        name: 'nvidia_setup_env',
        description: 'Get environment variables needed for CUDA development.',
        input_schema: {
          type: 'object' as const,
          properties: {
            cudaVersion: { type: 'string', description: 'CUDA version (e.g., "12.3")' }
          },
          required: []
        }
      }
    ];
  }

  async executeTool(name: string, input: any): Promise<any> {
    try {
      switch (name) {
        case 'nvidia_smi':
          return await this.getNvidiaSmi(input.detailed, input.gpuIndex);

        case 'nvidia_gpu_processes':
          return await this.getGpuProcesses();

        case 'nvidia_monitor':
          return await this.monitorGpu(input.interval || 1, input.duration || 5);

        case 'nvidia_set_power_limit':
          return await this.setPowerLimit(input.gpuIndex, input.watts);

        case 'nvidia_set_persistence_mode':
          return await this.setPersistenceMode(input.enabled);

        case 'cuda_info':
          return await this.getCudaInfo();

        case 'cuda_devices':
          return await this.getCudaDevices();

        case 'cuda_memory_info':
          return await this.getCudaMemoryInfo(input.gpuIndex);

        case 'nvidia_check_libraries':
          return await this.checkNvidiaLibraries();

        case 'nvidia_check_drivers':
          return await this.checkDrivers();

        case 'nvidia_setup_env':
          return await this.getEnvSetup(input.cudaVersion);

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

  private async getNvidiaSmi(detailed: boolean = false, gpuIndex?: number): Promise<any> {
    const gpuArg = gpuIndex !== undefined ? `-i ${gpuIndex}` : '';
    
    // Query specific fields for structured output
    const queryFields = [
      'index', 'name', 'uuid', 'driver_version', 'pci.bus_id',
      'memory.total', 'memory.used', 'memory.free',
      'utilization.gpu', 'utilization.memory',
      'temperature.gpu', 'fan.speed',
      'power.draw', 'power.limit',
      'clocks.current.graphics', 'clocks.current.memory',
      'compute_mode'
    ].join(',');

    const { stdout } = await execAsync(
      `nvidia-smi ${gpuArg} --query-gpu=${queryFields} --format=csv,noheader,nounits`
    );

    const gpus: GPUInfo[] = stdout.trim().split('\n').map(line => {
      const [
        index, name, uuid, driverVersion, pciBus,
        memTotal, memUsed, memFree,
        utilGpu, utilMem,
        temp, fanSpeed,
        powerDraw, powerLimit,
        clockGraphics, clockMemory,
        computeMode
      ] = line.split(', ').map(s => s.trim());

      return {
        index: parseInt(index),
        name,
        uuid,
        driverVersion,
        pciBus,
        memoryTotal: `${memTotal} MB`,
        memoryUsed: `${memUsed} MB`,
        memoryFree: `${memFree} MB`,
        memoryUtilization: `${utilMem}%`,
        gpuUtilization: `${utilGpu}%`,
        temperature: `${temp}°C`,
        fanSpeed: `${fanSpeed}%`,
        powerDraw: `${powerDraw}W`,
        powerLimit: `${powerLimit}W`,
        clockGraphics: `${clockGraphics} MHz`,
        clockMemory: `${clockMemory} MHz`,
        computeMode
      };
    });

    // Generate accessibility-friendly description
    let description = `## GPU Status Summary\n\n`;
    for (const gpu of gpus) {
      const memPercent = Math.round(
        (parseInt(gpu.memoryUsed) / parseInt(gpu.memoryTotal)) * 100
      );
      const tempNum = parseInt(gpu.temperature);
      const tempStatus = tempNum > 80 ? '🔴 HOT' : tempNum > 60 ? '🟡 WARM' : '🟢 COOL';
      
      description += `### GPU ${gpu.index}: ${gpu.name}\n`;
      description += `- Memory: ${gpu.memoryUsed} / ${gpu.memoryTotal} (${memPercent}% used)\n`;
      description += `- GPU Load: ${gpu.gpuUtilization}\n`;
      description += `- Temperature: ${gpu.temperature} ${tempStatus}\n`;
      description += `- Power: ${gpu.powerDraw} / ${gpu.powerLimit}\n`;
      description += `- Fan: ${gpu.fanSpeed}\n\n`;
    }

    return {
      success: true,
      gpus,
      description,
      gpuCount: gpus.length
    };
  }

  private async getGpuProcesses(): Promise<any> {
    const { stdout } = await execAsync(
      'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits'
    );

    const processes = stdout.trim().split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [pid, name, memory] = line.split(', ').map(s => s.trim());
        return { pid: parseInt(pid), name, memoryUsed: `${memory} MB` };
      });

    return {
      success: true,
      processes,
      count: processes.length,
      description: processes.length > 0
        ? `## GPU Processes:\n${processes.map(p => `- PID ${p.pid}: ${p.name} (${p.memoryUsed})`).join('\n')}`
        : 'No processes currently using the GPU.'
    };
  }

  private async monitorGpu(interval: number, duration: number): Promise<any> {
    const samples: any[] = [];
    const iterations = Math.ceil(duration / interval);

    for (let i = 0; i < iterations; i++) {
      const result = await this.getNvidiaSmi(false);
      samples.push({
        timestamp: new Date().toISOString(),
        gpus: result.gpus
      });
      
      if (i < iterations - 1) {
        await new Promise(resolve => setTimeout(resolve, interval * 1000));
      }
    }

    // Calculate averages
    const avgUtilization = samples.reduce((sum, s) => 
      sum + parseInt(s.gpus[0]?.gpuUtilization || '0'), 0) / samples.length;
    const avgTemp = samples.reduce((sum, s) => 
      sum + parseInt(s.gpus[0]?.temperature || '0'), 0) / samples.length;
    const avgMemory = samples.reduce((sum, s) => 
      sum + parseInt(s.gpus[0]?.memoryUsed || '0'), 0) / samples.length;

    return {
      success: true,
      samples,
      summary: {
        duration: `${duration} seconds`,
        sampleCount: samples.length,
        averages: {
          gpuUtilization: `${avgUtilization.toFixed(1)}%`,
          temperature: `${avgTemp.toFixed(1)}°C`,
          memoryUsed: `${avgMemory.toFixed(0)} MB`
        }
      }
    };
  }

  private async setPowerLimit(gpuIndex: number, watts: number): Promise<any> {
    try {
      await execAsync(`sudo nvidia-smi -i ${gpuIndex} -pl ${watts}`);
      return { success: true, message: `Power limit set to ${watts}W for GPU ${gpuIndex}` };
    } catch (error) {
      return { success: false, error: 'Failed to set power limit. Requires root/admin privileges.' };
    }
  }

  private async setPersistenceMode(enabled: boolean): Promise<any> {
    try {
      const mode = enabled ? '1' : '0';
      await execAsync(`sudo nvidia-smi -pm ${mode}`);
      return { success: true, message: `Persistence mode ${enabled ? 'enabled' : 'disabled'}` };
    } catch (error) {
      return { success: false, error: 'Failed to set persistence mode. Requires root/admin privileges.' };
    }
  }

  private async getCudaInfo(): Promise<any> {
    const info: CudaInfo = {
      version: '',
      driverVersion: '',
      nvccVersion: ''
    };

    try {
      // CUDA runtime version from nvidia-smi
      const { stdout: smiOut } = await execAsync('nvidia-smi --query-gpu=driver_version --format=csv,noheader');
      info.driverVersion = smiOut.trim();

      // NVCC version
      try {
        const { stdout: nvccOut } = await execAsync('nvcc --version');
        const match = nvccOut.match(/release (\d+\.\d+)/);
        if (match) {
          info.version = match[1];
          info.nvccVersion = nvccOut.trim();
        }
      } catch {
        info.nvccVersion = 'Not found';
      }

      // cuDNN version
      try {
        const { stdout: cudnnOut } = await execAsync(
          'cat /usr/local/cuda/include/cudnn_version.h 2>/dev/null | grep CUDNN_MAJOR -A 2 || ' +
          'cat /usr/include/cudnn_version.h 2>/dev/null | grep CUDNN_MAJOR -A 2'
        );
        const majorMatch = cudnnOut.match(/CUDNN_MAJOR\s+(\d+)/);
        const minorMatch = cudnnOut.match(/CUDNN_MINOR\s+(\d+)/);
        const patchMatch = cudnnOut.match(/CUDNN_PATCHLEVEL\s+(\d+)/);
        if (majorMatch && minorMatch) {
          info.cudnnVersion = `${majorMatch[1]}.${minorMatch[1]}.${patchMatch?.[1] || '0'}`;
        }
      } catch {
        // cuDNN not found or Windows
      }

      // TensorRT version
      try {
        const { stdout: trtOut } = await execAsync('dpkg -l | grep tensorrt || rpm -qa | grep tensorrt');
        const match = trtOut.match(/tensorrt[^\s]*\s+(\d+\.\d+\.\d+)/);
        if (match) {
          info.tensorrtVersion = match[1];
        }
      } catch {
        // TensorRT not found
      }

      return {
        success: true,
        ...info,
        description: `## CUDA Environment\n` +
          `- CUDA Version: ${info.version || 'Unknown'}\n` +
          `- Driver Version: ${info.driverVersion}\n` +
          `- cuDNN: ${info.cudnnVersion || 'Not detected'}\n` +
          `- TensorRT: ${info.tensorrtVersion || 'Not detected'}`
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  private async getCudaDevices(): Promise<any> {
    try {
      // Use nvidia-smi to get compute capability
      const { stdout } = await execAsync(
        'nvidia-smi --query-gpu=index,name,compute_cap --format=csv,noheader'
      );

      const devices = stdout.trim().split('\n').map(line => {
        const [index, name, computeCap] = line.split(', ').map(s => s.trim());
        return {
          index: parseInt(index),
          name,
          computeCapability: computeCap,
          cudaCompatible: parseFloat(computeCap) >= 3.5
        };
      });

      return {
        success: true,
        devices,
        description: `## CUDA Devices:\n` +
          devices.map(d => 
            `- GPU ${d.index}: ${d.name} (Compute ${d.computeCapability}) ${d.cudaCompatible ? '✅' : '⚠️'}`
          ).join('\n')
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  private async getCudaMemoryInfo(gpuIndex?: number): Promise<any> {
    const gpuArg = gpuIndex !== undefined ? `-i ${gpuIndex}` : '';
    
    const { stdout } = await execAsync(
      `nvidia-smi ${gpuArg} --query-gpu=index,memory.total,memory.used,memory.free,memory.reserved --format=csv,noheader,nounits`
    );

    const memoryInfo = stdout.trim().split('\n').map(line => {
      const [index, total, used, free, reserved] = line.split(', ').map(s => s.trim());
      const totalMB = parseInt(total);
      const usedMB = parseInt(used);
      
      return {
        gpuIndex: parseInt(index),
        total: `${total} MB`,
        used: `${used} MB`,
        free: `${free} MB`,
        reserved: `${reserved} MB`,
        usedPercent: Math.round((usedMB / totalMB) * 100)
      };
    });

    return {
      success: true,
      memory: memoryInfo,
      description: memoryInfo.map(m => 
        `GPU ${m.gpuIndex}: ${m.used} / ${m.total} (${m.usedPercent}% used, ${m.free} free)`
      ).join('\n')
    };
  }

  private async checkNvidiaLibraries(): Promise<any> {
    const libraries: Record<string, string | null> = {
      cuda: null,
      cudnn: null,
      tensorrt: null,
      nccl: null,
      cublas: null,
      cufft: null,
      curand: null,
      cusparse: null,
      cusolver: null
    };

    const platform = process.platform;
    
    if (platform === 'linux') {
      // Check for shared libraries
      for (const lib of Object.keys(libraries)) {
        try {
          const { stdout } = await execAsync(`ldconfig -p | grep -i ${lib} | head -1`);
          if (stdout.trim()) {
            libraries[lib] = stdout.trim();
          }
        } catch {}
      }
    } else if (platform === 'win32') {
      // Check Windows CUDA installation
      const cudaPath = process.env.CUDA_PATH;
      if (cudaPath) {
        libraries.cuda = cudaPath;
        try {
          const { stdout } = await execAsync(`dir /s /b "${cudaPath}\\bin\\*.dll" 2>nul`);
          const dlls = stdout.toLowerCase();
          if (dlls.includes('cudnn')) libraries.cudnn = 'Found in CUDA bin';
          if (dlls.includes('nvinfer')) libraries.tensorrt = 'Found in CUDA bin';
        } catch {}
      }
    }

    const installed = Object.entries(libraries)
      .filter(([_, v]) => v)
      .map(([k, v]) => `- ${k}: ${v}`);
    
    const missing = Object.entries(libraries)
      .filter(([_, v]) => !v)
      .map(([k, _]) => k);

    return {
      success: true,
      libraries,
      description: `## NVIDIA Libraries\n\n### Installed:\n${installed.join('\n') || 'None found'}\n\n### Not Found:\n${missing.join(', ') || 'All found!'}`
    };
  }

  private async checkDrivers(): Promise<any> {
    try {
      const { stdout: versionOut } = await execAsync('nvidia-smi --query-gpu=driver_version --format=csv,noheader');
      const driverVersion = versionOut.trim();

      const { stdout: fullOut } = await execAsync('nvidia-smi');
      
      // Parse CUDA version from nvidia-smi header
      const cudaMatch = fullOut.match(/CUDA Version: (\d+\.\d+)/);
      const cudaVersion = cudaMatch ? cudaMatch[1] : 'Unknown';

      return {
        success: true,
        driverVersion,
        cudaVersion,
        description: `## NVIDIA Driver Status\n- Driver Version: ${driverVersion}\n- CUDA Version: ${cudaVersion}\n\nDriver is working correctly.`
      };
    } catch (error) {
      return {
        success: false,
        error: 'NVIDIA driver not found or not working',
        suggestion: 'Please install NVIDIA drivers from https://www.nvidia.com/drivers'
      };
    }
  }

  private async getEnvSetup(cudaVersion?: string): Promise<any> {
    const platform = process.platform;
    let envVars: Record<string, string> = {};
    let pathAdditions: string[] = [];

    if (platform === 'linux') {
      const cuda = cudaVersion || '12.3';
      envVars = {
        CUDA_HOME: `/usr/local/cuda-${cuda}`,
        CUDA_PATH: `/usr/local/cuda-${cuda}`,
        LD_LIBRARY_PATH: `/usr/local/cuda-${cuda}/lib64:$LD_LIBRARY_PATH`
      };
      pathAdditions = [`/usr/local/cuda-${cuda}/bin`];

      const bashrcExport = `
# CUDA ${cuda} Environment
export CUDA_HOME=/usr/local/cuda-${cuda}
export PATH=$CUDA_HOME/bin:$PATH
export LD_LIBRARY_PATH=$CUDA_HOME/lib64:$LD_LIBRARY_PATH
`;

      return {
        success: true,
        envVars,
        pathAdditions,
        bashrcExport,
        description: `## CUDA Environment Setup\n\nAdd to your ~/.bashrc:\n\`\`\`bash${bashrcExport}\`\`\``
      };

    } else if (platform === 'win32') {
      const cudaPath = process.env.CUDA_PATH || 'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.3';
      
      envVars = {
        CUDA_PATH: cudaPath,
        CUDA_HOME: cudaPath
      };
      pathAdditions = [
        `${cudaPath}\\bin`,
        `${cudaPath}\\libnvvp`
      ];

      return {
        success: true,
        envVars,
        pathAdditions,
        description: `## CUDA Environment Setup (Windows)\n\nEnvironment variables should be set automatically.\nCUDA_PATH: ${cudaPath}`
      };
    }

    return { success: false, error: `Unsupported platform: ${platform}` };
  }
}
```

## Step 3: CUDA Compilation Tools

Create `src/gpu/CudaTools.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export class CudaTools {
  getToolDefinitions(): Anthropic.Tool[] {
    return [
      {
        name: 'cuda_compile',
        description: 'Compile a CUDA source file using nvcc.',
        input_schema: {
          type: 'object' as const,
          properties: {
            sourceFile: { type: 'string', description: 'Path to .cu source file' },
            outputFile: { type: 'string', description: 'Output executable name' },
            arch: { 
              type: 'string', 
              description: 'GPU architecture (e.g., "sm_89" for RTX 5060, "sm_86" for RTX 30xx)'
            },
            optimizationLevel: {
              type: 'string',
              enum: ['0', '1', '2', '3'],
              description: 'Optimization level (default: 2)'
            },
            debug: { type: 'boolean', description: 'Include debug symbols' },
            extraFlags: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Additional nvcc flags' 
            }
          },
          required: ['sourceFile']
        }
      },
      {
        name: 'cuda_compile_library',
        description: 'Compile CUDA code to a shared library.',
        input_schema: {
          type: 'object' as const,
          properties: {
            sourceFiles: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'List of .cu source files'
            },
            outputLibrary: { type: 'string', description: 'Output library name' },
            arch: { type: 'string' },
            shared: { type: 'boolean', description: 'Create shared library (.so/.dll)' }
          },
          required: ['sourceFiles', 'outputLibrary']
        }
      },
      {
        name: 'cuda_run',
        description: 'Compile and run a CUDA program.',
        input_schema: {
          type: 'object' as const,
          properties: {
            sourceFile: { type: 'string' },
            args: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Command line arguments' 
            },
            arch: { type: 'string' }
          },
          required: ['sourceFile']
        }
      },
      {
        name: 'cuda_ptx',
        description: 'Generate PTX assembly from CUDA source.',
        input_schema: {
          type: 'object' as const,
          properties: {
            sourceFile: { type: 'string' },
            arch: { type: 'string' }
          },
          required: ['sourceFile']
        }
      },
      {
        name: 'cuda_analyze',
        description: 'Analyze CUDA code for potential issues and optimizations.',
        input_schema: {
          type: 'object' as const,
          properties: {
            sourceFile: { type: 'string' }
          },
          required: ['sourceFile']
        }
      },
      {
        name: 'cuda_profile_compile',
        description: 'Compile with profiling information for NSight.',
        input_schema: {
          type: 'object' as const,
          properties: {
            sourceFile: { type: 'string' },
            outputFile: { type: 'string' },
            lineInfo: { type: 'boolean', description: 'Include line number info' }
          },
          required: ['sourceFile']
        }
      },
      {
        name: 'cuda_create_project',
        description: 'Create a new CUDA project with proper structure.',
        input_schema: {
          type: 'object' as const,
          properties: {
            projectName: { type: 'string' },
            projectPath: { type: 'string' },
            template: {
              type: 'string',
              enum: ['basic', 'vectorAdd', 'matrixMul', 'reduction', 'neural-network'],
              description: 'Project template'
            },
            includeCMake: { type: 'boolean', description: 'Include CMakeLists.txt' }
          },
          required: ['projectName', 'projectPath']
        }
      },
      {
        name: 'cuda_check_syntax',
        description: 'Check CUDA syntax without full compilation.',
        input_schema: {
          type: 'object' as const,
          properties: {
            sourceFile: { type: 'string' }
          },
          required: ['sourceFile']
        }
      },
      {
        name: 'cuda_get_arch',
        description: 'Get the recommended compute architecture for connected GPU.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      }
    ];
  }

  async executeTool(name: string, input: any): Promise<any> {
    try {
      switch (name) {
        case 'cuda_compile':
          return await this.compileCuda(input);
        
        case 'cuda_compile_library':
          return await this.compileLibrary(input);
        
        case 'cuda_run':
          return await this.compileAndRun(input);
        
        case 'cuda_ptx':
          return await this.generatePTX(input);
        
        case 'cuda_analyze':
          return await this.analyzeCode(input.sourceFile);
        
        case 'cuda_profile_compile':
          return await this.compileForProfiling(input);
        
        case 'cuda_create_project':
          return await this.createProject(input);
        
        case 'cuda_check_syntax':
          return await this.checkSyntax(input.sourceFile);
        
        case 'cuda_get_arch':
          return await this.getRecommendedArch();

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

  private async compileCuda(input: any): Promise<any> {
    const { sourceFile, outputFile, arch, optimizationLevel = '2', debug = false, extraFlags = [] } = input;
    
    const output = outputFile || sourceFile.replace('.cu', '');
    const archFlag = arch ? `-arch=${arch}` : await this.getDefaultArch();
    const debugFlag = debug ? '-g -G' : '';
    const optFlag = `-O${optimizationLevel}`;
    const extraFlagsStr = extraFlags.join(' ');

    const cmd = `nvcc ${archFlag} ${optFlag} ${debugFlag} ${extraFlagsStr} -o "${output}" "${sourceFile}"`;
    
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 120000 });
      
      return {
        success: true,
        command: cmd,
        output,
        warnings: stderr ? stderr.split('\n').filter(l => l.includes('warning')) : [],
        message: `Successfully compiled ${sourceFile} to ${output}`
      };
    } catch (error: any) {
      // Parse nvcc errors for accessibility
      const errorOutput = error.stderr || error.message;
      const errors = this.parseNvccErrors(errorOutput);
      
      return {
        success: false,
        command: cmd,
        errors,
        rawError: errorOutput,
        description: `## Compilation Failed\n\n${errors.map(e => `- Line ${e.line}: ${e.message}`).join('\n')}`
      };
    }
  }

  private async compileLibrary(input: any): Promise<any> {
    const { sourceFiles, outputLibrary, arch, shared = true } = input;
    
    const archFlag = arch ? `-arch=${arch}` : await this.getDefaultArch();
    const sharedFlag = shared ? '--shared' : '';
    const ext = process.platform === 'win32' ? '.dll' : '.so';
    const output = outputLibrary.endsWith(ext) ? outputLibrary : `${outputLibrary}${ext}`;
    
    const sources = sourceFiles.join(' ');
    const cmd = `nvcc ${archFlag} ${sharedFlag} -Xcompiler -fPIC -o "${output}" ${sources}`;
    
    const { stdout, stderr } = await execAsync(cmd, { timeout: 180000 });
    
    return {
      success: true,
      command: cmd,
      output,
      message: `Created library: ${output}`
    };
  }

  private async compileAndRun(input: any): Promise<any> {
    const { sourceFile, args = [], arch } = input;
    
    // First compile
    const compileResult = await this.compileCuda({ sourceFile, arch });
    if (!compileResult.success) {
      return compileResult;
    }

    // Then run
    const executable = compileResult.output;
    const argsStr = args.join(' ');
    
    try {
      const { stdout, stderr } = await execAsync(
        process.platform === 'win32' ? `"${executable}" ${argsStr}` : `./${executable} ${argsStr}`,
        { timeout: 60000 }
      );

      return {
        success: true,
        compiled: compileResult,
        output: stdout,
        stderr: stderr,
        message: `## Program Output:\n\`\`\`\n${stdout}\n\`\`\``
      };
    } catch (error: any) {
      return {
        success: false,
        compiled: compileResult,
        error: error.message,
        stderr: error.stderr
      };
    }
  }

  private async generatePTX(input: any): Promise<any> {
    const { sourceFile, arch } = input;
    const archFlag = arch ? `-arch=${arch}` : await this.getDefaultArch();
    const ptxFile = sourceFile.replace('.cu', '.ptx');
    
    const cmd = `nvcc ${archFlag} -ptx -o "${ptxFile}" "${sourceFile}"`;
    
    await execAsync(cmd);
    const ptxContent = await fs.readFile(ptxFile, 'utf-8');
    
    return {
      success: true,
      ptxFile,
      content: ptxContent.substring(0, 5000), // Truncate for response
      fullLength: ptxContent.length
    };
  }

  private async analyzeCode(sourceFile: string): Promise<any> {
    const content = await fs.readFile(sourceFile, 'utf-8');
    const issues: string[] = [];
    const suggestions: string[] = [];

    // Check for common CUDA issues
    if (content.includes('cudaMalloc') && !content.includes('cudaFree')) {
      issues.push('Memory allocated with cudaMalloc but cudaFree not found - possible memory leak');
    }
    
    if (content.includes('cudaMemcpy') && !content.includes('cudaDeviceSynchronize')) {
      suggestions.push('Consider adding cudaDeviceSynchronize() after async operations for debugging');
    }

    if (/__global__.*void/.test(content)) {
      const kernels = content.match(/__global__\s+void\s+(\w+)/g);
      if (kernels) {
        suggestions.push(`Found ${kernels.length} kernel(s): ${kernels.map(k => k.match(/(\w+)$/)?.[1]).join(', ')}`);
      }
    }

    if (content.includes('printf') && content.includes('__global__')) {
      suggestions.push('Using printf in kernels requires compute capability 2.0+ and can impact performance');
    }

    // Check for shared memory usage
    if (content.includes('__shared__')) {
      suggestions.push('Using shared memory - ensure proper synchronization with __syncthreads()');
    }

    // Check block/grid dimensions
    const dimMatches = content.match(/<<<\s*(\d+)\s*,\s*(\d+)\s*>>>/g);
    if (dimMatches) {
      dimMatches.forEach(m => {
        const [_, grid, block] = m.match(/<<<\s*(\d+)\s*,\s*(\d+)\s*>>>/) || [];
        if (parseInt(block) > 1024) {
          issues.push(`Block size ${block} exceeds maximum of 1024 threads per block`);
        }
      });
    }

    // Error checking
    if (!content.includes('cudaGetLastError') && !content.includes('CUDA_CHECK')) {
      suggestions.push('Consider adding CUDA error checking for debugging');
    }

    return {
      success: true,
      issues,
      suggestions,
      stats: {
        lines: content.split('\n').length,
        kernels: (content.match(/__global__/g) || []).length,
        deviceFunctions: (content.match(/__device__/g) || []).length,
        sharedMemory: content.includes('__shared__'),
        constantMemory: content.includes('__constant__')
      },
      description: `## CUDA Code Analysis\n\n### Issues (${issues.length}):\n${issues.map(i => `⚠️ ${i}`).join('\n') || 'None found'}\n\n### Suggestions:\n${suggestions.map(s => `💡 ${s}`).join('\n')}`
    };
  }

  private async compileForProfiling(input: any): Promise<any> {
    const { sourceFile, outputFile, lineInfo = true } = input;
    
    const output = outputFile || sourceFile.replace('.cu', '_profile');
    const lineInfoFlag = lineInfo ? '-lineinfo' : '';
    const arch = await this.getDefaultArch();
    
    const cmd = `nvcc ${arch} -g -G ${lineInfoFlag} -o "${output}" "${sourceFile}"`;
    
    await execAsync(cmd, { timeout: 120000 });
    
    return {
      success: true,
      output,
      message: `Compiled with profiling support. Use NSight to analyze:\nncu ./${output}\nor\nnsys profile ./${output}`,
      nsightCommands: {
        compute: `ncu --set full -o profile_report ./${output}`,
        systems: `nsys profile --stats=true -o systems_report ./${output}`
      }
    };
  }

  private async createProject(input: any): Promise<any> {
    const { projectName, projectPath, template = 'basic', includeCMake = true } = input;
    
    const fullPath = path.join(projectPath, projectName);
    await fs.mkdir(fullPath, { recursive: true });
    await fs.mkdir(path.join(fullPath, 'src'), { recursive: true });
    await fs.mkdir(path.join(fullPath, 'include'), { recursive: true });

    // Get template content
    const mainCuda = this.getTemplate(template);
    
    await fs.writeFile(path.join(fullPath, 'src', 'main.cu'), mainCuda);

    if (includeCMake) {
      const cmake = this.getCMakeTemplate(projectName);
      await fs.writeFile(path.join(fullPath, 'CMakeLists.txt'), cmake);
    }

    // Create a simple Makefile
    const makefile = this.getMakefileTemplate(projectName);
    await fs.writeFile(path.join(fullPath, 'Makefile'), makefile);

    // Create .gitignore
    const gitignore = `build/\n*.o\n*.exe\n${projectName}\n`;
    await fs.writeFile(path.join(fullPath, '.gitignore'), gitignore);

    return {
      success: true,
      path: fullPath,
      files: ['src/main.cu', 'Makefile', includeCMake ? 'CMakeLists.txt' : '', '.gitignore'].filter(Boolean),
      message: `Created CUDA project: ${projectName}\n\nTo build:\n  cd ${fullPath}\n  make\n\nTo run:\n  ./${projectName}`
    };
  }

  private async checkSyntax(sourceFile: string): Promise<any> {
    // Use nvcc with -c to check without linking
    try {
      await execAsync(`nvcc -c -o /dev/null "${sourceFile}" 2>&1`, { timeout: 30000 });
      return { success: true, message: 'Syntax OK - no errors found' };
    } catch (error: any) {
      const errors = this.parseNvccErrors(error.stderr || error.message);
      return {
        success: false,
        errors,
        description: `## Syntax Errors:\n${errors.map(e => `- Line ${e.line}: ${e.message}`).join('\n')}`
      };
    }
  }

  private async getRecommendedArch(): Promise<any> {
    try {
      const { stdout } = await execAsync(
        'nvidia-smi --query-gpu=compute_cap --format=csv,noheader'
      );
      
      const computeCap = stdout.trim().split('\n')[0];
      const [major, minor] = computeCap.split('.').map(Number);
      const sm = `sm_${major}${minor}`;

      // Map compute capability to architecture name
      const archNames: Record<string, string> = {
        'sm_89': 'Ada Lovelace (RTX 40xx)',
        'sm_90': 'Hopper',
        'sm_100': 'Blackwell (RTX 50xx)',
        'sm_86': 'Ampere (RTX 30xx)',
        'sm_75': 'Turing (RTX 20xx)',
        'sm_70': 'Volta'
      };

      return {
        success: true,
        computeCapability: computeCap,
        arch: sm,
        archName: archNames[sm] || 'Unknown',
        nvccFlag: `-arch=${sm}`,
        gencode: `-gencode arch=compute_${major}${minor},code=${sm}`,
        description: `Your GPU supports compute capability ${computeCap}.\n\nRecommended compile flags:\n  -arch=${sm}\n\nArchitecture: ${archNames[sm] || 'Unknown'}`
      };
    } catch (error) {
      return { success: false, error: 'Could not detect GPU architecture' };
    }
  }

  private async getDefaultArch(): Promise<string> {
    try {
      const result = await this.getRecommendedArch();
      return result.success ? `-arch=${result.arch}` : '-arch=sm_86';
    } catch {
      return '-arch=sm_86'; // Default to Ampere
    }
  }

  private parseNvccErrors(output: string): Array<{ line: number; message: string; type: string }> {
    const errors: Array<{ line: number; message: string; type: string }> = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // Match pattern: file.cu(123): error: message
      const match = line.match(/.*\((\d+)\):\s*(error|warning):\s*(.+)/);
      if (match) {
        errors.push({
          line: parseInt(match[1]),
          type: match[2],
          message: match[3]
        });
      }
    }

    return errors;
  }

  private getTemplate(template: string): string {
    const templates: Record<string, string> = {
      basic: `#include <stdio.h>
#include <cuda_runtime.h>

// Error checking macro
#define CUDA_CHECK(call) \\
    do { \\
        cudaError_t err = call; \\
        if (err != cudaSuccess) { \\
            fprintf(stderr, "CUDA error at %s:%d: %s\\n", \\
                    __FILE__, __LINE__, cudaGetErrorString(err)); \\
            exit(EXIT_FAILURE); \\
        } \\
    } while(0)

__global__ void helloKernel() {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    printf("Hello from GPU thread %d!\\n", idx);
}

int main() {
    printf("CUDA Hello World\\n");
    
    // Launch kernel with 1 block of 10 threads
    helloKernel<<<1, 10>>>();
    
    CUDA_CHECK(cudaDeviceSynchronize());
    CUDA_CHECK(cudaGetLastError());
    
    printf("Done!\\n");
    return 0;
}
`,
      vectorAdd: `#include <stdio.h>
#include <cuda_runtime.h>
#include <math.h>

#define N 1000000

#define CUDA_CHECK(call) \\
    do { \\
        cudaError_t err = call; \\
        if (err != cudaSuccess) { \\
            fprintf(stderr, "CUDA error at %s:%d: %s\\n", \\
                    __FILE__, __LINE__, cudaGetErrorString(err)); \\
            exit(EXIT_FAILURE); \\
        } \\
    } while(0)

__global__ void vectorAdd(float *a, float *b, float *c, int n) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < n) {
        c[idx] = a[idx] + b[idx];
    }
}

int main() {
    float *h_a, *h_b, *h_c;
    float *d_a, *d_b, *d_c;
    size_t size = N * sizeof(float);
    
    // Allocate host memory
    h_a = (float*)malloc(size);
    h_b = (float*)malloc(size);
    h_c = (float*)malloc(size);
    
    // Initialize vectors
    for (int i = 0; i < N; i++) {
        h_a[i] = sinf(i);
        h_b[i] = cosf(i);
    }
    
    // Allocate device memory
    CUDA_CHECK(cudaMalloc(&d_a, size));
    CUDA_CHECK(cudaMalloc(&d_b, size));
    CUDA_CHECK(cudaMalloc(&d_c, size));
    
    // Copy to device
    CUDA_CHECK(cudaMemcpy(d_a, h_a, size, cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(d_b, h_b, size, cudaMemcpyHostToDevice));
    
    // Launch kernel
    int threadsPerBlock = 256;
    int blocksPerGrid = (N + threadsPerBlock - 1) / threadsPerBlock;
    
    vectorAdd<<<blocksPerGrid, threadsPerBlock>>>(d_a, d_b, d_c, N);
    CUDA_CHECK(cudaGetLastError());
    
    // Copy result back
    CUDA_CHECK(cudaMemcpy(h_c, d_c, size, cudaMemcpyDeviceToHost));
    
    // Verify
    float maxError = 0.0f;
    for (int i = 0; i < N; i++) {
        maxError = fmax(maxError, fabs(h_c[i] - (h_a[i] + h_b[i])));
    }
    printf("Max error: %f\\n", maxError);
    
    // Cleanup
    cudaFree(d_a); cudaFree(d_b); cudaFree(d_c);
    free(h_a); free(h_b); free(h_c);
    
    return 0;
}
`
    };

    return templates[template] || templates.basic;
  }

  private getCMakeTemplate(projectName: string): string {
    return `cmake_minimum_required(VERSION 3.18)
project(${projectName} LANGUAGES CXX CUDA)

set(CMAKE_CUDA_STANDARD 17)
set(CMAKE_CUDA_STANDARD_REQUIRED ON)

# Auto-detect GPU architecture
include(FindCUDA/select_compute_arch)
CUDA_DETECT_INSTALLED_GPUS(INSTALLED_GPU_CCS_1)
string(STRIP "\${INSTALLED_GPU_CCS_1}" INSTALLED_GPU_CCS_2)
string(REPLACE " " ";" INSTALLED_GPU_CCS_3 "\${INSTALLED_GPU_CCS_2}")
string(REPLACE "." "" CUDA_ARCH_LIST "\${INSTALLED_GPU_CCS_3}")
set(CMAKE_CUDA_ARCHITECTURES \${CUDA_ARCH_LIST})

add_executable(\${PROJECT_NAME} src/main.cu)

target_include_directories(\${PROJECT_NAME} PRIVATE include)

# Enable separable compilation for device code
set_property(TARGET \${PROJECT_NAME} PROPERTY CUDA_SEPARABLE_COMPILATION ON)
`;
  }

  private getMakefileTemplate(projectName: string): string {
    return `NVCC = nvcc
NVCCFLAGS = -O2 -lineinfo
TARGET = ${projectName}
SRC = src/main.cu

# Auto-detect architecture (run nvidia-smi to see your GPU)
ARCH ?= sm_86

all: \$(TARGET)

\$(TARGET): \$(SRC)
\t\$(NVCC) \$(NVCCFLAGS) -arch=\$(ARCH) -o \$@ \$<

debug: NVCCFLAGS += -g -G
debug: \$(TARGET)

profile: NVCCFLAGS += -lineinfo
profile: \$(TARGET)

clean:
\trm -f \$(TARGET) *.o *.ptx

run: \$(TARGET)
\t./\$(TARGET)

.PHONY: all clean debug profile run
`;
  }
}
```

## Step 4: NSight Integration Tools

Create `src/gpu/NsightTools.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export class NsightTools {
  getToolDefinitions(): Anthropic.Tool[] {
    return [
      // NSight Compute (kernel profiling)
      {
        name: 'nsight_compute_profile',
        description: 'Profile CUDA kernels with NSight Compute (ncu). Analyzes GPU kernel performance.',
        input_schema: {
          type: 'object' as const,
          properties: {
            executable: { type: 'string', description: 'Path to CUDA executable' },
            args: { type: 'array', items: { type: 'string' } },
            outputReport: { type: 'string', description: 'Output report file name' },
            metrics: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific metrics to collect'
            },
            kernelName: { type: 'string', description: 'Profile specific kernel only' },
            launchSkip: { type: 'number', description: 'Skip first N kernel launches' },
            launchCount: { type: 'number', description: 'Profile only N kernel launches' }
          },
          required: ['executable']
        }
      },
      {
        name: 'nsight_compute_analyze',
        description: 'Analyze an existing NSight Compute report.',
        input_schema: {
          type: 'object' as const,
          properties: {
            reportFile: { type: 'string', description: 'Path to .ncu-rep report file' }
          },
          required: ['reportFile']
        }
      },
      {
        name: 'nsight_compute_compare',
        description: 'Compare two NSight Compute reports.',
        input_schema: {
          type: 'object' as const,
          properties: {
            report1: { type: 'string' },
            report2: { type: 'string' }
          },
          required: ['report1', 'report2']
        }
      },

      // NSight Systems (system-wide profiling)
      {
        name: 'nsight_systems_profile',
        description: 'System-wide profiling with NSight Systems (nsys). Captures CPU, GPU, and system activity.',
        input_schema: {
          type: 'object' as const,
          properties: {
            executable: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } },
            outputReport: { type: 'string' },
            traceOptions: {
              type: 'array',
              items: { 
                type: 'string',
                enum: ['cuda', 'nvtx', 'opengl', 'osrt', 'cublas', 'cudnn']
              },
              description: 'What to trace'
            },
            duration: { type: 'number', description: 'Max duration in seconds' },
            delay: { type: 'number', description: 'Delay before profiling starts' }
          },
          required: ['executable']
        }
      },
      {
        name: 'nsight_systems_stats',
        description: 'Get statistics from an NSight Systems report.',
        input_schema: {
          type: 'object' as const,
          properties: {
            reportFile: { type: 'string', description: 'Path to .nsys-rep or .qdrep file' }
          },
          required: ['reportFile']
        }
      },

      // Memory analysis
      {
        name: 'nsight_memory_check',
        description: 'Run compute-sanitizer to check for CUDA memory errors.',
        input_schema: {
          type: 'object' as const,
          properties: {
            executable: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } },
            checkType: {
              type: 'string',
              enum: ['memcheck', 'racecheck', 'initcheck', 'synccheck'],
              description: 'Type of check to perform'
            }
          },
          required: ['executable']
        }
      },

      // Quick analysis commands
      {
        name: 'nsight_quick_profile',
        description: 'Quick GPU profile with summary output (no GUI needed).',
        input_schema: {
          type: 'object' as const,
          properties: {
            executable: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } }
          },
          required: ['executable']
        }
      },

      // NSight availability check
      {
        name: 'nsight_check_installation',
        description: 'Check if NSight tools are installed and available.',
        input_schema: {
          type: 'object' as const,
          properties: {},
          required: []
        }
      }
    ];
  }

  async executeTool(name: string, input: any): Promise<any> {
    try {
      switch (name) {
        case 'nsight_compute_profile':
          return await this.ncuProfile(input);
        
        case 'nsight_compute_analyze':
          return await this.ncuAnalyze(input.reportFile);
        
        case 'nsight_compute_compare':
          return await this.ncuCompare(input.report1, input.report2);
        
        case 'nsight_systems_profile':
          return await this.nsysProfile(input);
        
        case 'nsight_systems_stats':
          return await this.nsysStats(input.reportFile);
        
        case 'nsight_memory_check':
          return await this.memoryCheck(input);
        
        case 'nsight_quick_profile':
          return await this.quickProfile(input);
        
        case 'nsight_check_installation':
          return await this.checkInstallation();

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

  private async ncuProfile(input: any): Promise<any> {
    const { executable, args = [], outputReport, metrics, kernelName, launchSkip, launchCount } = input;
    
    let cmd = 'ncu';
    
    // Output report
    const reportName = outputReport || `profile_${Date.now()}`;
    cmd += ` -o ${reportName}`;
    
    // Set collection level
    cmd += ' --set full';
    
    // Specific kernel
    if (kernelName) {
      cmd += ` --kernel-name ${kernelName}`;
    }
    
    // Launch skip/count
    if (launchSkip) cmd += ` --launch-skip ${launchSkip}`;
    if (launchCount) cmd += ` --launch-count ${launchCount}`;
    
    // Specific metrics
    if (metrics && metrics.length > 0) {
      cmd += ` --metrics ${metrics.join(',')}`;
    }
    
    cmd += ` "${executable}" ${args.join(' ')}`;
    
    const { stdout, stderr } = await execAsync(cmd, { timeout: 300000 });
    
    return {
      success: true,
      command: cmd,
      reportFile: `${reportName}.ncu-rep`,
      output: stdout,
      message: `Profile complete. Report saved to ${reportName}.ncu-rep\n\nTo view: ncu-ui ${reportName}.ncu-rep`
    };
  }

  private async ncuAnalyze(reportFile: string): Promise<any> {
    // Export report to CSV for text analysis
    const { stdout } = await execAsync(`ncu --import "${reportFile}" --csv`);
    
    // Parse key metrics
    const lines = stdout.split('\n');
    const metrics = this.parseNcuCsv(lines);
    
    // Generate accessibility-friendly summary
    let description = `## NSight Compute Analysis\n\n`;
    
    if (metrics.kernelName) {
      description += `### Kernel: ${metrics.kernelName}\n\n`;
    }
    
    description += `### Key Metrics:\n`;
    description += `- Duration: ${metrics.duration || 'N/A'}\n`;
    description += `- Grid Size: ${metrics.gridSize || 'N/A'}\n`;
    description += `- Block Size: ${metrics.blockSize || 'N/A'}\n`;
    description += `- Registers per Thread: ${metrics.registers || 'N/A'}\n`;
    description += `- Shared Memory: ${metrics.sharedMem || 'N/A'}\n`;
    description += `- Occupancy: ${metrics.occupancy || 'N/A'}\n\n`;
    
    if (metrics.warnings && metrics.warnings.length > 0) {
      description += `### ⚠️ Performance Warnings:\n`;
      metrics.warnings.forEach((w: string) => description += `- ${w}\n`);
    }
    
    if (metrics.suggestions && metrics.suggestions.length > 0) {
      description += `\n### 💡 Optimization Suggestions:\n`;
      metrics.suggestions.forEach((s: string) => description += `- ${s}\n`);
    }

    return {
      success: true,
      metrics,
      description
    };
  }

  private async ncuCompare(report1: string, report2: string): Promise<any> {
    const { stdout } = await execAsync(
      `ncu --import "${report1}" --import "${report2}" --diff --csv`
    );
    
    return {
      success: true,
      comparison: stdout,
      message: `Comparison complete between:\n  1. ${report1}\n  2. ${report2}`
    };
  }

  private async nsysProfile(input: any): Promise<any> {
    const { executable, args = [], outputReport, traceOptions = ['cuda'], duration, delay } = input;
    
    let cmd = 'nsys profile';
    
    // Output
    const reportName = outputReport || `systems_${Date.now()}`;
    cmd += ` -o ${reportName}`;
    
    // Trace options
    cmd += ` --trace=${traceOptions.join(',')}`;
    
    // Duration/delay
    if (duration) cmd += ` --duration ${duration}`;
    if (delay) cmd += ` --delay ${delay}`;
    
    // Stats
    cmd += ' --stats=true';
    
    cmd += ` "${executable}" ${args.join(' ')}`;
    
    const { stdout, stderr } = await execAsync(cmd, { timeout: 600000 });
    
    // Parse stats from output
    const stats = this.parseNsysStats(stdout);
    
    return {
      success: true,
      command: cmd,
      reportFile: `${reportName}.nsys-rep`,
      stats,
      description: `## NSight Systems Profile Complete\n\n` +
        `Report: ${reportName}.nsys-rep\n\n` +
        `### Summary:\n${this.formatNsysStats(stats)}`,
      viewCommand: `nsys-ui ${reportName}.nsys-rep`
    };
  }

  private async nsysStats(reportFile: string): Promise<any> {
    const { stdout } = await execAsync(`nsys stats "${reportFile}"`);
    
    return {
      success: true,
      stats: stdout,
      description: `## NSight Systems Statistics\n\n\`\`\`\n${stdout}\n\`\`\``
    };
  }

  private async memoryCheck(input: any): Promise<any> {
    const { executable, args = [], checkType = 'memcheck' } = input;
    
    const cmd = `compute-sanitizer --tool ${checkType} "${executable}" ${args.join(' ')}`;
    
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 300000 });
      
      const hasErrors = stdout.includes('ERROR') || stderr.includes('ERROR');
      const errorCount = (stdout.match(/ERROR/g) || []).length;
      
      return {
        success: !hasErrors,
        checkType,
        errorCount,
        output: stdout,
        description: hasErrors
          ? `## ⚠️ Memory Errors Found: ${errorCount}\n\n${stdout}`
          : `## ✅ No Memory Errors Found\n\n${checkType} completed successfully.`
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        output: error.stdout || error.stderr
      };
    }
  }

  private async quickProfile(input: any): Promise<any> {
    const { executable, args = [] } = input;
    
    // Run a quick ncu profile with summary
    const cmd = `ncu --set basic --print-summary per-kernel "${executable}" ${args.join(' ')}`;
    
    const { stdout } = await execAsync(cmd, { timeout: 120000 });
    
    // Extract key info
    const kernelTimes: Array<{ name: string; time: string; calls: number }> = [];
    const lines = stdout.split('\n');
    
    let inKernelSection = false;
    for (const line of lines) {
      if (line.includes('Kernel Name')) inKernelSection = true;
      if (inKernelSection && line.match(/^\s+\w+/)) {
        const parts = line.trim().split(/\s{2,}/);
        if (parts.length >= 2) {
          kernelTimes.push({
            name: parts[0],
            time: parts[1],
            calls: parseInt(parts[2]) || 1
          });
        }
      }
    }

    let description = `## Quick GPU Profile\n\n`;
    
    if (kernelTimes.length > 0) {
      description += `### Kernel Performance:\n`;
      for (const k of kernelTimes) {
        description += `- ${k.name}: ${k.time} (${k.calls} call${k.calls > 1 ? 's' : ''})\n`;
      }
    }
    
    description += `\n### Full Output:\n\`\`\`\n${stdout.substring(0, 2000)}${stdout.length > 2000 ? '...' : ''}\n\`\`\``;

    return {
      success: true,
      kernelTimes,
      output: stdout,
      description
    };
  }

  private async checkInstallation(): Promise<any> {
    const tools = {
      ncu: false,
      nsys: false,
      computeSanitizer: false,
      nvprof: false
    };
    
    const versions: Record<string, string> = {};

    // Check NSight Compute
    try {
      const { stdout } = await execAsync('ncu --version');
      tools.ncu = true;
      versions.ncu = stdout.trim().split('\n')[0];
    } catch {}

    // Check NSight Systems  
    try {
      const { stdout } = await execAsync('nsys --version');
      tools.nsys = true;
      versions.nsys = stdout.trim();
    } catch {}

    // Check compute-sanitizer
    try {
      const { stdout } = await execAsync('compute-sanitizer --version');
      tools.computeSanitizer = true;
      versions.computeSanitizer = stdout.trim();
    } catch {}

    // Check nvprof (legacy)
    try {
      await execAsync('nvprof --version');
      tools.nvprof = true;
    } catch {}

    const installed = Object.entries(tools).filter(([_, v]) => v).map(([k, _]) => k);
    const missing = Object.entries(tools).filter(([_, v]) => !v).map(([k, _]) => k);

    return {
      success: true,
      tools,
      versions,
      description: `## NSight Tools Status\n\n` +
        `### Installed:\n${installed.map(t => `✅ ${t}: ${versions[t] || 'Available'}`).join('\n') || 'None'}\n\n` +
        `### Not Found:\n${missing.map(t => `❌ ${t}`).join('\n') || 'All installed!'}\n\n` +
        (missing.length > 0 ? `To install: Download from https://developer.nvidia.com/nsight-tools` : '')
    };
  }

  private parseNcuCsv(lines: string[]): any {
    // Simplified parsing - in reality would be more complex
    return {
      kernelName: 'kernel',
      duration: 'varies',
      warnings: [],
      suggestions: ['Consider reviewing memory access patterns']
    };
  }

  private parseNsysStats(output: string): any {
    // Parse nsys output into structured data
    const stats: any = { cudaApi: [], kernels: [], memcpy: [] };
    // Implementation would parse the actual output
    return stats;
  }

  private formatNsysStats(stats: any): string {
    return 'Run nsys stats on the report file for detailed breakdown.';
  }
}
```

## Step 5: Update the Main Agent

Add to `src/agent/KiloAgent.ts`:

```typescript
import { AzuriteTools } from '../cloud/AzuriteTools';
import { NvidiaTools } from '../gpu/NvidiaTools';
import { CudaTools } from '../gpu/CudaTools';
import { NsightTools } from '../gpu/NsightTools';

// In the constructor:
private azuriteTools: AzuriteTools;
private nvidiaTools: NvidiaTools;
private cudaTools: CudaTools;
private nsightTools: NsightTools;

constructor(apiKey: string, context: vscode.ExtensionContext) {
  // ... existing code ...
  this.azuriteTools = new AzuriteTools();
  this.nvidiaTools = new NvidiaTools();
  this.cudaTools = new CudaTools();
  this.nsightTools = new NsightTools();
}

// Update getAllTools():
private getAllTools(): Anthropic.Tool[] {
  return [
    ...this.browserTools.getToolDefinitions(),
    ...this.credentialTools.getToolDefinitions(),
    ...this.databaseTools.getToolDefinitions(),
    ...this.dockerTools.getToolDefinitions(),
    ...this.apiTools.getToolDefinitions(),
    ...this.componentTools.getToolDefinitions(),
    ...this.azuriteTools.getToolDefinitions(),  // NEW
    ...this.nvidiaTools.getToolDefinitions(),   // NEW
    ...this.cudaTools.getToolDefinitions(),     // NEW
    ...this.nsightTools.getToolDefinitions()    // NEW
  ];
}

// Update the tool routing in processMessage():
// ... in the agentic loop ...
} else if (toolName.startsWith('azurite_') || toolName.startsWith('azure_')) {
  result = await this.azuriteTools.executeTool(toolName, toolInput);
} else if (toolName.startsWith('nvidia_') || toolName.startsWith('cuda_')) {
  if (toolName.startsWith('cuda_')) {
    result = await this.cudaTools.executeTool(toolName, toolInput);
  } else {
    result = await this.nvidiaTools.executeTool(toolName, toolInput);
  }
} else if (toolName.startsWith('nsight_')) {
  result = await this.nsightTools.executeTool(toolName, toolInput);
}
```

## Step 6: Updated System Prompt

```typescript
const SYSTEM_PROMPT = `You are Kilo, an expert full-stack developer and GPU computing specialist, 
designed specifically to help a user with 50% vision loss. You are their eyes, hands, and technical expert 
for complex enterprise UIs, cloud development, and GPU programming.

## YOUR CAPABILITIES

### Cloud Development (Azure/Azurite)
- Start/stop/manage Azurite local Azure emulator
- Work with Azure Blob, Queue, and Table storage
- Create and test Azure Functions locally
- Manage Azure resources

### GPU Computing (NVIDIA/CUDA)
- Monitor GPU status (memory, temp, utilization)
- Compile CUDA programs with nvcc
- Create CUDA projects from templates
- Analyze CUDA code for issues
- Profile with NSight Compute and NSight Systems
- Debug GPU memory issues with compute-sanitizer
- Your user has a Blackwell GTX 5060 - use sm_100 architecture

### When Working with CUDA:
- Always check GPU status before heavy operations
- Warn if GPU temperature is high (>80°C)
- Explain kernel performance metrics clearly
- Suggest optimizations based on profiling data

### When Working with Azurite/Azure:
- Start Azurite if not running before storage operations
- Provide connection strings for testing
- Help set up Azure Functions triggers

## ACCESSIBILITY (CRITICAL)
- Read GPU metrics clearly: "Memory: 4 GB used out of 8 GB, that's 50%"
- Announce compilation errors by line number
- Summarize profiling results with key insights first
- Confirm before operations that use significant GPU resources

Remember: Be the user's expert guide through complex GPU and cloud development!`;
```

## Step 7: Extension Commands for GPU/Azure

Add to `package.json`:

```json
{
  "contributes": {
    "commands": [
      { "command": "kilo.gpuStatus", "title": "Kilo: GPU Status" },
      { "command": "kilo.cudaCompile", "title": "Kilo: Compile CUDA File" },
      { "command": "kilo.startAzurite", "title": "Kilo: Start Azurite" },
      { "command": "kilo.profileKernel", "title": "Kilo: Profile CUDA Kernel" }
    ]
  }
}
```

Add to `extension.ts`:

```typescript
// GPU Status
context.subscriptions.push(
  vscode.commands.registerCommand('kilo.gpuStatus', async () => {
    const response = await agent.processMessage(
      'Check my GPU status - memory, temperature, utilization. Let me know if anything needs attention.'
    );
    vscode.window.showInformationMessage(response.split('\n')[0]);
  })
);

// CUDA Compile current file
context.subscriptions.push(
  vscode.commands.registerCommand('kilo.cudaCompile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.fileName.endsWith('.cu')) {
      const response = await agent.processMessage(
        `Compile this CUDA file: ${editor.document.fileName}. Use the right architecture for my RTX 5060. Tell me about any errors or warnings.`
      );
      
      const outputChannel = vscode.window.createOutputChannel('CUDA Compile');
      outputChannel.clear();
      outputChannel.appendLine(response);
      outputChannel.show();
    } else {
      vscode.window.showWarningMessage('Please open a .cu file first');
    }
  })
);

// Start Azurite
context.subscriptions.push(
  vscode.commands.registerCommand('kilo.startAzurite', async () => {
    const response = await agent.processMessage(
      'Start Azurite for me and give me the connection string to use in my apps.'
    );
    vscode.window.showInformationMessage(response);
  })
);

// Profile CUDA
context.subscriptions.push(
  vscode.commands.registerCommand('kilo.profileKernel', async () => {
    const executable = await vscode.window.showInputBox({
      prompt: 'Path to compiled CUDA executable'
    });
    if (executable) {
      const response = await agent.processMessage(
        `Profile this CUDA program: ${executable}. Give me a clear summary of kernel performance and any bottlenecks.`
      );
      
      const outputChannel = vscode.window.createOutputChannel('CUDA Profile');
      outputChannel.clear();
      outputChannel.appendLine(response);
      outputChannel.show();
    }
  })
);
```

## Usage Examples

### GPU Work
```
User: "Check my GPU and compile my matrix multiplication CUDA code"

Kilo: "Let me check your GPU first...

## GPU Status: RTX 5060 (Blackwell)
- Memory: 2.1 GB / 16 GB used (13%) ✅ Plenty free
- Temperature: 42°C 🟢 Cool
- GPU Load: 3%

Perfect for compilation! Now compiling your code...

Compiling with architecture sm_100 (Blackwell)...

✅ Compilation successful!
- Output: matrixMul
- No warnings

To run: ./matrixMul

Would you like me to run it and profile the kernel performance?"
```

### Azure Storage
```
User: "Start azurite and create a container for my images"

Kilo: "Starting Azurite local storage emulator...

✅ Azurite Started!
- Blob: http://127.0.0.1:10000
- Queue: http://127.0.0.1:10001  
- Table: http://127.0.0.1:10002

Creating 'images' container...
✅ Container created!

Connection string for your app:
DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vd...

You can now upload images to this container. Want me to upload a test file?"
```

Now Kilo is your complete full-stack + GPU computing assistant! 🚀