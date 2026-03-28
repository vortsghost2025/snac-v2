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

          const fetchOptions: any = {
            method: input.method,
            headers
          };
          
          // Only add body and duplex when there's actually a body to send
          if (input.body) {
            fetchOptions.body = JSON.stringify(input.body);
            fetchOptions.duplex = 'half';
          }

          const response = await fetch(input.url, fetchOptions);

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
            }),
            duplex: 'half'
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