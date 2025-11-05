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
}

export interface ChatConfig {
  model?: string
  apiUrl?: string
  temperature?: number
  numPredict?: number
  webSearchEnabled?: boolean
}

export type ToolExecutor = (name: string, args: any) => Promise<any>

export interface StreamUpdate {
  message: Message
  isDone: boolean
}

export type StreamCallback = (update: StreamUpdate) => void

export class ChatService {
  private config: Required<ChatConfig>
  private toolExecutor?: ToolExecutor

  constructor(config: ChatConfig = {}) {
    this.config = {
      model: config.model || 'qwen3:4b',
      apiUrl: config.apiUrl || 'http://localhost:11434/api/chat',
      temperature: config.temperature ?? 0.7,
      numPredict: config.numPredict ?? -1,
      webSearchEnabled: config.webSearchEnabled ?? false,
    }
  }

  /**
   * Sets the tool executor function
   */
  setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor
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
        cleanText = text.replace(/<think>[\s\S]*?(?:<\/think>|<\/redacted_reasoning>)/gi, '').trim()
        return { cleanText, thinking }
      }
    }
    
    for (const pattern of patterns) {
      const matches = [...text.matchAll(pattern)]
      if (matches.length > 0) {
        thinking = matches.map(m => m[1]).join('\n\n')
        cleanText = text.replace(pattern, '').trim()
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
   * Gets the system prompt for web search capabilities
   */
  private getSystemPrompt(): string | undefined {
    if (!this.config.webSearchEnabled) return undefined
    
    return `You are a helpful AI assistant with access to web search capabilities.

When you need to search the web for current information, use the web_search tool. To use it:
1. Think about what information you need to search for
2. Call the web_search function with a clear, specific search query
3. Use the search results to provide an accurate answer

Only use web search when:
- You need current information (news, recent events, current prices, etc.)
- The user asks about something that changes frequently
- You're uncertain about recent facts or data

Do not use web search for:
- General knowledge questions you already know
- Mathematical calculations
- Basic definitions or explanations

When you call a tool, format it as JSON: {"name": "web_search", "arguments": {"query": "your search query here"}}`
  }

  /**
   * Parses tool calls from AI response
   */
  private parseToolCalls(content: string): ToolCall[] {
    const toolCalls: ToolCall[] = []
    
    // Look for JSON tool calls in the format: {"name": "web_search", "arguments": {"query": "..."}}
    const toolCallPattern = /\{"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]+\})\}/g
    let match
    
    while ((match = toolCallPattern.exec(content)) !== null) {
      try {
        const name = match[1]
        const argsStr = match[2]
        
        toolCalls.push({
          id: `tool_call_${Date.now()}_${Math.random()}`,
          type: 'function',
          function: {
            name,
            arguments: argsStr
          }
        })
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
   */
  private removeToolCalls(content: string): string {
    // Remove Ollama tool call tags
    let cleaned = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    // Remove JSON tool call patterns
    cleaned = cleaned.replace(/\{"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^}]+\}\}/g, '')
    return cleaned.trim()
  }

  /**
   * Sends a message to the AI and streams the response
   * Handles tool calling and continues conversation after tool execution
   * 
   * @param messages - Existing conversation history
   * @param userMessage - The new user message to send
   * @param onUpdate - Callback function called for each streaming update
   * @returns Promise that resolves when streaming is complete
   */
  async sendMessage(
    messages: Message[],
    userMessage: Message,
    onUpdate: StreamCallback
  ): Promise<void> {
    const startTime = Date.now()
    let totalTokens = 0
    let evalTokens = 0
    let promptTokens = 0
    let accumulatedThinking = ''
    let buffer = ''

    // Create assistant message placeholder
    const assistantMessageId = (Date.now() + 1).toString()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      duration: 0,
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
            // Format message with tool calls
            return {
              role: msg.role,
              content: msg.content,
              tool_calls: msg.toolCalls.map(tc => ({
                id: tc.id,
                type: tc.type,
                function: tc.function
              }))
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
          return {
            role: msg.role,
            content: msg.content
          }
        })
      
      apiMessages.push(...conversationMessages)
      
      // Add current user message
      apiMessages.push({
        role: 'user',
        content: userMessage.content
      })
      
      // Prepare tools definition if web search is enabled
      const tools = this.config.webSearchEnabled ? [{
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
      }] : undefined

      // Make API request to Ollama
      const response = await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: apiMessages,
          ...(tools && { tools }),
          stream: true,
          options: {
            num_predict: this.config.numPredict,
            temperature: this.config.temperature
          }
        })
      })

      if (!response.ok || !response.body) {
        throw new Error('Failed to connect to Ollama')
      }

      // Set up streaming reader and decoder
      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      // Process streaming chunks
      while (true) {
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
            if (json.prompt_eval_count !== undefined) {
              promptTokens = json.prompt_eval_count
            }
            
            // Chat API format: { message: { role, content, tool_calls }, done: false }
            const messageContent = json.message?.content || json.response || ''
            const thinkingContent = json.message?.thinking || json.thinking || ''
            const toolCalls = json.message?.tool_calls || []
            
            if (messageContent) {
              // Get current message content and append the new chunk
              const currentContent = assistantMessage.content || ''
              
              // Check if chunk is cumulative or incremental
              const isCumulative = currentContent && 
                messageContent.length > currentContent.length && 
                messageContent.includes(currentContent)
              const rawContent = isCumulative ? messageContent : currentContent + messageContent
              
              // Extract thinking from the accumulated content
              const { cleanText, thinking } = this.extractThinking(rawContent)
              
              // Parse tool calls from content
              const parsedToolCalls = this.parseToolCalls(rawContent)
              const allToolCalls = [...(assistantMessage.toolCalls || []), ...parsedToolCalls]
              
              // Remove tool call markers from content
              const contentWithoutToolCalls = this.removeToolCalls(cleanText)
              
              // Update accumulated thinking
              if (thinking) {
                accumulatedThinking = thinking
              }
              
              // Check if currently in thinking mode
              const currentlyInThinking = this.checkThinkingStart(rawContent) && 
                !this.checkThinkingEnd(rawContent)
              
              // Calculate current metrics
              const currentDuration = (Date.now() - startTime) / 1000
              const currentTokensPerSecond = evalTokens > 0 && currentDuration > 0 
                ? evalTokens / currentDuration 
                : 0
              
              // Update assistant message
              assistantMessage.content = contentWithoutToolCalls
              assistantMessage.thinking = accumulatedThinking || 
                (currentlyInThinking ? rawContent : undefined)
              assistantMessage.toolCalls = allToolCalls.length > 0 ? allToolCalls : undefined
              assistantMessage.isThinking = currentlyInThinking || (allToolCalls.length > 0 && !assistantMessage.toolResults)
              assistantMessage.isStreaming = true
              assistantMessage.duration = currentDuration
              assistantMessage.tokensPerSecond = currentTokensPerSecond
              assistantMessage.totalTokens = promptTokens + evalTokens
              
              // Notify callback
              onUpdate({
                message: { ...assistantMessage },
                isDone: false
              })
            }
            
            // Handle native Ollama tool calls
            if (toolCalls && toolCalls.length > 0) {
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
              
              onUpdate({
                message: { ...assistantMessage },
                isDone: false
              })
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
              const currentContent = assistantMessage.content || ''
              
              // Extract thinking from the final content
              const finalExtraction = this.extractThinking(currentContent)
              let finalContent = this.removeToolCalls(finalExtraction.cleanText)
              finalContent = this.cleanTrailingPunctuation(finalContent)
              const finalThinking = finalExtraction.thinking || accumulatedThinking
              
              // Parse any final tool calls
              const finalToolCalls = this.parseToolCalls(currentContent)
              if (finalToolCalls.length > 0) {
                assistantMessage.toolCalls = [...(assistantMessage.toolCalls || []), ...finalToolCalls]
              }
              
              // If we have tool calls, execute them and continue
              if (assistantMessage.toolCalls && assistantMessage.toolCalls.length > 0 && this.toolExecutor) {
                // Execute tools
                const toolResults: ToolResult[] = []
                for (const toolCall of assistantMessage.toolCalls) {
                  try {
                    const args = JSON.parse(toolCall.function.arguments)
                    const result = await this.toolExecutor(toolCall.function.name, args)
                    toolResults.push({
                      toolCallId: toolCall.id,
                      name: toolCall.function.name,
                      result
                    })
                  } catch (error) {
                    toolResults.push({
                      toolCallId: toolCall.id,
                      name: toolCall.function.name,
                      result: { error: error instanceof Error ? error.message : 'Tool execution failed' }
                    })
                  }
                }
                
                assistantMessage.toolResults = toolResults
                assistantMessage.isThinking = false
                
                // Update with tool results
                onUpdate({
                  message: { ...assistantMessage },
                  isDone: false
                })
                
                // Continue conversation with tool results - include tool results in history
                const toolMessages: Message[] = toolResults.map(tr => ({
                  id: `tool_${tr.toolCallId}`,
                  role: 'tool',
                  content: JSON.stringify(tr.result),
                  toolResults: [tr]
                }))
                
                const continuationMessages = [...messages, userMessage, assistantMessage, ...toolMessages]
                await this.sendMessage(continuationMessages, {
                  id: 'continuation',
                  role: 'user',
                  content: '' // Empty user message to continue
                }, onUpdate)
                
                return
              }
              
              // Calculate final metrics
              const duration = (Date.now() - startTime) / 1000
              totalTokens = promptTokens + evalTokens
              const tokensPerSecond = evalTokens > 0 && duration > 0 
                ? evalTokens / duration 
                : 0
              
              // Update final message
              assistantMessage.content = finalContent
              assistantMessage.thinking = finalThinking.trim() || undefined
              assistantMessage.isStreaming = false
              assistantMessage.isThinking = false
              assistantMessage.duration = duration
              assistantMessage.tokensPerSecond = tokensPerSecond
              assistantMessage.totalTokens = totalTokens
              
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

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const json = JSON.parse(buffer)
          
          if (json.eval_count !== undefined) {
            evalTokens = json.eval_count
          }
          if (json.prompt_eval_count !== undefined) {
            promptTokens = json.prompt_eval_count
          }
          
          const messageContent = json.message?.content || json.response || ''
          const thinkingContent = json.message?.thinking || json.thinking || ''
          
          if (messageContent) {
            const currentContent = assistantMessage.content || ''
            const newContent = currentContent + messageContent
            
            const { thinking } = this.extractThinking(newContent)
            if (thinking) {
              accumulatedThinking = thinking
            }
            
            assistantMessage.content = newContent
          }
          
          if (thinkingContent) {
            accumulatedThinking += thinkingContent
          }
        } catch (e) {
          // Ignore parse errors for final buffer
        }
      }

      // Final update to ensure we have all accumulated content
      const currentContent = assistantMessage.content || ''
      const finalExtraction = this.extractThinking(currentContent)
      let finalContent = this.removeToolCalls(finalExtraction.cleanText)
      finalContent = this.cleanTrailingPunctuation(finalContent)
      const finalThinking = finalExtraction.thinking || accumulatedThinking
      
      // Parse any final tool calls
      const finalToolCalls = this.parseToolCalls(currentContent)
      if (finalToolCalls.length > 0) {
        assistantMessage.toolCalls = [...(assistantMessage.toolCalls || []), ...finalToolCalls]
      }
      
      // If we have tool calls and executor, handle them
      if (assistantMessage.toolCalls && assistantMessage.toolCalls.length > 0 && this.toolExecutor && !assistantMessage.toolResults) {
        // Execute tools
        const toolResults: ToolResult[] = []
        for (const toolCall of assistantMessage.toolCalls) {
          try {
            const args = JSON.parse(toolCall.function.arguments)
            const result = await this.toolExecutor(toolCall.function.name, args)
            toolResults.push({
              toolCallId: toolCall.id,
              name: toolCall.function.name,
              result
            })
          } catch (error) {
            toolResults.push({
              toolCallId: toolCall.id,
              name: toolCall.function.name,
              result: { error: error instanceof Error ? error.message : 'Tool execution failed' }
            })
          }
        }
        
        assistantMessage.toolResults = toolResults
        assistantMessage.isThinking = false
        
        // Update with tool results
        onUpdate({
          message: { ...assistantMessage },
          isDone: false
        })
        
        // Continue conversation with tool results - include tool results in history
        const toolMessages: Message[] = toolResults.map(tr => ({
          id: `tool_${tr.toolCallId}`,
          role: 'tool',
          content: JSON.stringify(tr.result),
          toolResults: [tr]
        }))
        
        const continuationMessages = [...messages, userMessage, assistantMessage, ...toolMessages]
        await this.sendMessage(continuationMessages, {
          id: 'continuation',
          role: 'user',
          content: '' // Empty user message to continue
        }, onUpdate)
        
        return
      }
      
      // Calculate final metrics
      const duration = (Date.now() - startTime) / 1000
      totalTokens = promptTokens + evalTokens
      const tokensPerSecond = evalTokens > 0 && duration > 0 
        ? evalTokens / duration 
        : 0
      
      // Final message update
      assistantMessage.content = finalContent
      assistantMessage.thinking = finalThinking.trim() || undefined
      assistantMessage.isStreaming = false
      assistantMessage.isThinking = false
      assistantMessage.duration = duration
      assistantMessage.tokensPerSecond = tokensPerSecond
      assistantMessage.totalTokens = totalTokens
      
      onUpdate({
        message: { ...assistantMessage },
        isDone: true
      })
    } catch (error) {
      // Update message with error
      assistantMessage.content = `❌ Error: ${error instanceof Error ? error.message : 'Could not connect to Ollama. Make sure Ollama is running on localhost:11434 with qwen3:4b model.'}`
      assistantMessage.isStreaming = false
      
      onUpdate({
        message: { ...assistantMessage },
        isDone: true
      })
      
      throw error
    }
  }
}
