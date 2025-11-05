import { useState, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { Components } from 'react-markdown'
import { ChatService, type Message } from './services/ChatService'
import { webSearch } from './tools/WebSearch'
import './App.css'

function App() {
  // Initialize ChatService instance (using useMemo to avoid recreating on each render)
  const chatService = useMemo(() => {
    const service = new ChatService({
      model: 'qwen3:4b',
      apiUrl: 'http://localhost:11434/api/chat',
      temperature: 0.7,
      numPredict: -1
    })
    
    // Set up tool executor for web search
    service.setToolExecutor(async (name: string, args: any) => {
      if (name === 'web_search') {
        const results = await webSearch(args.query, 5)
        return results
      }
      throw new Error(`Unknown tool: ${name}`)
    })
    
    return service
  }, [])

  // State management
  const [messages, setMessages] = useState<Message[]>([]) // All chat messages
  const [input, setInput] = useState('') // Current input text
  const [isLoading, setIsLoading] = useState(false) // Whether a request is in progress
  const [webSearchEnabled, setWebSearchEnabled] = useState(false) // Whether web search is enabled
  
  // Refs for DOM manipulation
  const messagesEndRef = useRef<HTMLDivElement>(null) // Reference to scroll to bottom
  const textareaRef = useRef<HTMLTextAreaElement>(null) // Reference to textarea for auto-resize

  /**
   * Scrolls the messages container to the bottom smoothly
   * Called whenever messages change to keep the latest message visible
   */
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Update ChatService config when webSearchEnabled changes
  useEffect(() => {
    chatService.updateConfig({ webSearchEnabled })
  }, [webSearchEnabled, chatService])

  /**
   * Handles sending a message to the AI via ChatService
   * - Creates user message and adds to chat
   * - Creates placeholder assistant message
   * - Uses ChatService to stream response from Ollama
   * - Updates UI as messages stream in
   */
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    // Create user message from input
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim()
    }

    // Add user message to chat and clear input
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    // Create assistant message placeholder for streaming response
    const assistantMessageId = (Date.now() + 1).toString()
    setMessages(prev => [...prev, {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      duration: 0
    }])

    try {
      // Use ChatService to send message and stream response
      await chatService.sendMessage(
        messages,
        userMessage,
        (update) => {
          // Update the assistant message with streaming updates
          // Always update by matching the assistant message ID
          setMessages(prev => prev.map(msg => {
            if (msg.id === assistantMessageId || msg.id === update.message.id) {
              // Update with the latest content from the API (which is cumulative)
              return {
                ...msg,
                content: update.message.content !== undefined ? update.message.content : msg.content,
                thinking: update.message.thinking !== undefined ? update.message.thinking : msg.thinking,
                toolCalls: update.message.toolCalls !== undefined ? update.message.toolCalls : msg.toolCalls,
                toolResults: update.message.toolResults !== undefined ? update.message.toolResults : msg.toolResults,
                isStreaming: update.message.isStreaming !== undefined ? update.message.isStreaming : msg.isStreaming,
                isThinking: update.message.isThinking !== undefined ? update.message.isThinking : msg.isThinking,
                duration: update.message.duration !== undefined ? update.message.duration : msg.duration,
                tokensPerSecond: update.message.tokensPerSecond !== undefined ? update.message.tokensPerSecond : msg.tokensPerSecond,
                totalTokens: update.message.totalTokens !== undefined ? update.message.totalTokens : msg.totalTokens
              }
            }
            return msg
          }))
        }
      )
    } catch (error) {
      console.error('Error:', error)
      setMessages(prev => prev.map(msg =>
        msg.id === assistantMessageId
          ? {
              ...msg,
              content: `❌ Error: ${error instanceof Error ? error.message : 'Could not connect to Ollama. Make sure Ollama is running on localhost:11434 with qwen3:4b model.'}`,
              isStreaming: false
            }
          : msg
      ))
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * Gets the last N lines of thinking content for display
   */
  const getTruncatedThinking = (thinking: string, isExpanded: boolean, lines: number = 4): string => {
    if (isExpanded || !thinking) return thinking
    const linesArray = thinking.split('\n')
    if (linesArray.length <= lines) return thinking
    return linesArray.slice(-lines).join('\n')
  }

  /**
   * Markdown component configuration for rendering messages
   * Includes syntax highlighting for code blocks
   */
  const markdownComponents: Components = {
    // Code blocks with syntax highlighting
    code({ node, inline, className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '')
      const language = match ? match[1] : ''
      
      return !inline && language ? (
        <div className="my-2 rounded-lg overflow-hidden">
          <SyntaxHighlighter
            style={vscDarkPlus}
            language={language}
            PreTag="div"
            customStyle={{
              margin: 0,
              padding: '12px',
              borderRadius: '8px',
              fontSize: '14px',
              lineHeight: '1.5'
            }}
            {...props}
          >
            {String(children).replace(/\n$/, '')}
          </SyntaxHighlighter>
        </div>
      ) : (
        <code className="bg-[#0f2439] px-1.5 py-0.5 rounded text-sm font-mono text-blue-200" {...props}>
          {children}
        </code>
      )
    },
    // Styled paragraphs
    p: ({ children }) => <p className="mb-2 last:mb-0 text-gray-200">{children}</p>,
    // Styled headings
    h1: ({ children }) => <h1 className="text-2xl font-bold mb-2 mt-4 first:mt-0 text-gray-100">{children}</h1>,
    h2: ({ children }) => <h2 className="text-xl font-bold mb-2 mt-4 first:mt-0 text-gray-100">{children}</h2>,
    h3: ({ children }) => <h3 className="text-lg font-semibold mb-2 mt-3 first:mt-0 text-gray-100">{children}</h3>,
    // Styled lists
    ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1 text-gray-200">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1 text-gray-200">{children}</ol>,
    li: ({ children }) => <li className="ml-4 text-gray-200">{children}</li>,
    // Styled blockquotes
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-blue-400/30 pl-4 italic my-2 text-gray-300">
        {children}
      </blockquote>
    ),
    // Styled links
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 hover:underline">
        {children}
      </a>
    ),
    // Styled horizontal rules
    hr: () => <hr className="my-4 border-gray-600" />,
    // Styled tables
    table: ({ children }) => (
      <div className="overflow-x-auto my-2">
        <table className="min-w-full border-collapse border border-gray-700">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-gray-700 px-4 py-2 bg-[#0f2439] font-semibold text-left text-gray-200">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-gray-700 px-4 py-2 text-gray-300">{children}</td>
    ),
    // Pre tag wrapper (for code blocks)
    pre: ({ children }) => <>{children}</>,
  }

  /**
   * Handles keyboard shortcuts for the textarea
   * - Enter: Send message
   * - Shift+Enter: New line
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(e as any)
    }
  }

  /**
   * State for managing collapsed/expanded thinking sections
   * Maps message ID to whether thinking is expanded
   */
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({})

  return (
    <div className="flex flex-col h-screen" style={{ backgroundColor: '#091930' }}>
      {/* Header */}
      <header className="flex-shrink-0 border-b border-gray-700/50" style={{ backgroundColor: '#091930' }}>
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#0f2439' }}>
              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-gray-100">Chat</h1>
            <span className="text-xs text-gray-400 px-2 py-0.5 rounded-full" style={{ backgroundColor: '#0f2439' }}>{chatService.getModel()}</span>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto" style={{ backgroundColor: '#091930' }}>
        <div className="max-w-3xl mx-auto px-4 py-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: '#0f2439' }}>
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h2 className="text-xl font-medium text-gray-100 mb-1">Start a conversation</h2>
              <p className="text-sm text-gray-400">Send a message to get started</p>
            </div>
          )}

          <div className="space-y-6">
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
                >
                  {/* Avatar */}
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    message.role === 'user' 
                      ? '' 
                      : ''
                  }`} style={{
                    backgroundColor: message.role === 'user' ? '#0f2439' : '#0f2439'
                  }}>
                    {message.role === 'user' ? (
                      <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    )}
                  </div>

                  {/* Message bubble */}
                  <div className={`flex-1 max-w-[85%] ${
                    message.role === 'user' ? 'flex flex-col items-end' : 'flex flex-col items-start'
                  }`}>
                    <div className={`rounded-2xl px-4 py-2.5 ${
                      message.role === 'user'
                        ? ''
                        : ''
                    }`} style={{
                      backgroundColor: message.role === 'user' ? '#0f2439' : '#0f2439',
                      color: message.role === 'user' ? '#e5e7eb' : '#e5e7eb',
                      border: message.role === 'user' ? 'none' : '1px solid rgba(107, 114, 128, 0.2)'
                    }}>
                      {/* Web Search Indicator - Show if web search was used and completed */}
                      {message.role === 'assistant' && 
                       message.toolResults && 
                       message.toolResults.some(tr => tr.name === 'web_search') && 
                       !message.isStreaming && (
                        <div className="mb-3 pb-2 border-b border-gray-700/50">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-400/10 border border-blue-400/20">
                              <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                              </svg>
                              <span className="text-xs font-medium text-blue-400">Web Search Used</span>
                            </div>
                            {message.toolCalls && message.toolCalls
                              .filter(tc => tc.function.name === 'web_search')
                              .map((toolCall, idx) => {
                                try {
                                  const args = JSON.parse(toolCall.function.arguments)
                                  return (
                                    <span key={toolCall.id} className="text-xs text-gray-400 italic">
                                      {idx > 0 && ' • '}
                                      "{args.query}"
                                    </span>
                                  )
                                } catch {
                                  return null
                                }
                              })}
                          </div>
                        </div>
                      )}
                      
                      {/* Web Search In Progress Indicator */}
                      {message.role === 'assistant' && 
                       message.toolCalls && 
                       message.toolCalls.some(tc => tc.function.name === 'web_search') && 
                       !message.toolResults && 
                       (message.isStreaming || message.isThinking) && (
                        <div className="mb-3 pb-2 border-b border-gray-700/50">
                          <div className="flex items-center gap-2">
                            {/* Loading animation: 3 circles with gray-white-gray pattern */}
                            <div className="flex items-center gap-1">
                              <div className="w-1.5 h-1.5 rounded-full bg-gray-500" style={{ animation: 'pulse-wave 1.4s ease-in-out infinite' }} />
                              <div className="w-1.5 h-1.5 rounded-full bg-white" style={{ animation: 'pulse-wave 1.4s ease-in-out infinite 0.2s' }} />
                              <div className="w-1.5 h-1.5 rounded-full bg-gray-500" style={{ animation: 'pulse-wave 1.4s ease-in-out infinite 0.4s' }} />
                            </div>
                            <span className="text-xs font-medium text-blue-400">Searching the web...</span>
                            {message.toolCalls
                              .filter(tc => tc.function.name === 'web_search')
                              .map((toolCall) => {
                                try {
                                  const args = JSON.parse(toolCall.function.arguments)
                                  return (
                                    <span key={toolCall.id} className="text-xs text-gray-400 italic">
                                      "{args.query}"
                                    </span>
                                  )
                                } catch {
                                  return null
                                }
                              })}
                          </div>
                        </div>
                      )}
                      
                      {/* Thinking section - shown in same bubble, collapsed by default when done */}
                      {message.role === 'assistant' && (message.thinking || message.toolCalls) && (
                        <div className="mb-3 pb-3 border-b border-gray-700/50">
                          {message.isStreaming || message.isThinking ? (
                            // Show thinking content while streaming
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                </svg>
                                <span className="text-xs font-medium text-gray-400">Thinking</span>
                                {message.isThinking && (
                                  <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                                )}
                              </div>
                              {/* Hide tool calls when web search is in progress - we show the loading animation instead */}
                              {message.toolCalls && message.toolCalls.length > 0 && 
                               !message.toolCalls.some(tc => tc.function.name === 'web_search') && (
                                <div className="mb-2 space-y-1">
                                  {message.toolCalls.map((toolCall) => {
                                    try {
                                      const args = JSON.parse(toolCall.function.arguments)
                                      return (
                                        <div key={toolCall.id} className="text-xs text-blue-400 bg-blue-400/10 px-2 py-1 rounded">
                                          🔍 Searching: {args.query || toolCall.function.name}
                                        </div>
                                      )
                                    } catch {
                                      return (
                                        <div key={toolCall.id} className="text-xs text-blue-400 bg-blue-400/10 px-2 py-1 rounded">
                                          🔧 {toolCall.function.name}
                                        </div>
                                      )
                                    }
                                  })}
                                </div>
                              )}
                              {/* Show truncated thinking (last 3-4 lines) */}
                              {message.thinking && (
                                <div className="text-xs text-gray-300 whitespace-pre-wrap break-words leading-relaxed">
                                  {getTruncatedThinking(message.thinking, false, 4)}
                                </div>
                              )}
                            </div>
                          ) : (
                            // Collapsible thinking section when done
                            <button
                              onClick={() => setExpandedThinking(prev => ({
                                ...prev,
                                [message.id]: !prev[message.id]
                              }))}
                              className="w-full text-left text-xs text-gray-400 hover:text-gray-300 transition-colors flex items-center gap-1"
                            >
                              <svg 
                                className={`w-3 h-3 transition-transform ${expandedThinking[message.id] ? 'rotate-90' : ''}`} 
                                fill="none" 
                                stroke="currentColor" 
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              Thinking...
                            </button>
                          )}
                          {/* Expanded thinking content */}
                          {expandedThinking[message.id] && !message.isStreaming && !message.isThinking && (
                            <div className="mt-2 space-y-2">
                              {/* Show tool calls */}
                              {message.toolCalls && message.toolCalls.length > 0 && (
                                <div className="space-y-1">
                                  {message.toolCalls.map((toolCall) => {
                                    try {
                                      const args = JSON.parse(toolCall.function.arguments)
                                      return (
                                        <div key={toolCall.id} className="text-xs text-blue-400 bg-blue-400/10 px-2 py-1 rounded">
                                          🔍 Searched: {args.query || toolCall.function.name}
                                        </div>
                                      )
                                    } catch {
                                      return (
                                        <div key={toolCall.id} className="text-xs text-blue-400 bg-blue-400/10 px-2 py-1 rounded">
                                          🔧 {toolCall.function.name}
                                        </div>
                                      )
                                    }
                                  })}
                                </div>
                              )}
                              {/* Show full thinking */}
                              {message.thinking && (
                                <div className="text-xs text-gray-300 whitespace-pre-wrap break-words leading-relaxed">
                                  {message.thinking}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* Tool results display */}
                      {message.role === 'assistant' && message.toolResults && message.toolResults.length > 0 && (
                        <div className="mb-3 pb-3 border-b border-gray-700/50">
                          <div className="flex items-center gap-2 mb-2">
                            <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                            </svg>
                            <span className="text-xs font-medium text-blue-400">Search Results</span>
                          </div>
                          {message.toolResults.map((result, idx) => {
                            if (result.name === 'web_search' && Array.isArray(result.result)) {
                              return (
                                <div key={idx} className="space-y-2">
                                  {result.result.slice(0, 3).map((item: any, i: number) => (
                                    <a
                                      key={i}
                                      href={item.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="block p-2 bg-gray-800/50 rounded-lg hover:bg-gray-800/70 transition-colors border border-gray-700/50"
                                    >
                                      <div className="text-xs font-medium text-blue-400 mb-1 flex items-center gap-1">
                                        {item.favicon && (
                                          <img src={item.favicon} alt="" className="w-3 h-3 rounded" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                                        )}
                                        {item.title}
                                      </div>
                                      <div className="text-xs text-gray-400 line-clamp-2">{item.snippet || item.description}</div>
                                      <div className="text-xs text-gray-500 mt-1 truncate">{item.url}</div>
                                    </a>
                                  ))}
                                </div>
                              )
                            }
                            return null
                          })}
                        </div>
                      )}
                      
                      {/* Main message content */}
                      <div className="text-[15px] leading-relaxed break-words">
                        {message.content ? (
                          <>
                            <ReactMarkdown components={markdownComponents}>
                              {message.content}
                            </ReactMarkdown>
                            {message.isStreaming && !message.isThinking && (
                              <span className="inline-block w-1.5 h-4 bg-current ml-1 animate-pulse align-middle" />
                            )}
                          </>
                        ) : (
                          message.isStreaming && !message.isThinking && (
                            <span className="inline-flex items-center gap-1">
                              <span className="w-1 h-4 bg-current animate-pulse" />
                            </span>
                          )
                        )}
                        
                        {/* Sources section - show URLs used for web search */}
                        {message.role === 'assistant' && 
                         message.toolResults && 
                         message.toolResults.some(tr => tr.name === 'web_search') && 
                         !message.isStreaming && (
                          <div className="mt-4 pt-3 border-t border-gray-700/50">
                            <div className="text-xs text-gray-400 mb-2">Sources:</div>
                            <div className="space-y-1">
                              {message.toolResults.map((result, idx) => {
                                if (result.name === 'web_search' && Array.isArray(result.result)) {
                                  return result.result.slice(0, 5).map((item: any, i: number) => (
                                    <a
                                      key={`${idx}-${i}`}
                                      href={item.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="block text-xs text-blue-400 hover:text-blue-300 hover:underline truncate"
                                    >
                                      {i + 1}. {item.url}
                                    </a>
                                  ))
                                }
                                return null
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                      
                      {/* Metrics display for assistant messages - shows live during streaming */}
                      {message.role === 'assistant' && message.duration !== undefined && (
                        <div className="mt-2 pt-2 border-t border-gray-700/50">
                          <div className="flex items-center gap-4 text-xs text-gray-400">
                            <span>⏱️ {message.duration.toFixed(1)}s</span>
                            {message.tokensPerSecond !== undefined && message.tokensPerSecond > 0 && (
                              <span>⚡ {message.tokensPerSecond.toFixed(1)} tokens/s</span>
                            )}
                            {!message.isStreaming && message.totalTokens !== undefined && message.totalTokens > 0 && (
                              <span>🔢 {message.totalTokens} tokens</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="flex-shrink-0" style={{ backgroundColor: 'transparent' }}>
        <div className="max-w-3xl mx-auto px-4 py-4">
          <form onSubmit={sendMessage} className="relative">
            <div className="relative rounded-2xl transition-colors" style={{ 
              backgroundColor: '#0f2439',
              border: '1px solid rgba(107, 114, 128, 0.2)'
            }}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  // Auto-resize textarea
                  e.target.style.height = 'auto'
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
                }}
                onKeyDown={handleKeyDown}
                placeholder="Message..."
                disabled={isLoading}
                rows={1}
                className="w-full bg-transparent rounded-2xl px-4 py-3 resize-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed text-[15px] leading-relaxed text-gray-100 placeholder-gray-500"
                style={{
                  minHeight: '44px',
                  maxHeight: '120px',
                  paddingRight: '100px'
                }}
              />
              <div className="absolute right-2 bottom-2 flex items-center gap-2">
                {/* Web Search Button */}
                <button
                  type="button"
                  onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                  className={`p-2 rounded-full transition-all ${
                    webSearchEnabled 
                      ? 'text-blue-400' 
                      : 'text-gray-500 hover:text-gray-400'
                  }`}
                  style={{
                    filter: webSearchEnabled ? 'drop-shadow(0 0 8px rgba(96, 165, 250, 0.6))' : 'none'
                  }}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                </button>
                
                {/* Send Button */}
                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className={`rounded-full transition-all ${
                    isLoading || !input.trim()
                      ? 'text-gray-600 cursor-not-allowed'
                      : 'text-blue-400 hover:text-blue-300 active:scale-95'
                  }`}
                  style={{
                    width: '36px',
                    height: '36px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {isLoading ? (
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default App
