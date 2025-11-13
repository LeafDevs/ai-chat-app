/**
 * ChatService - Handles all AI chat communication logic
 * 
 * This service abstracts the Ollama API interaction, streaming, and message processing
 * making it easy to extend with new features like tools, different models, etc.
 */

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ToolResult {
  toolCallId: string
  name: string
  result: any
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  thinking?: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  isStreaming?: boolean
  isThinking?: boolean
  duration?: number
  tokensPerSecond?: number
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

export interface ChatConfig {
  model?: string
  apiUrl?: string
  temperature?: number
  numPredict?: number
  webSearchEnabled?: boolean
  agenticModeEnabled?: boolean
}

export type ToolExecutor = (name: string, args: any) => Promise<any>

export interface StreamUpdate {
  message: Message
  isDone: boolean
}

/**
 * Estimates token count from text content
 * Uses approximation: ~4 characters per token (common for English text)
 * This is a simple heuristic - actual tokenization varies by model
 */
function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0
  // Rough approximation: 1 token ≈ 4 characters
  // Add some overhead for special tokens and whitespace
  return Math.ceil(text.length / 4)
}

/**
 * Calculates output tokens from thinking and response content
 * Returns both reasoning tokens (from thinking) and output tokens (from content)
 */
function calculateOutputTokens(thinking: string, content: string): { reasoningTokens: number; outputTokens: number } {
  const reasoningTokens = estimateTokens(thinking)
  const outputTokens = estimateTokens(content)
  return { reasoningTokens, outputTokens }
}

/**
 * Calculates input tokens from conversation messages
 */
function calculateInputTokens(messages: any[]): number {
  let totalTokens = 0
  for (const msg of messages) {
    if (msg.content) {
      totalTokens += estimateTokens(msg.content)
    }
    // Add overhead for message structure (role, formatting, etc.)
    totalTokens += 4
  }
  return totalTokens
}

export type StreamCallback = (update: StreamUpdate) => void

export class ChatService {
  private config: Required<ChatConfig>
  private toolExecutor?: ToolExecutor
  private abortController: AbortController | null = null

  constructor(config: ChatConfig = {}) {
    this.config = {
      model: 'gpt-oss:latest',
      apiUrl: config.apiUrl || 'http://localhost:11434/api/chat',
      temperature: config.temperature ?? 0.7,
      numPredict: config.numPredict ?? -1,
      webSearchEnabled: config.webSearchEnabled ?? false,
      agenticModeEnabled: config.agenticModeEnabled ?? false,
    }
  }

  /**
   * Sets the tool executor function
   */
  setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor
  }

  /**
   * Cancels the current streaming request
   */
  cancelRequest(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  /**
   * Updates the service configuration
   */
  updateConfig(config: Partial<ChatConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Gets the current model name
   */
  getModel(): string {
    return this.config.model
  }

  /**
   * Cleans up trailing punctuation that might be artifacts from streaming
   * Removes trailing "?", "!", ".", etc. that are often the last token
   * IMPORTANT: Only removes punctuation/whitespace, preserves HTML tags
   */
  private cleanTrailingPunctuation(text: string): string {
    // Remove trailing punctuation marks and whitespace, but preserve HTML tags
    // Check if text ends with HTML tag first - if so, don't clean
    if (text.trim().match(/<[^>]+>$/)) {
      return text.trim()
    }
    // Otherwise, remove trailing punctuation and whitespace
    return text.replace(/[?.!,\s]+$/, '').trim()
  }

  /**
   * Extracts thinking/reasoning content from text by looking for various tag patterns
   * Supports: <think>, <reasoning>, <thought>, <internal>
   * Returns cleaned text (without thinking tags) and extracted thinking content
   */
  private extractThinking(text: string): { cleanText: string; thinking: string } {
    // Common thinking tag patterns (supporting various formats)
    const patterns = [
      /<think>([\s\S]*?)<\/think>/gi,
      /<think>([\s\S]*?)<\/redacted_reasoning>/gi,
      /<reasoning>([\s\S]*?)<\/reasoning>/gi,
      /<thought>([\s\S]*?)<\/thought>/gi,
      /<internal>([\s\S]*?)<\/internal>/gi,
    ]
    
    let cleanText = text
    let thinking = ''
    
    // Check for <think> tags specifically (common in qwen models)
    if (text.includes('<think>')) {
      const thinkPattern = /<think>([\s\S]*?)(?:<\/think>|<\/redacted_reasoning>)/gi
      const thinkMatches = [...text.matchAll(thinkPattern)]
      if (thinkMatches.length > 0) {
        thinking = thinkMatches.map(m => m[1]).join('\n\n')
        // Remove thinking tags but preserve all content before and after
        cleanText = text.replace(/<think>[\s\S]*?(?:<\/think>|<\/redacted_reasoning>)/gi, '')
        // Only trim trailing whitespace, preserve leading content
        cleanText = cleanText.replace(/\s+$/, '')
        return { cleanText, thinking }
      }
    }
    
    for (const pattern of patterns) {
      const matches = [...text.matchAll(pattern)]
      if (matches.length > 0) {
        thinking = matches.map(m => m[1]).join('\n\n')
        // Remove pattern but preserve content
        cleanText = text.replace(pattern, '')
        // Only trim trailing whitespace, preserve leading content
        cleanText = cleanText.replace(/\s+$/, '')
        break
      }
    }
    
    return { cleanText, thinking }
  }

  /**
   * Checks if a chunk starts a thinking tag
   */
  private checkThinkingStart(chunk: string): boolean {
    const starts = ['<think>', '<reasoning>', '<thought>', '<internal>']
    return starts.some(start => chunk.includes(start))
  }

  /**
   * Checks if a chunk ends a thinking tag
   */
  private checkThinkingEnd(chunk: string): boolean {
    const ends = ['</think>', '</reasoning>', '</thought>', '</internal>']
    return ends.some(end => chunk.includes(end))
  }

  /**
   * Gets the system prompt for web search capabilities and agentic mode
   */
  private getSystemPrompt(): string | undefined {
    const prompts: string[] = []
    const date = new Date().toLocaleDateString()
    
    if (this.config.webSearchEnabled) {
      prompts.push(`You are a helpful AI assistant with access to web search and URL fetching capabilities.
    The current date is ${date}.

CRITICAL INSTRUCTIONS:
- ALWAYS start your response by calling the web_search tool FIRST, before generating any text
- Use web search for EVERY user query, no exceptions
- Do NOT generate any text response before calling web_search
- Your first action must be to call the web_search tool with a relevant search query based on the user's question

WEB SEARCH AND URL FETCHING:
- Use web_search to find relevant web pages and information
- After getting search results, you can use fetch_url to read the full content of specific URLs from the search results
- fetch_url extracts readable text content, title, and HTML from any URL you provide
- Use fetch_url when you need to read detailed content from a specific webpage
- You can fetch multiple URLs if needed to gather comprehensive information

TABLE CREATION:
- Use create_table to display structured data in a clean, formatted table
- The create_table tool accepts: title (optional), columns (array with key, label, and optional align), and rows (array of objects)
- Use create_table when presenting lists, comparisons, rankings, or any structured data that would benefit from tabular format
- Example: {"name": "create_table", "arguments": {"title": "Movie Rankings", "columns": [{"key": "rank", "label": "Rank"}, {"key": "title", "label": "Title"}], "rows": [{"rank": 1, "title": "Movie 1"}, {"rank": 2, "title": "Movie 2"}]}}

When you call a tool, format it as JSON: {"name": "web_search", "arguments": {"query": "your search query here"}} or {"name": "fetch_url", "arguments": {"url": "https://example.com/page"}} or {"name": "create_table", "arguments": {"columns": [...], "rows": [...]}}
after doing a tool call you MUST not say anything else. it will be continued after the tool call gets its results in a different request.
If you feel that you need to search again after receiving search results, then you can do so by calling the web_search tool again.
After receiving search results, you can use fetch_url to read specific pages that seem relevant.
After receiving search results and optionally fetching URLs, then provide your answer using the information from the search results.
Use create_table to present data in a clear, organized table format when appropriate.`)
    }
    
    if (this.config.agenticModeEnabled) {
      prompts.push(`You are operating in AGENTIC MODE with file editing capabilities.
The current date is ${date}.

FILE OPERATION CAPABILITIES:
You have access to the following file operations:
1. read_file - Read the content of a file
   - Arguments: { "path": "file/path.txt" }
   - Returns: file content

2. write_file - Create or update a file
   - Arguments: { "path": "file/path.txt", "content": "file content here" }
   - Creates the file if it doesn't exist, updates if it does

3. list_files - List files in a directory
   - Arguments: { "path": "directory/" } (optional, lists all files if omitted)
   - Returns: list of files with metadata

4. delete_file - Delete a file
   - Arguments: { "path": "file/path.txt" }
   - Returns: confirmation

5. file_exists - Check if a file exists
   - Arguments: { "path": "file/path.txt" }
   - Returns: boolean

6. search_replace - Search and replace text in a file
   - Arguments: { "path": "file/path.txt", "replacements": [{"before": "old text", "after": "new text", "useRegex": false, "flags": "g"}] }
   - Supports multiple replacements in one call
   - Supports multi-line text (before/after can span multiple lines)
   - Supports regex patterns: set "useRegex": true to use regex, "flags" can be "g" (global), "i" (case-insensitive), "m" (multiline), etc.
   - Default mode is literal text matching (useRegex defaults to false)
   - Returns: number of replacements applied

AGENTIC MODE GUIDELINES:
- When the user asks you to create, edit, or modify files, use the appropriate file tools
- Always read a file before editing it to see its current content
- When creating new files, use descriptive paths (e.g., "src/utils/helper.ts" not just "file.txt")
- For code files, maintain proper formatting and syntax
- You can work with multiple files in sequence to accomplish complex tasks
- Be thorough: read, analyze, modify, and verify your changes
- Use search_replace for precise text replacements instead of rewriting entire files when possible
- search_replace supports multiple replacements in one call - use it for efficient file editing
- search_replace supports multi-line replacements - before/after can span multiple lines
- search_replace supports regex patterns: set "useRegex": true and provide a regex pattern in "before" field
- Use regex for pattern matching (e.g., find all function definitions, replace all instances matching a pattern)
- For literal text matching, useRegex defaults to false - text is matched exactly as written

When you need to work with files, call the appropriate tool function. After tool execution, the results will be provided to you, and you can continue with your task.`)
    }
    
    if (prompts.length === 0) return undefined
    return prompts.join('\n\n')
  }

  /**
   * Parses tool calls from AI response
   */
  private parseToolCalls(content: string): ToolCall[] {
    const toolCalls: ToolCall[] = []
    
    // Look for JSON tool calls in the format: {"name": "web_search", "arguments": {"query": "..."}}
    // Make the pattern more strict - require valid tool names, and ensure arguments is a proper JSON object
    const toolCallPattern = /\{"name"\s*:\s*"(web_search|fetch_url|create_table|read_file|write_file|list_files|delete_file|file_exists|search_replace|tool_\w+)"\s*,\s*"arguments"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})\}/g
    let match
    
    while ((match = toolCallPattern.exec(content)) !== null) {
      try {
        const name = match[1]
        const argsStr = match[2]
        
        // Validate that argsStr is valid JSON and contains expected fields
        try {
          const args = JSON.parse(argsStr)
          // Validate tool calls based on their expected arguments
          if (name === 'web_search' && typeof args === 'object' && args.query) {
            toolCalls.push({
              id: `tool_call_${Date.now()}_${Math.random()}`,
              type: 'function',
              function: {
                name,
                arguments: argsStr
              }
            })
          } else if (name === 'fetch_url' && typeof args === 'object' && args.url) {
            toolCalls.push({
              id: `tool_call_${Date.now()}_${Math.random()}`,
              type: 'function',
              function: {
                name,
                arguments: argsStr
              }
            })
          } else if (name === 'read_file' && typeof args === 'object' && args.path) {
            toolCalls.push({
              id: `tool_call_${Date.now()}_${Math.random()}`,
              type: 'function',
              function: {
                name,
                arguments: argsStr
              }
            })
          } else if (name === 'write_file' && typeof args === 'object' && args.path && args.content !== undefined) {
            toolCalls.push({
              id: `tool_call_${Date.now()}_${Math.random()}`,
              type: 'function',
              function: {
                name,
                arguments: argsStr
              }
            })
          } else if (name === 'list_files' && typeof args === 'object') {
            // path is optional for list_files
            toolCalls.push({
              id: `tool_call_${Date.now()}_${Math.random()}`,
              type: 'function',
              function: {
                name,
                arguments: argsStr
              }
            })
          } else if (name === 'delete_file' && typeof args === 'object' && args.path) {
            toolCalls.push({
              id: `tool_call_${Date.now()}_${Math.random()}`,
              type: 'function',
              function: {
                name,
                arguments: argsStr
              }
            })
          } else if (name === 'file_exists' && typeof args === 'object' && args.path) {
            toolCalls.push({
              id: `tool_call_${Date.now()}_${Math.random()}`,
              type: 'function',
              function: {
                name,
                arguments: argsStr
              }
            })
          } else if (name === 'search_replace' && typeof args === 'object' && args.path && Array.isArray(args.replacements)) {
            toolCalls.push({
              id: `tool_call_${Date.now()}_${Math.random()}`,
              type: 'function',
              function: {
                name,
                arguments: argsStr
              }
            })
          } else if (name !== 'web_search' && name !== 'fetch_url' && name !== 'create_table' && name !== 'read_file' && name !== 'write_file' && name !== 'list_files' && name !== 'delete_file' && name !== 'file_exists' && name !== 'search_replace' && typeof args === 'object') {
            // Accept other tool calls if they have valid structure
            toolCalls.push({
              id: `tool_call_${Date.now()}_${Math.random()}`,
              type: 'function',
              function: {
                name,
                arguments: argsStr
              }
            })
          }
        } catch (e) {
          // Invalid JSON in arguments, skip
          continue
        }
      } catch (e) {
        // Skip malformed tool calls
        continue
      }
    }
    
    // Also check for Ollama's native tool call format
    const ollamaToolPattern = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/gi
    while ((match = ollamaToolPattern.exec(content)) !== null) {
      try {
        const toolCallJson = JSON.parse(match[1])
        if (toolCallJson.name && toolCallJson.arguments) {
          toolCalls.push({
            id: `tool_call_${Date.now()}_${Math.random()}`,
            type: 'function',
            function: {
              name: toolCallJson.name,
              arguments: typeof toolCallJson.arguments === 'string' 
                ? toolCallJson.arguments 
                : JSON.stringify(toolCallJson.arguments)
            }
          })
        }
      } catch (e) {
        continue
      }
    }
    
    return toolCalls
  }

  /**
   * Removes tool call markers from content
   * Uses precise matching to avoid removing content on the same line as tool calls
   */
  private removeToolCalls(content: string): string {
    if (!content) return content
    
    // Store the original start to preserve it
    const originalStart = content.trimStart()
    const leadingWhitespace = content.length - content.trimStart().length
    
    // First, find all tool calls using the same patterns as parseToolCalls
    // This ensures we only remove what we've identified as tool calls
    const toolCallMatches: Array<{ start: number; end: number }> = []
    
    // Find JSON tool calls
    const toolCallPattern = /\{"name"\s*:\s*"(web_search|fetch_url|create_table|read_file|write_file|list_files|delete_file|file_exists|search_replace|tool_\w+)"\s*,\s*"arguments"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})\}/g
    let match
    while ((match = toolCallPattern.exec(content)) !== null) {
      // Validate it's a real tool call before marking for removal
      try {
        const args = JSON.parse(match[2])
        const name = match[1]
        // Validate file operation tools
        if (name === 'web_search' && typeof args === 'object' && args.query) {
          toolCallMatches.push({ start: match.index, end: match.index + match[0].length })
        } else if (name === 'fetch_url' && typeof args === 'object' && args.url) {
          toolCallMatches.push({ start: match.index, end: match.index + match[0].length })
        } else if (name === 'create_table' && typeof args === 'object' && Array.isArray(args.columns) && Array.isArray(args.rows)) {
          toolCallMatches.push({ start: match.index, end: match.index + match[0].length })
        } else if (name === 'read_file' && typeof args === 'object' && args.path) {
          toolCallMatches.push({ start: match.index, end: match.index + match[0].length })
        } else if (name === 'write_file' && typeof args === 'object' && args.path && args.content !== undefined) {
          toolCallMatches.push({ start: match.index, end: match.index + match[0].length })
        } else if (name === 'list_files' && typeof args === 'object') {
          toolCallMatches.push({ start: match.index, end: match.index + match[0].length })
        } else if (name === 'delete_file' && typeof args === 'object' && args.path) {
          toolCallMatches.push({ start: match.index, end: match.index + match[0].length })
        } else if (name === 'file_exists' && typeof args === 'object' && args.path) {
          toolCallMatches.push({ start: match.index, end: match.index + match[0].length })
        } else if (name === 'search_replace' && typeof args === 'object' && args.path && Array.isArray(args.replacements)) {
          toolCallMatches.push({ start: match.index, end: match.index + match[0].length })
        } else if (name !== 'web_search' && name !== 'fetch_url' && name !== 'create_table' && name !== 'read_file' && name !== 'write_file' && name !== 'list_files' && name !== 'delete_file' && name !== 'file_exists' && name !== 'search_replace' && typeof args === 'object') {
          toolCallMatches.push({ start: match.index, end: match.index + match[0].length })
        }
      } catch (e) {
        // Invalid JSON, skip
        continue
      }
    }
    
    // Find Ollama tool call tags
    const ollamaToolPattern = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/gi
    while ((match = ollamaToolPattern.exec(content)) !== null) {
      try {
        const toolCallJson = JSON.parse(match[1])
        if (toolCallJson.name && toolCallJson.arguments) {
          toolCallMatches.push({ start: match.index, end: match.index + match[0].length })
        }
      } catch (e) {
        // Invalid JSON, skip
        continue
      }
    }
    
    // If no tool calls found, return content as-is
    if (toolCallMatches.length === 0) {
      return content
    }
    
    // Sort matches by start position (descending) so we can remove from end to start
    // This preserves indices when removing
    toolCallMatches.sort((a, b) => b.start - a.start)
    
    // Remove tool calls precisely, working backwards to preserve indices
    let cleaned = content
    for (const match of toolCallMatches) {
      // Check if there's content before the tool call on the same line
      const beforeMatch = cleaned.substring(Math.max(0, match.start - 200), match.start)
      const afterMatch = cleaned.substring(match.end, Math.min(cleaned.length, match.end + 200))
      
      // Remove the tool call
      cleaned = cleaned.substring(0, match.start) + cleaned.substring(match.end)
      
      // If there's content before and after on the same "line" (within reasonable distance),
      // ensure we don't leave double spaces or break formatting
      const beforeTrimmed = beforeMatch.trimEnd()
      const afterTrimmed = afterMatch.trimStart()
      
      // If removing the tool call would leave adjacent content, ensure proper spacing
      if (beforeTrimmed && afterTrimmed && !beforeTrimmed.endsWith('\n') && !afterTrimmed.startsWith('\n')) {
        // Content exists on both sides - ensure single space if needed
        const beforeEnd = cleaned.substring(Math.max(0, match.start - 1), match.start)
        const afterStart = cleaned.substring(match.start, Math.min(cleaned.length, match.start + 1))
        if (beforeEnd.trim() && afterStart.trim() && !beforeEnd.endsWith(' ') && !afterStart.startsWith(' ')) {
          // Add a space if content is adjacent
          cleaned = cleaned.substring(0, match.start) + ' ' + cleaned.substring(match.start)
        }
      }
    }
    
    // Clean up multiple spaces that might result from removal
    cleaned = cleaned.replace(/\s{2,}/g, ' ')
    // Clean up spaces before newlines
    cleaned = cleaned.replace(/ +\n/g, '\n')
    // Clean up newlines that might be left behind
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
    
    // Only remove trailing whitespace, preserve leading whitespace
    cleaned = cleaned.replace(/\s+$/, '')
    
    // Verify we didn't remove content from the start
    const cleanedStart = cleaned.trimStart()
    if (cleanedStart.length > 0 && originalStart.length > 0) {
      const originalPrefix = originalStart.substring(0, Math.min(50, originalStart.length))
      const cleanedPrefix = cleanedStart.substring(0, Math.min(50, cleanedStart.length))
      
      // If we lost the start, something went wrong - return original
      if (!cleanedPrefix.startsWith(originalPrefix.substring(0, Math.min(cleanedPrefix.length, originalPrefix.length)))) {
        // Fallback: try a more conservative removal
        // Only remove tool calls that are clearly standalone (surrounded by whitespace/newlines)
        cleaned = content
        for (const match of toolCallMatches.sort((a, b) => b.start - a.start)) {
          const before = cleaned.substring(Math.max(0, match.start - 1), match.start)
          const after = cleaned.substring(match.end, Math.min(cleaned.length, match.end + 1))
          // Only remove if surrounded by whitespace or at start/end
          if ((!before.trim() || match.start === 0) && (!after.trim() || match.end === cleaned.length)) {
            cleaned = cleaned.substring(0, match.start) + cleaned.substring(match.end)
          }
        }
      }
    }
    
    // Restore original leading whitespace if we preserved content
    if (leadingWhitespace > 0 && cleaned.trimStart() === originalStart) {
      cleaned = ' '.repeat(leadingWhitespace) + cleaned.trimStart()
    }
    
    return cleaned
  }

  /**
   * Sends a message to the AI and streams the response
   * Handles tool calling and continues conversation after tool execution
   * 
   * @param messages - Existing conversation history
   * @param userMessage - The new user message to send
   * @param onUpdate - Callback function called for each streaming update
   * @param existingAssistantMessageId - Optional: ID of existing assistant message to append to (for continuations)
   * @returns Promise that resolves when streaming is complete
   */
  async sendMessage(
    messages: Message[],
    userMessage: Message,
    onUpdate: StreamCallback,
    existingAssistantMessageId?: string
  ): Promise<void> {
    const startTime = Date.now()
    let evalTokens = 0
    let accumulatedThinking = ''
    let buffer = ''
    let accumulatedContent = '' // Track accumulated content to handle incremental chunks - this is the source of truth
    let hasReceivedToolCall = false // Track if we've received any tool calls
    let forcedToolCall = false // Track if we've forced a tool call
    
    // Track total tool calls executed in this request (limit to 20)
    const MAX_TOOL_CALLS = 20
    let totalToolCallsExecuted = 0
    
    // Count existing tool calls from previous rounds (for continuations)
    // When continuing a conversation, count all tool results from the existing assistant message
    if (existingAssistantMessageId) {
      const existingMessage = messages.find(m => m.id === existingAssistantMessageId)
      if (existingMessage?.toolResults) {
        totalToolCallsExecuted = existingMessage.toolResults.length
      }
    }

    // Create assistant message placeholder - reuse existing ID if provided (for continuations)
    const assistantMessageId = existingAssistantMessageId || (Date.now() + 1).toString()
    const existingContent = existingAssistantMessageId ? messages.find(m => m.id === existingAssistantMessageId)?.content || '' : ''
    accumulatedContent = existingContent
    
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: existingContent,
      isStreaming: true,
      duration: 0,
    }
    
    // Helper to force a web search tool call based on user query
    const forceWebSearch = () => {
      if (forcedToolCall || !this.config.webSearchEnabled || !this.toolExecutor) return false
      
      // Extract search query from user message
      const searchQuery = userMessage.content.trim()
      if (!searchQuery) return false
      
      // Create a forced tool call
      const forcedToolCallObj: ToolCall = {
        id: `forced_tool_call_${Date.now()}`,
        type: 'function',
        function: {
          name: 'web_search',
          arguments: JSON.stringify({ query: searchQuery })
        }
      }
      
      assistantMessage.toolCalls = [forcedToolCallObj]
      forcedToolCall = true
      hasReceivedToolCall = true
      
      return true
    }

    try {
      // Prepare messages for API
      const apiMessages: any[] = []
      
      // Add system prompt if web search is enabled
      const systemPrompt = this.getSystemPrompt()
      if (systemPrompt) {
        apiMessages.push({
          role: 'system',
          content: systemPrompt
        })
      }
      
      // Include conversation history (excluding empty streaming messages and tool results)
      const conversationMessages = messages
        .filter(msg => msg.content.trim() || msg.toolCalls)
        .map(msg => {
          if (msg.toolCalls && msg.toolCalls.length > 0) {
            // Format message with tool calls - include thinking if available
            const messageContent = msg.thinking 
              ? `${msg.thinking}\n\n${msg.content}`.trim()
              : msg.content
            return {
              role: msg.role,
              content: messageContent,
              tool_calls: msg.toolCalls.map(tc => {
                let parsedArgs: any
                try {
                  // Parse arguments string to object for Ollama API
                  if (typeof tc.function.arguments === 'string') {
                    parsedArgs = JSON.parse(tc.function.arguments)
                  } else {
                    parsedArgs = tc.function.arguments
                  }
                } catch (e) {
                  // If parsing fails, try to use as-is or default to empty object
                  parsedArgs = typeof tc.function.arguments === 'object' 
                    ? tc.function.arguments 
                    : {}
                }
                
                return {
                  id: tc.id,
                  type: tc.type,
                  function: {
                    name: tc.function.name,
                    arguments: parsedArgs
                  }
                }
              })
            }
          }
          if (msg.role === 'tool') {
            // Tool result message
            return {
              role: 'tool',
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
              name: msg.toolResults?.[0]?.name
            }
          }
          // Include thinking in assistant messages if available
          if (msg.role === 'assistant' && msg.thinking) {
            return {
              role: msg.role,
              content: `${msg.thinking}\n\n${msg.content}`.trim()
            }
          }
          return {
            role: msg.role,
            content: msg.content
          }
        })
      
      apiMessages.push(...conversationMessages)
      
      // Add current user message (skip if empty for continuation)
      if (userMessage.content.trim()) {
        apiMessages.push({
          role: 'user',
          content: userMessage.content
        })
      }
      
      // Calculate input tokens from all messages sent to API
      const inputTokenCount = calculateInputTokens(apiMessages)
      
      // Prepare tools definition
      const tools: any[] = []
      
      if (this.config.webSearchEnabled) {
        tools.push({
          type: 'function',
          function: {
            name: 'web_search',
            description: 'Search the web for current information, news, facts, or data. Use this when you need up-to-date information.',
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'The search query to look up on the web'
                }
              },
              required: ['query']
            }
          }
        })
        tools.push({
          type: 'function',
          function: {
            name: 'fetch_url',
            description: 'Fetch and extract readable content from a specific URL. Use this to read the full content of a webpage when you have a direct link. Returns the page title, full HTML content, and extracted text content.',
            parameters: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'The full URL of the webpage to fetch and read'
                }
              },
              required: ['url']
            }
          }
        })
      }
      
      // Table rendering tool (always available)
      tools.push({
        type: 'function',
        function: {
          name: 'create_table',
          description: 'Create a formatted table with columns and rows. Use this to display structured data in a clean, readable table format.',
          parameters: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Optional title for the table'
              },
              columns: {
                type: 'array',
                description: 'Array of column definitions. Each column should have a "key" (string identifier), "label" (display name), and optional "align" ("left", "center", or "right")',
                items: {
                  type: 'object',
                  properties: {
                    key: { type: 'string' },
                    label: { type: 'string' },
                    align: { type: 'string', enum: ['left', 'center', 'right'] }
                  },
                  required: ['key', 'label']
                }
              },
              rows: {
                type: 'array',
                description: 'Array of row objects. Each row should be a JSON object with keys matching the column keys',
                items: {
                  type: 'object'
                }
              }
            },
            required: ['columns', 'rows']
          }
        }
      })
      
      if (this.config.agenticModeEnabled) {
        tools.push(
          {
            type: 'function',
            function: {
              name: 'read_file',
              description: 'Read the content of a file. Returns the file content if it exists.',
              parameters: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'The path to the file to read'
                  }
                },
                required: ['path']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'write_file',
              description: 'Create a new file or update an existing file with the specified content.',
              parameters: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'The path to the file to create or update'
                  },
                  content: {
                    type: 'string',
                    description: 'The content to write to the file'
                  }
                },
                required: ['path', 'content']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'list_files',
              description: 'List all files in a directory, or all files if no path is provided.',
              parameters: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Optional directory path to list files from. If omitted, lists all files.'
                  }
                },
                required: []
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'delete_file',
              description: 'Delete a file from the file system.',
              parameters: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'The path to the file to delete'
                  }
                },
                required: ['path']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'file_exists',
              description: 'Check if a file exists at the given path.',
              parameters: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'The path to check'
                  }
                },
                required: ['path']
              }
            }
          },
          {
            type: 'function',
            function: {
              name: 'search_replace',
              description: 'Search and replace text in a file. Supports multiple replacements in one call, multi-line text, and regex patterns. Useful for precise edits without rewriting entire files.',
              parameters: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'The path to the file to modify'
                  },
                  replacements: {
                    type: 'array',
                    description: 'Array of replacement objects. Each replacement can use literal text matching (default) or regex patterns.',
                    items: {
                      type: 'object',
                      properties: {
                        before: {
                          type: 'string',
                          description: 'The text or regex pattern to search for. Can be multiple lines. If useRegex is true, this is treated as a regex pattern.'
                        },
                        after: {
                          type: 'string',
                          description: 'The text to replace it with. Can be multiple lines. Can use regex capture groups ($1, $2, etc.) if useRegex is true.'
                        },
                        useRegex: {
                          type: 'boolean',
                          description: 'If true, "before" is treated as a regex pattern. If false (default), "before" is matched literally.'
                        },
                        flags: {
                          type: 'string',
                          description: 'Regex flags (e.g., "g" for global, "i" for case-insensitive, "m" for multiline). Defaults to "g" if useRegex is true. Ignored if useRegex is false.'
                        }
                      },
                      required: ['before', 'after']
                    }
                  }
                },
                required: ['path', 'replacements']
              }
            }
          }
        )
      }
      
      const toolsDefinition = tools.length > 0 ? tools : undefined

      // Create abort controller for this request
      this.abortController = new AbortController()
      const signal = this.abortController.signal

      // Make API request to Ollama
      const response = await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal,
        body: JSON.stringify({
          model: this.config.model,
          messages: apiMessages,
          ...(toolsDefinition && { tools: toolsDefinition }),
          stream: true,
          options: {
            num_predict: this.config.numPredict,
            temperature: this.config.temperature
          }
        })
      })

      if (!response.ok || !response.body) {
        this.abortController = null
        throw new Error('Failed to connect to Ollama')
      }

      // Set up streaming reader and decoder
      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      // Process streaming chunks
      try {
        while (true) {
          // Check if request was cancelled
          if (signal.aborted) {
            reader.cancel()
            
            // Preserve all accumulated content and thinking
            const currentContent = accumulatedContent || assistantMessage.content || ''
            const finalExtraction = this.extractThinking(currentContent)
            let finalContent = this.removeToolCalls(finalExtraction.cleanText)
            finalContent = this.cleanTrailingPunctuation(finalContent)
            const finalThinking = finalExtraction.thinking || accumulatedThinking
            
            // Calculate final tokens
            const duration = (Date.now() - startTime) / 1000
            const { reasoningTokens: finalReasoningTokens, outputTokens: finalOutputTokens } = calculateOutputTokens(
              finalThinking.trim() || '',
              finalContent
            )
            const tokensPerSecond = (finalReasoningTokens + finalOutputTokens) > 0 && duration > 0 
              ? (finalReasoningTokens + finalOutputTokens) / duration 
              : 0
            
            // Update message with all preserved data
            assistantMessage.content = finalContent + '\n\n⚠️ Request cancelled by user.'
            assistantMessage.thinking = finalThinking.trim() || undefined
            assistantMessage.isStreaming = false
            assistantMessage.isThinking = false
            assistantMessage.duration = duration
            assistantMessage.tokensPerSecond = tokensPerSecond
            assistantMessage.totalTokens = inputTokenCount + finalReasoningTokens + finalOutputTokens
            assistantMessage.inputTokens = inputTokenCount
            assistantMessage.outputTokens = finalOutputTokens
            assistantMessage.reasoningTokens = finalReasoningTokens
            
            onUpdate({
              message: { ...assistantMessage },
              isDone: true
            })
            this.abortController = null
            return
          }
          
          const { done, value } = await reader.read()
          if (done) break

          const decodedChunk = decoder.decode(value, { stream: true })
          buffer += decodedChunk
          
          const lines = buffer.split('\n')
          
          // Keep the last incomplete line in buffer
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.trim()) continue
            
            try {
              const json = JSON.parse(line)
              
              // Extract token counts from response
              if (json.eval_count !== undefined) {
                evalTokens = json.eval_count
              }
              
              // Chat API format: { message: { role, content, tool_calls }, done: false }
              const messageContent = json.message?.content || json.response || ''
              const thinkingContent = json.message?.thinking || json.thinking || ''
              const toolCalls = json.message?.tool_calls || []
              
              // Track if we've received tool calls
              if (toolCalls && toolCalls.length > 0) {
                hasReceivedToolCall = true
              }
              
              if (messageContent) {
                // Ollama chat API can send either cumulative or incremental content
                // We need to detect which and accumulate accordingly
                // Strategy: Always use the longest content that contains our accumulated content
                // This ensures we never lose tokens
                const currentContent = accumulatedContent
                
                // Check if this is cumulative (contains all previous content) or incremental (just new chunk)
                // Cumulative: messageContent is longer and starts with currentContent
                // Incremental: messageContent is shorter or doesn't start with currentContent
                if (currentContent && messageContent.length >= currentContent.length && messageContent.startsWith(currentContent)) {
                  // Cumulative - use it directly (this is the most reliable)
                  accumulatedContent = messageContent
                } else if (currentContent && messageContent.length < currentContent.length) {
                  // Likely incremental - append only if it's truly new content
                  // Check if messageContent is a continuation (doesn't overlap with end of currentContent)
                  const overlap = currentContent.endsWith(messageContent.substring(0, Math.min(messageContent.length, 10)))
                  if (!overlap) {
                    accumulatedContent = currentContent + messageContent
                  } else {
                    // It's overlapping, likely cumulative but shorter - use the longer one
                    accumulatedContent = currentContent.length > messageContent.length ? currentContent : messageContent
                  }
                } else {
                  // New content or unclear - use the longer of the two to preserve all tokens
                  accumulatedContent = currentContent.length > messageContent.length ? currentContent : messageContent
                }
                
                // Check if model is generating text without tool calls
                // If we've received significant content (50+ chars) and no tool calls, force web search
                const contentLength = accumulatedContent.trim().length
                const parsedToolCalls = this.parseToolCalls(accumulatedContent)
                const hasAnyToolCalls = hasReceivedToolCall || parsedToolCalls.length > 0 || (toolCalls && toolCalls.length > 0)
                
                // Force web search if we have content but no tool calls (for models without thinking)
                if (contentLength > 50 && !hasAnyToolCalls && !forcedToolCall && this.config.webSearchEnabled && this.toolExecutor) {
                  forceWebSearch()
                  // After forcing, stop streaming to execute the tool
                  if (forcedToolCall) {
                    reader.cancel()
                    break
                  }
                }
                
                // Extract thinking from the accumulated content
                // Always use accumulatedContent as source of truth to preserve all tokens
                const { cleanText, thinking } = this.extractThinking(accumulatedContent)
                
                // Use cleanText directly - extractThinking should preserve all non-thinking content
                const safeCleanText = cleanText
                
                // Parse tool calls from accumulated content (including any forced ones)
                const parsedToolCallsFromAccumulated = this.parseToolCalls(accumulatedContent)
                const allToolCalls = [...(assistantMessage.toolCalls || []), ...parsedToolCallsFromAccumulated]
                
                // Only stop streaming if we have VALID tool calls (not false positives)
                // Check if parsedToolCalls are actually valid (not just partial matches)
                const hasValidToolCalls = parsedToolCallsFromAccumulated.length > 0 && parsedToolCallsFromAccumulated.some(tc => {
                  try {
                    const args = JSON.parse(tc.function.arguments)
                    // For web_search, require query field
                    if (tc.function.name === 'web_search') {
                      return typeof args === 'object' && args.query && typeof args.query === 'string' && args.query.length > 0
                    }
                    // For fetch_url, require url field
                    if (tc.function.name === 'fetch_url') {
                      return typeof args === 'object' && args.url && typeof args.url === 'string' && args.url.length > 0
                    }
                    // For create_table, require columns and rows arrays
                    if (tc.function.name === 'create_table') {
                      return typeof args === 'object' && Array.isArray(args.columns) && Array.isArray(args.rows) && args.columns.length > 0
                    }
                    return true
                  } catch {
                    return false
                  }
                })
                
                // Remove tool call markers from content - always remove to clean display
                // Use accumulatedContent as source to ensure we have all tokens
                const contentWithoutToolCalls = this.removeToolCalls(safeCleanText)
                
                // Update accumulated thinking
                if (thinking) {
                  accumulatedThinking = thinking
                }
                
                // Check if currently in thinking mode (use accumulatedContent)
                const currentlyInThinking = this.checkThinkingStart(accumulatedContent) && 
                  !this.checkThinkingEnd(accumulatedContent)
                
                // Calculate current metrics
                const currentDuration = (Date.now() - startTime) / 1000
                const currentTokensPerSecond = evalTokens > 0 && currentDuration > 0 
                  ? evalTokens / currentDuration 
                  : 0
                
                // Update assistant message - show content unless we're stopping for valid tool calls
                // Always use contentWithoutToolCalls to ensure we display all non-thinking, non-tool-call content
                assistantMessage.content = hasValidToolCalls && !assistantMessage.toolResults ? '' : contentWithoutToolCalls
                assistantMessage.thinking = accumulatedThinking || 
                  (currentlyInThinking ? accumulatedContent : undefined)
                assistantMessage.toolCalls = allToolCalls.length > 0 ? allToolCalls : undefined
                assistantMessage.isThinking = currentlyInThinking || (allToolCalls.length > 0 && !assistantMessage.toolResults)
                assistantMessage.isStreaming = true
                // Calculate output tokens from thinking + content
                const { reasoningTokens: reasoningTokenCount, outputTokens: outputTokenCount } = calculateOutputTokens(
                  accumulatedThinking || assistantMessage.thinking || '',
                  contentWithoutToolCalls
                )
                
                assistantMessage.duration = currentDuration
                assistantMessage.tokensPerSecond = currentTokensPerSecond
                assistantMessage.totalTokens = inputTokenCount + reasoningTokenCount + outputTokenCount
                assistantMessage.inputTokens = inputTokenCount
                assistantMessage.outputTokens = outputTokenCount
                assistantMessage.reasoningTokens = reasoningTokenCount
                
                // Notify callback
                onUpdate({
                  message: { ...assistantMessage },
                  isDone: false
                })
                
                // If we detect VALID tool calls in content, stop streaming AFTER updating UI
                if (hasValidToolCalls && !assistantMessage.toolResults) {
                  assistantMessage.toolCalls = allToolCalls
                  assistantMessage.isThinking = true
                  assistantMessage.content = '' // Clear content since we're stopping for tool execution
                  
                  // Update with cleared content
                  onUpdate({
                    message: { ...assistantMessage },
                    isDone: false
                  })
                  
                  // STOP STREAMING - break out of the loop to execute tools immediately
                  reader.cancel()
                  break
                }
              }
              
              // Handle native Ollama tool calls - STOP STREAMING IMMEDIATELY
              if (toolCalls && toolCalls.length > 0) {
                hasReceivedToolCall = true
                const newToolCalls: ToolCall[] = toolCalls.map((tc: any) => ({
                  id: tc.id || `tool_call_${Date.now()}_${Math.random()}`,
                  type: tc.type || 'function',
                  function: {
                    name: tc.function?.name || '',
                    arguments: typeof tc.function?.arguments === 'string' 
                      ? tc.function.arguments 
                      : JSON.stringify(tc.function?.arguments || {})
                  }
                }))
                
                assistantMessage.toolCalls = [...(assistantMessage.toolCalls || []), ...newToolCalls]
                assistantMessage.isThinking = true
                assistantMessage.content = '' // Clear content since we're stopping for tool execution
                
                // Update with tool calls
                onUpdate({
                  message: { ...assistantMessage },
                  isDone: false
                })
                
                // STOP STREAMING - break out of the loop to execute tools immediately
                reader.cancel()
                break
              }
              
              // Check if we forced a tool call - also STOP STREAMING
              if (forcedToolCall && assistantMessage.toolCalls && assistantMessage.toolCalls.length > 0 && !assistantMessage.toolResults) {
                // STOP STREAMING - break out of the loop to execute tools immediately
                reader.cancel()
                break
              }
              
              // Handle separate thinking/reasoning field
              if (thinkingContent) {
                accumulatedThinking += thinkingContent
                assistantMessage.thinking = accumulatedThinking
                assistantMessage.isThinking = true
                assistantMessage.isStreaming = true
                
                onUpdate({
                  message: { ...assistantMessage },
                  isDone: false
                })
              }
              
              // When stream is done, perform final cleanup and handle tool calls
              if (json.done) {
                // Use accumulatedContent as the source of truth - it should contain all tokens
                // Fall back to messageContent if accumulatedContent is empty (shouldn't happen, but safety check)
                const currentContent = accumulatedContent || messageContent || assistantMessage.content || ''
                
                // Update accumulatedContent if messageContent is longer (safety check)
                if (messageContent && messageContent.length > accumulatedContent.length) {
                  accumulatedContent = messageContent
                }
                
                // Extract thinking from the final content (use accumulatedContent)
                const finalExtraction = this.extractThinking(accumulatedContent || currentContent)
                
                // Remove tool calls and clean up - use the cleanText from extraction
                let finalContent = this.removeToolCalls(finalExtraction.cleanText)
                finalContent = this.cleanTrailingPunctuation(finalContent)
                const finalThinking = finalExtraction.thinking || accumulatedThinking
                
                // Parse any final tool calls from accumulatedContent
                const finalToolCalls = this.parseToolCalls(accumulatedContent || currentContent)
                if (finalToolCalls.length > 0) {
                  assistantMessage.toolCalls = [...(assistantMessage.toolCalls || []), ...finalToolCalls]
                  hasReceivedToolCall = true
                }
                
                // If we still don't have tool calls and have content, force web search
                if (!hasReceivedToolCall && !forcedToolCall && finalContent.trim().length > 0 && this.config.webSearchEnabled && this.toolExecutor) {
                  forceWebSearch()
                }
                
                // If we have tool calls, execute them and continue
                if (assistantMessage.toolCalls && assistantMessage.toolCalls.length > 0 && this.toolExecutor) {
                  // Check if we've exceeded the tool call limit
                  if (totalToolCallsExecuted >= MAX_TOOL_CALLS) {
                    assistantMessage.content = `⚠️ Tool call limit reached (${MAX_TOOL_CALLS} tool calls). Stopping execution to prevent infinite loops.`
                    assistantMessage.isStreaming = false
                    assistantMessage.isThinking = false
                    assistantMessage.toolCalls = undefined
                    onUpdate({
                      message: { ...assistantMessage },
                      isDone: true
                    })
                    return
                  }
                  
                  // Execute tools
                  const toolResults: ToolResult[] = []
                  for (const toolCall of assistantMessage.toolCalls) {
                    // Check limit before each tool call
                    if (totalToolCallsExecuted >= MAX_TOOL_CALLS) {
                      toolResults.push({
                        toolCallId: toolCall.id,
                        name: toolCall.function.name,
                        result: { error: `Tool call limit reached (${MAX_TOOL_CALLS} tool calls). Execution stopped.` }
                      })
                      break
                    }
                    
                    try {
                      const args = JSON.parse(toolCall.function.arguments)
                      const result = await this.toolExecutor(toolCall.function.name, args)
                      toolResults.push({
                        toolCallId: toolCall.id,
                        name: toolCall.function.name,
                        result
                      })
                      totalToolCallsExecuted++
                    } catch (error) {
                      toolResults.push({
                        toolCallId: toolCall.id,
                        name: toolCall.function.name,
                        result: { error: error instanceof Error ? error.message : 'Tool execution failed' }
                      })
                      totalToolCallsExecuted++
                    }
                  }
                  
                  assistantMessage.toolResults = toolResults
                  assistantMessage.isThinking = false
                  
                  // Log the message state after tool execution
                  console.log('🔧 After tool execution - Message state:', {
                    id: assistantMessage.id,
                    content: assistantMessage.content,
                    contentLength: assistantMessage.content?.length || 0,
                    thinking: assistantMessage.thinking,
                    thinkingLength: assistantMessage.thinking?.length || 0,
                    toolCalls: assistantMessage.toolCalls?.length || 0,
                    toolResults: assistantMessage.toolResults?.length || 0,
                    accumulatedContent: accumulatedContent,
                    accumulatedContentLength: accumulatedContent.length,
                    fullMessage: JSON.stringify(assistantMessage, null, 2)
                  })
                  
                  // Update with tool results
                  onUpdate({
                    message: { ...assistantMessage },
                    isDone: false
                  })
                  
                  // Continue conversation with tool results
                  // Include the original user message, assistant message with thinking, and tool results
                  const toolMessages: Message[] = toolResults.map(tr => ({
                    id: `tool_${tr.toolCallId}`,
                    role: 'tool',
                    content: JSON.stringify(tr.result),
                    toolResults: [tr]
                  }))
                  
                  // Build continuation messages: original messages + user message + assistant message (with thinking) + tool results
                  const continuationMessages = [
                    ...messages.filter(m => m.role !== 'tool'), // Exclude any previous tool messages
                    userMessage, // Original user question
                    {
                      ...assistantMessage,
                      content: assistantMessage.content || '', // Keep any existing content
                      thinking: assistantMessage.thinking || accumulatedThinking // Include thinking data
                    },
                    ...toolMessages // Tool results
                  ]
                  
                  // Continue with empty user message since everything is already in continuationMessages
                  await this.sendMessage(continuationMessages, {
                    id: 'continuation',
                    role: 'user',
                    content: ''
                  }, onUpdate, assistantMessageId)
                  
                  return
                }
              
              // If we have tool calls from the done event, execute them
              if (assistantMessage.toolCalls && assistantMessage.toolCalls.length > 0 && this.toolExecutor && !assistantMessage.toolResults) {
                // Check if we've exceeded the tool call limit
                if (totalToolCallsExecuted >= MAX_TOOL_CALLS) {
                  assistantMessage.content = `⚠️ Tool call limit reached (${MAX_TOOL_CALLS} tool calls). Stopping execution to prevent infinite loops.`
                  assistantMessage.isStreaming = false
                  assistantMessage.isThinking = false
                  assistantMessage.toolCalls = undefined
                  onUpdate({
                    message: { ...assistantMessage },
                    isDone: true
                  })
                  return
                }
                
                // Execute tools
                const toolResults: ToolResult[] = []
                for (const toolCall of assistantMessage.toolCalls) {
                  // Check limit before each tool call
                  if (totalToolCallsExecuted >= MAX_TOOL_CALLS) {
                    toolResults.push({
                      toolCallId: toolCall.id,
                      name: toolCall.function.name,
                      result: { error: `Tool call limit reached (${MAX_TOOL_CALLS} tool calls). Execution stopped.` }
                    })
                    break
                  }
                  
                  try {
                    const args = JSON.parse(toolCall.function.arguments)
                    const result = await this.toolExecutor(toolCall.function.name, args)
                    toolResults.push({
                      toolCallId: toolCall.id,
                      name: toolCall.function.name,
                      result
                    })
                    totalToolCallsExecuted++
                  } catch (error) {
                    toolResults.push({
                      toolCallId: toolCall.id,
                      name: toolCall.function.name,
                      result: { error: error instanceof Error ? error.message : 'Tool execution failed' }
                    })
                    totalToolCallsExecuted++
                  }
                }
                
                assistantMessage.toolResults = toolResults
                assistantMessage.isThinking = false
                assistantMessage.content = '' // Clear content since we're continuing with tool results
                
                // Log the message state after tool execution
                console.log('🔧 After tool execution (done event) - Message state:', {
                  id: assistantMessage.id,
                  content: assistantMessage.content,
                  contentLength: assistantMessage.content?.length || 0,
                  thinking: assistantMessage.thinking,
                  thinkingLength: assistantMessage.thinking?.length || 0,
                  toolCalls: assistantMessage.toolCalls?.length || 0,
                  toolResults: assistantMessage.toolResults?.length || 0,
                  accumulatedContent: accumulatedContent,
                  accumulatedContentLength: accumulatedContent.length,
                  fullMessage: JSON.stringify(assistantMessage, null, 2)
                })
                
                // Update with tool results
                onUpdate({
                  message: { ...assistantMessage },
                  isDone: false
                })
                
                // Continue conversation with tool results
                const toolMessages: Message[] = toolResults.map(tr => ({
                  id: `tool_${tr.toolCallId}`,
                  role: 'tool',
                  content: JSON.stringify(tr.result),
                  toolResults: [tr]
                }))
                
                const continuationMessages = [
                  ...messages.filter(m => m.role !== 'tool'),
                  userMessage,
                  {
                    ...assistantMessage,
                    content: assistantMessage.content || '',
                    thinking: assistantMessage.thinking || accumulatedThinking
                  },
                  ...toolMessages
                ]
                
                await this.sendMessage(continuationMessages, {
                  id: 'continuation',
                  role: 'user',
                  content: ''
                }, onUpdate, assistantMessageId)
                
                return
              }
              
              // Calculate final metrics
              const duration = (Date.now() - startTime) / 1000
              const { reasoningTokens: finalReasoningTokens, outputTokens: finalOutputTokens } = calculateOutputTokens(
                finalThinking.trim() || '',
                finalContent
              )
              const tokensPerSecond = (finalReasoningTokens + finalOutputTokens) > 0 && duration > 0 
                ? (finalReasoningTokens + finalOutputTokens) / duration 
                : 0
              
              // Update final message
              assistantMessage.content = finalContent
              assistantMessage.thinking = finalThinking.trim() || undefined
              assistantMessage.isStreaming = false
              assistantMessage.isThinking = false
              assistantMessage.duration = duration
              assistantMessage.tokensPerSecond = tokensPerSecond
              assistantMessage.totalTokens = inputTokenCount + finalReasoningTokens + finalOutputTokens
              assistantMessage.inputTokens = inputTokenCount
              assistantMessage.outputTokens = finalOutputTokens
              assistantMessage.reasoningTokens = finalReasoningTokens
              
              onUpdate({
                message: { ...assistantMessage },
                isDone: true
              })
            }
          } catch (e) {
            // Skip malformed JSON lines
            continue
          }
        }
      }
      } catch (readError) {
        // Handle errors during reading (including abort)
        if (readError instanceof Error && readError.name === 'AbortError') {
          reader.cancel()
          
          // Preserve all accumulated content and thinking
          const currentContent = accumulatedContent || assistantMessage.content || ''
          const finalExtraction = this.extractThinking(currentContent)
          let finalContent = this.removeToolCalls(finalExtraction.cleanText)
          finalContent = this.cleanTrailingPunctuation(finalContent)
          const finalThinking = finalExtraction.thinking || accumulatedThinking
          
          // Calculate final tokens
          const duration = (Date.now() - startTime) / 1000
          const { reasoningTokens: finalReasoningTokens, outputTokens: finalOutputTokens } = calculateOutputTokens(
            finalThinking.trim() || '',
            finalContent
          )
          const tokensPerSecond = (finalReasoningTokens + finalOutputTokens) > 0 && duration > 0 
            ? (finalReasoningTokens + finalOutputTokens) / duration 
            : 0
          
          // Update message with all preserved data
          assistantMessage.content = finalContent + '\n\n⚠️ Request cancelled by user.'
          assistantMessage.thinking = finalThinking.trim() || undefined
          assistantMessage.isStreaming = false
          assistantMessage.isThinking = false
          assistantMessage.duration = duration
          assistantMessage.tokensPerSecond = tokensPerSecond
          assistantMessage.totalTokens = inputTokenCount + finalReasoningTokens + finalOutputTokens
          assistantMessage.inputTokens = inputTokenCount
          assistantMessage.outputTokens = finalOutputTokens
          assistantMessage.reasoningTokens = finalReasoningTokens
          
          onUpdate({
            message: { ...assistantMessage },
            isDone: true
          })
          this.abortController = null
          return
        }
        throw readError
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const json = JSON.parse(buffer)
          
          if (json.eval_count !== undefined) {
            evalTokens = json.eval_count
          }
          
          const messageContent = json.message?.content || json.response || ''
          const thinkingContent = json.message?.thinking || json.thinking || ''
          
          if (messageContent) {
            const currentContent = accumulatedContent
            // Check if cumulative or incremental - always preserve the longest content
            if (currentContent && messageContent.length >= currentContent.length && messageContent.startsWith(currentContent)) {
              // Cumulative - use it directly
              accumulatedContent = messageContent
            } else if (currentContent && messageContent.length < currentContent.length) {
              // Likely incremental - append only if truly new
              const overlap = currentContent.endsWith(messageContent.substring(0, Math.min(messageContent.length, 10)))
              if (!overlap) {
                accumulatedContent = currentContent + messageContent
              } else {
                // Overlapping, use the longer one
                accumulatedContent = currentContent.length > messageContent.length ? currentContent : messageContent
              }
            } else {
              // New content or unclear - use the longer of the two
              accumulatedContent = currentContent.length > messageContent.length ? currentContent : messageContent
            }
            
            const { thinking } = this.extractThinking(accumulatedContent)
            if (thinking) {
              accumulatedThinking = thinking
            }
            
            // Don't update assistantMessage.content here - let final update handle it
          }
          
          if (thinkingContent) {
            accumulatedThinking += thinkingContent
          }
        } catch (e) {
          // Ignore parse errors for final buffer
        }
      }

      // Final update to ensure we have all accumulated content
      // Use accumulatedContent as the source of truth - it should contain all tokens received
      const currentContent = accumulatedContent || assistantMessage.content || ''
      
      // Extract thinking and clean content
      const finalExtraction = this.extractThinking(currentContent)
      
      // Remove tool calls but preserve all non-thinking, non-tool-call content
      let finalContent = this.removeToolCalls(finalExtraction.cleanText)
      
      // Only clean trailing punctuation, don't trim leading content
      finalContent = this.cleanTrailingPunctuation(finalContent)
      const finalThinking = finalExtraction.thinking || accumulatedThinking
      
      // Parse any final tool calls from accumulatedContent
      const finalToolCalls = this.parseToolCalls(currentContent)
      if (finalToolCalls.length > 0) {
        assistantMessage.toolCalls = [...(assistantMessage.toolCalls || []), ...finalToolCalls]
      }
      
      // Ensure we update accumulatedContent if we have a longer version
      if (currentContent.length > (accumulatedContent || '').length) {
        accumulatedContent = currentContent
      }
      
      // If we have tool calls and executor, handle them (this handles both early breaks and normal completion)
      if (assistantMessage.toolCalls && assistantMessage.toolCalls.length > 0 && this.toolExecutor && !assistantMessage.toolResults) {
        // Check if we've exceeded the tool call limit
        if (totalToolCallsExecuted >= MAX_TOOL_CALLS) {
          assistantMessage.content = `⚠️ Tool call limit reached (${MAX_TOOL_CALLS} tool calls). Stopping execution to prevent infinite loops.`
          assistantMessage.isStreaming = false
          assistantMessage.isThinking = false
          assistantMessage.toolCalls = undefined
          onUpdate({
            message: { ...assistantMessage },
            isDone: true
          })
          return
        }
        
        // Execute tools
        const toolResults: ToolResult[] = []
        for (const toolCall of assistantMessage.toolCalls) {
          // Check limit before each tool call
          if (totalToolCallsExecuted >= MAX_TOOL_CALLS) {
            toolResults.push({
              toolCallId: toolCall.id,
              name: toolCall.function.name,
              result: { error: `Tool call limit reached (${MAX_TOOL_CALLS} tool calls). Execution stopped.` }
            })
            break
          }
          
          try {
            const args = JSON.parse(toolCall.function.arguments)
            const result = await this.toolExecutor(toolCall.function.name, args)
            toolResults.push({
              toolCallId: toolCall.id,
              name: toolCall.function.name,
              result
            })
            totalToolCallsExecuted++
          } catch (error) {
            toolResults.push({
              toolCallId: toolCall.id,
              name: toolCall.function.name,
              result: { error: error instanceof Error ? error.message : 'Tool execution failed' }
            })
            totalToolCallsExecuted++
          }
        }
        
        assistantMessage.toolResults = toolResults
        assistantMessage.isThinking = false
        assistantMessage.content = '' // Ensure content is empty before continuing with tool results
        
        // Log the message state after tool execution
        console.log('🔧 After tool execution (final buffer) - Message state:', {
          id: assistantMessage.id,
          content: assistantMessage.content,
          contentLength: assistantMessage.content?.length || 0,
          thinking: assistantMessage.thinking,
          thinkingLength: assistantMessage.thinking?.length || 0,
          toolCalls: assistantMessage.toolCalls?.length || 0,
          toolResults: assistantMessage.toolResults?.length || 0,
          accumulatedContent: accumulatedContent,
          accumulatedContentLength: accumulatedContent.length,
          fullMessage: JSON.stringify(assistantMessage, null, 2)
        })
        
        // Update with tool results
        onUpdate({
          message: { ...assistantMessage },
          isDone: false
        })
        
        // Continue conversation with tool results
        const toolMessages: Message[] = toolResults.map(tr => ({
          id: `tool_${tr.toolCallId}`,
          role: 'tool',
          content: JSON.stringify(tr.result),
          toolResults: [tr]
        }))
        
        const continuationMessages = [
          ...messages.filter(m => m.role !== 'tool'),
          userMessage,
          {
            ...assistantMessage,
            content: '', // Keep content empty - the model will generate response based on tool results
            thinking: assistantMessage.thinking || accumulatedThinking
          },
          ...toolMessages
        ]
        
        await this.sendMessage(continuationMessages, {
          id: 'continuation',
          role: 'user',
          content: ''
        }, onUpdate, assistantMessageId)
        
        return
      }
      
      // Calculate final metrics
      const duration = (Date.now() - startTime) / 1000
      // Calculate final output tokens from thinking + content
      const { reasoningTokens: finalReasoningTokens, outputTokens: finalOutputTokens } = calculateOutputTokens(
        finalThinking.trim() || '',
        finalContent
      )
      const tokensPerSecond = (finalReasoningTokens + finalOutputTokens) > 0 && duration > 0 
        ? (finalReasoningTokens + finalOutputTokens) / duration 
        : 0
      
      // Final message update
      assistantMessage.content = finalContent
      assistantMessage.thinking = finalThinking.trim() || undefined
      assistantMessage.isStreaming = false
      assistantMessage.isThinking = false
      assistantMessage.duration = duration
      assistantMessage.tokensPerSecond = tokensPerSecond
      assistantMessage.totalTokens = inputTokenCount + finalReasoningTokens + finalOutputTokens
      assistantMessage.inputTokens = inputTokenCount
      assistantMessage.outputTokens = finalOutputTokens
      assistantMessage.reasoningTokens = finalReasoningTokens
      
      // Log the final message after tool call completion
      if (assistantMessage.toolResults && assistantMessage.toolResults.length > 0) {
        console.log('✅ Final message after tool call completion:', {
          id: assistantMessage.id,
          content: assistantMessage.content,
          contentLength: assistantMessage.content?.length || 0,
          thinking: assistantMessage.thinking,
          thinkingLength: assistantMessage.thinking?.length || 0,
          toolCalls: assistantMessage.toolCalls?.length || 0,
          toolResults: assistantMessage.toolResults?.length || 0,
          accumulatedContent: accumulatedContent,
          accumulatedContentLength: accumulatedContent.length,
          finalContent: finalContent,
          finalContentLength: finalContent.length,
          fullMessage: JSON.stringify(assistantMessage, null, 2)
        })
      }
      
      onUpdate({
        message: { ...assistantMessage },
        isDone: true
      })
      
      // Clear abort controller after streaming completes
      this.abortController = null
    } catch (error) {
      // Clear abort controller on error
      this.abortController = null
      
      // Handle abort errors gracefully
      if (error instanceof Error && error.name === 'AbortError') {
        // Preserve all accumulated content and thinking
        const currentContent = accumulatedContent || assistantMessage.content || ''
        const finalExtraction = this.extractThinking(currentContent)
        let finalContent = this.removeToolCalls(finalExtraction.cleanText)
        finalContent = this.cleanTrailingPunctuation(finalContent)
        const finalThinking = finalExtraction.thinking || accumulatedThinking
        
        // Calculate final tokens
        const duration = (Date.now() - startTime) / 1000
        const { reasoningTokens: finalReasoningTokens, outputTokens: finalOutputTokens } = calculateOutputTokens(
          finalThinking.trim() || '',
          finalContent
        )
        const tokensPerSecond = (finalReasoningTokens + finalOutputTokens) > 0 && duration > 0 
          ? (finalReasoningTokens + finalOutputTokens) / duration 
          : 0
        
        // Calculate input tokens if not already calculated
        // Rebuild apiMessages from the conversation history
        const apiMessagesForTokens: any[] = messages
          .filter(m => m.role !== 'tool')
          .map(msg => {
            if (msg.role === 'assistant' && msg.thinking) {
              return {
                role: msg.role,
                content: `${msg.thinking}\n\n${msg.content}`.trim()
              }
            }
            return {
              role: msg.role,
              content: msg.content
            }
          })
        if (userMessage.content.trim()) {
          apiMessagesForTokens.push({
            role: 'user',
            content: userMessage.content
          })
        }
        const inputTokenCount = calculateInputTokens(apiMessagesForTokens)
        
        // Update message with all preserved data
        assistantMessage.content = finalContent + '\n\n⚠️ Request cancelled by user.'
        assistantMessage.thinking = finalThinking.trim() || undefined
        assistantMessage.isStreaming = false
        assistantMessage.isThinking = false
        assistantMessage.duration = duration
        assistantMessage.tokensPerSecond = tokensPerSecond
        assistantMessage.totalTokens = inputTokenCount + finalReasoningTokens + finalOutputTokens
        assistantMessage.inputTokens = inputTokenCount
        assistantMessage.outputTokens = finalOutputTokens
        assistantMessage.reasoningTokens = finalReasoningTokens
        
        onUpdate({
          message: { ...assistantMessage },
          isDone: true
        })
        return
      }
      
      // Update message with error for other errors
      assistantMessage.content = `❌ Error: ${error instanceof Error ? error.message : 'Could not connect to Ollama. Make sure Ollama is running on localhost:11434 with qwen3:4b model.'}`
      assistantMessage.isStreaming = false
      
      onUpdate({
        message: { ...assistantMessage },
        isDone: true
      })
      
      throw error
    } finally {
      // Ensure abort controller is cleared
      this.abortController = null
    }
  }
}
