/**
 * One internal tool format for every provider (S19a, D-179): the existing MCP tool definitions (name,
 * the description written for AI clients, the input JSON Schema generated from the contract), turned
 * into `ToolDefinition`s; each adapter translates those to its own format (Anthropic tools, OpenAI
 * function calling, Gemini function declarations). Which tools a teacher's chat may offer (role,
 * scope, read-only first) is the agent loop's decision (S19b), made with `toolAccess`.
 */
import { inputJsonSchema, type McpTool } from '../mcp/registry.ts';
import type { ToolDefinition } from './adapters/types.ts';

export const toolDefinition = (t: Pick<McpTool, 'name' | 'description' | 'input'>): ToolDefinition => ({ name: t.name, description: t.description, inputSchema: inputJsonSchema(t as McpTool) });

export const toolDefinitions = (tools: ReadonlyArray<Pick<McpTool, 'name' | 'description' | 'input'>>): ToolDefinition[] => tools.map(toolDefinition);
