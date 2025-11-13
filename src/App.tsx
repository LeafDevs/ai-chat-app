import { useState, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { Components } from 'react-markdown'
import { ChatService, type Message } from './services/ChatService'
import { webSearch, fetchUrl } from './tools/WebSearch'
import { readFile, writeFile, listFiles, deleteFile, fileExists, searchReplace } from './tools/FileOperations'
import { createTable, type TableData } from './tools/TableRenderer'
import { TableComponent } from './components/TableComponent'
import { FileStorageService } from './services/FileStorageService'
import { JSXRenderer } from './components/JSXRenderer'
import { ElementSelector } from './components/ElementSelector'
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
    
    // Set up tool executor for web search and file operations
    service.setToolExecutor(async (name: string, args: any) => {
      if (name === 'web_search') {
        const results = await webSearch(args.query, 5)
        return results
      }
      if (name === 'fetch_url') {
        const result = await fetchUrl(args.url)
        return result
      }
      if (name === 'read_file') {
        return await readFile(args)
      }
      if (name === 'write_file') {
        const result = await writeFile(args)
        // Track modified file
        if (result.path) {
          setModifiedFiles(prev => new Set(prev).add(result.path))
          // Auto-select the file in preview if agentic mode is enabled
          if (agenticModeEnabled) {
            setSelectedFile(result.path)
          }
        }
        // Refresh file list after write
        if (refreshFilesRef.current) {
          refreshFilesRef.current()
        }
        return result
      }
      if (name === 'list_files') {
        return await listFiles(args)
      }
      if (name === 'delete_file') {
        const result = await deleteFile(args)
        // Remove from modified files if deleted
        if (result.path) {
          setModifiedFiles(prev => {
            const newSet = new Set(prev)
            newSet.delete(result.path)
            return newSet
          })
          if (selectedFile === result.path) {
            setSelectedFile(null)
          }
        }
        // Refresh file list after delete
        if (refreshFilesRef.current) {
          refreshFilesRef.current()
        }
        return result
      }
      if (name === 'file_exists') {
        return await fileExists(args)
      }
      if (name === 'search_replace') {
        const result = await searchReplace(args)
        // Refresh file list after search-replace
        if (refreshFilesRef.current) {
          refreshFilesRef.current()
        }
        // Track modified file
        if (result.path && result.success) {
          setModifiedFiles(prev => new Set(prev).add(result.path))
          if (agenticModeEnabled && !selectedFile) {
            setSelectedFile(result.path)
          }
        }
        return result
      }
      if (name === 'create_table') {
        const result = createTable(args)
        return result
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
  const [agenticModeEnabled, setAgenticModeEnabled] = useState(false) // Whether agentic mode is enabled
  const [showFileManager, setShowFileManager] = useState(false) // Whether file manager is visible
  const [files, setFiles] = useState(FileStorageService.getAllFiles()) // File list
  const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set()) // Files modified in current session
  const [selectedFile, setSelectedFile] = useState<string | null>(null) // Currently selected file for preview
  const [showRawText, setShowRawText] = useState<Record<string, boolean>>({}) // Toggle for raw text view per file
  const [previewMinimized, setPreviewMinimized] = useState(false) // Whether preview panel is minimized
  const [elementSelectionEnabled, setElementSelectionEnabled] = useState(false) // Whether element selection is enabled
  const [selectedElement, setSelectedElement] = useState<{ element: HTMLElement; x: number; y: number } | null>(null) // Selected element in preview
  const [showElementMenu, setShowElementMenu] = useState(false) // Whether to show element context menu
  const [hoveredButton, setHoveredButton] = useState<string | null>(null) // Which button is being hovered for tooltip
  const [hoveredSuggestion, setHoveredSuggestion] = useState<number | null>(null) // Which suggestion is being hovered
  const [hoveredTokensMessageId, setHoveredTokensMessageId] = useState<string | null>(null) // Which message's tokens are being hovered
  const htmlIframeRef = useRef<HTMLIFrameElement>(null) // Ref for HTML iframe
  const jsxIframeRef = useRef<HTMLIFrameElement>(null) // Ref for JSX iframe
  
  // Suggestions for empty state
  const suggestions = [
    { text: 'Write an HTML File', prompt: 'Create a beautiful HTML file with modern styling' },
    { text: 'Build a React Component', prompt: 'Create a React component with TypeScript' },
    { text: 'Create a CSS Animation', prompt: 'Design a CSS animation with keyframes' },
    { text: 'Write a JavaScript Function', prompt: 'Write a JavaScript function with error handling' },
    { text: 'Build a Todo App', prompt: 'Create a todo application with add, edit, and delete functionality' },
    { text: 'Create a Landing Page', prompt: 'Design a modern landing page with hero section' }
  ]
  
  // Refs for DOM manipulationw
  const messagesEndRef = useRef<HTMLDivElement>(null) // Reference to scroll to bottom
  const textareaRef = useRef<HTMLTextAreaElement>(null) // Reference to textarea for auto-resize
  const refreshFilesRef = useRef<(() => void) | null>(null) // Callback to refresh file list

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

  // Update ChatService config when webSearchEnabled or agenticModeEnabled changes
  useEffect(() => {
    chatService.updateConfig({ webSearchEnabled, agenticModeEnabled })
  }, [webSearchEnabled, agenticModeEnabled, chatService])
  
  // Function to refresh file list
  const refreshFiles = () => {
    setFiles(FileStorageService.getAllFiles())
  }
  
  // Set up refresh callback
  useEffect(() => {
    refreshFilesRef.current = refreshFiles
    return () => {
      refreshFilesRef.current = null
    }
  }, [])
  
  // Refresh file list when file manager is shown or after messages update
  useEffect(() => {
    if (showFileManager) {
      refreshFiles()
    }
  }, [showFileManager])
  
  // Refresh files when messages update (in case file operations occurred)
  useEffect(() => {
    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.toolResults) {
      let hasNewFiles = false
      lastMessage.toolResults.forEach(tr => {
        if (tr.name === 'write_file' && tr.result?.path) {
          setModifiedFiles(prev => {
            const newSet = new Set(prev)
            newSet.add(tr.result.path)
            return newSet
          })
          hasNewFiles = true
        } else if (tr.name === 'search_replace' && tr.result?.path && tr.result?.success) {
          setModifiedFiles(prev => {
            const newSet = new Set(prev)
            newSet.add(tr.result.path)
            return newSet
          })
          hasNewFiles = true
        } else if (tr.name === 'delete_file' && tr.result?.path) {
          setModifiedFiles(prev => {
            const newSet = new Set(prev)
            newSet.delete(tr.result.path)
            return newSet
          })
          if (selectedFile === tr.result.path) {
            setSelectedFile(null)
          }
        }
      })
      
      // Auto-select the newest file if none is selected and we have new files
      if (hasNewFiles && agenticModeEnabled && !selectedFile) {
        // Find the newest file from the tool results
        const writeResults = lastMessage.toolResults.filter(tr => 
          (tr.name === 'write_file' || tr.name === 'search_replace') && tr.result?.path
        )
        if (writeResults.length > 0) {
          const newestFile = writeResults[writeResults.length - 1].result.path
          setSelectedFile(newestFile)
        }
      }
      
      if (lastMessage.toolResults.some(tr => 
        ['write_file', 'delete_file', 'search_replace'].includes(tr.name)
      )) {
        refreshFiles()
      }
    }
  }, [messages, agenticModeEnabled, selectedFile])
  
  // Auto-select first file when panel appears
  useEffect(() => {
    if (agenticModeEnabled && modifiedFiles.size > 0 && !selectedFile) {
      const fileArray = Array.from(modifiedFiles)
      setSelectedFile(fileArray[0])
    }
  }, [agenticModeEnabled, modifiedFiles.size])
  
  // Close element menu when clicking outside
  useEffect(() => {
    if (!showElementMenu) return
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-element-menu]')) {
        setShowElementMenu(false)
        setSelectedElement(null)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showElementMenu])

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
                totalTokens: update.message.totalTokens !== undefined ? update.message.totalTokens : msg.totalTokens,
                inputTokens: update.message.inputTokens !== undefined ? update.message.inputTokens : msg.inputTokens,
                outputTokens: update.message.outputTokens !== undefined ? update.message.outputTokens : msg.outputTokens,
                reasoningTokens: update.message.reasoningTokens !== undefined ? update.message.reasoningTokens : msg.reasoningTokens
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
              lineHeight: '1.5',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              overflowWrap: 'break-word'
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
      <div className="overflow-x-auto my-4 rounded-lg border border-gray-700 overflow-hidden bg-[#0a1629]">
        <table className="min-w-full border-collapse">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border-b border-gray-700 px-4 py-3 bg-[#0f2439] font-semibold text-left text-gray-200 first:pl-6 last:pr-6">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-b border-gray-700/50 px-4 py-3 text-gray-300 first:pl-6 last:pr-6 hover:bg-[#0f2439]/30 transition-colors">
        {children}
      </td>
    ),
    tr: ({ children }) => (
      <tr className="last:border-b-0">{children}</tr>
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
  
  /**
   * State for managing collapsed/expanded search results sections
   * Maps message ID to whether search results are expanded
   */
  const [expandedSearchResults, setExpandedSearchResults] = useState<Record<string, boolean>>({})
  
  /**
   * State for managing collapsed/expanded sources sections
   * Maps message ID to whether sources are expanded
   */
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({})
  
  /**
   * State for tracking copied message IDs for visual feedback
   */
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  
  /**
   * Copies the raw JSON of a message to clipboard
   * Includes all fields: content, thinking, toolCalls, toolResults, metrics, etc.
   */
  const copyMessageJSON = async (message: Message) => {
    try {
      const messageJSON = JSON.stringify(message, null, 2)
      await navigator.clipboard.writeText(messageJSON)
      setCopiedMessageId(message.id)
      // Reset the copied state after 2 seconds
      setTimeout(() => setCopiedMessageId(null), 2000)
    } catch (error) {
      console.error('Failed to copy message JSON:', error)
    }
  }

  return (
    <div className="flex flex-col h-screen" style={{ backgroundColor: '#091930' }}>
      {/* Header */}
      <header className="flex-shrink-0 border-b border-gray-700/50" style={{ backgroundColor: '#091930' }}>
        <div className="max-w-5xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#0f2439' }}>
                <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <h1 className="text-lg font-semibold text-gray-100">Chat</h1>
              <span className="text-xs text-gray-400 px-2 py-0.5 rounded-full" style={{ backgroundColor: '#0f2439' }}>{chatService.getModel()}</span>
            </div>
            <div className="flex items-center gap-2">
              {/* File Manager Button */}
              <button
                onClick={() => setShowFileManager(!showFileManager)}
                className={`p-2 rounded-lg transition-all ${
                  showFileManager 
                    ? 'text-blue-400' 
                    : 'text-gray-400 hover:text-gray-300'
                }`}
                style={{
                  backgroundColor: showFileManager ? '#0f2439' : 'transparent'
                }}
                title="File Manager"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Messages and File Preview */}
      <div className="flex-1 overflow-hidden flex" style={{ backgroundColor: '#091930' }}>
        {/* Messages */}
        <div className={`overflow-y-auto ${agenticModeEnabled && modifiedFiles.size > 0 ? 'w-1/2' : 'flex-1'}`} style={{ backgroundColor: '#091930' }}>
          <div className="mx-auto px-6 py-6 max-w-full">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[500px]">
              {/* Centered Input */}
              <div className="w-full max-w-2xl mb-8">
                <motion.form 
                  onSubmit={sendMessage} 
                  className="relative"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <motion.div 
                    className="relative rounded-xl transition-all"
                    style={{ 
                      backgroundColor: '#0f2439',
                      border: '1px solid rgba(107, 114, 128, 0.2)'
                    }}
                    whileHover={{ borderColor: 'rgba(107, 114, 128, 0.4)' }}
                    transition={{ duration: 0.2 }}
                  >
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
                      className="w-full bg-transparent rounded-xl px-4 py-3 resize-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed text-sm leading-relaxed text-gray-100 placeholder-gray-500"
                      style={{
                        minHeight: '44px',
                        maxHeight: '120px',
                        paddingRight: input.trim() ? '100px' : '80px'
                      }}
                    />
                    <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
                      {/* Web Search Button */}
                      <div className="relative">
                        <motion.button
                          type="button"
                          onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                          onMouseEnter={() => setHoveredButton('web_search')}
                          onMouseLeave={() => setHoveredButton(null)}
                          className={`p-1.5 rounded-lg transition-all ${
                            webSearchEnabled 
                              ? 'text-blue-400 bg-blue-400/10' 
                              : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/50'
                          }`}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          style={{
                            filter: webSearchEnabled ? 'drop-shadow(0 0 6px rgba(96, 165, 250, 0.5))' : 'none'
                          }}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                          </svg>
                        </motion.button>
                        
                        {/* Web Search Tooltip */}
                        <AnimatePresence>
                          {hoveredButton === 'web_search' && (
                            <motion.div
                              initial={{ opacity: 0, y: 5, scale: 0.95 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 5, scale: 0.95 }}
                              transition={{ duration: 0.15 }}
                              className="absolute bottom-full right-0 mb-2 px-3 py-2 rounded-lg shadow-xl z-50 whitespace-nowrap"
                              style={{ backgroundColor: '#1f2937', border: '1px solid rgba(107, 114, 128, 0.3)' }}
                            >
                              <div className="text-xs font-semibold text-gray-100 mb-0.5">Web Search</div>
                              <div className="text-xs text-gray-400">Search the web for current information</div>
                              <div className="absolute bottom-0 right-4 transform translate-y-1/2 rotate-45 w-2 h-2" style={{ backgroundColor: '#1f2937', borderRight: '1px solid rgba(107, 114, 128, 0.3)', borderBottom: '1px solid rgba(107, 114, 128, 0.3)' }} />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      
                      {/* Agentic Mode Button */}
                      <div className="relative">
                        <motion.button
                          type="button"
                          onClick={() => setAgenticModeEnabled(!agenticModeEnabled)}
                          onMouseEnter={() => setHoveredButton('agentic_mode')}
                          onMouseLeave={() => setHoveredButton(null)}
                          className={`p-1.5 rounded-lg transition-all ${
                            agenticModeEnabled 
                              ? 'text-purple-400 bg-purple-400/10' 
                              : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/50'
                          }`}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          style={{
                            filter: agenticModeEnabled ? 'drop-shadow(0 0 6px rgba(168, 85, 247, 0.5))' : 'none'
                          }}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                          </svg>
                        </motion.button>
                        
                        {/* Agentic Mode Tooltip */}
                        <AnimatePresence>
                          {hoveredButton === 'agentic_mode' && (
                            <motion.div
                              initial={{ opacity: 0, y: 5, scale: 0.95 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 5, scale: 0.95 }}
                              transition={{ duration: 0.15 }}
                              className="absolute bottom-full right-0 mb-2 px-3 py-2 rounded-lg shadow-xl z-50 whitespace-nowrap"
                              style={{ backgroundColor: '#1f2937', border: '1px solid rgba(107, 114, 128, 0.3)' }}
                            >
                              <div className="text-xs font-semibold text-gray-100 mb-0.5">Agentic Mode</div>
                              <div className="text-xs text-gray-400">Enable AI file editing capabilities</div>
                              <div className="absolute bottom-0 right-4 transform translate-y-1/2 rotate-45 w-2 h-2" style={{ backgroundColor: '#1f2937', borderRight: '1px solid rgba(107, 114, 128, 0.3)', borderBottom: '1px solid rgba(107, 114, 128, 0.3)' }} />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      
                      {/* Send Button - Only show when there's text */}
                      <AnimatePresence>
                        {input.trim() && (
                          <motion.button
                            type="submit"
                            disabled={isLoading || !input.trim()}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            transition={{ duration: 0.15 }}
                            className={`p-1.5 rounded-lg transition-all ${
                              isLoading || !input.trim()
                                ? 'text-gray-600 cursor-not-allowed'
                                : 'text-blue-400 hover:text-blue-300 hover:bg-blue-400/10'
                            }`}
                            whileHover={{ scale: isLoading || !input.trim() ? 1 : 1.05 }}
                            whileTap={{ scale: isLoading || !input.trim() ? 1 : 0.95 }}
                          >
                            {isLoading ? (
                              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                              </svg>
                            )}
                          </motion.button>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                </motion.form>
              </div>
              
              {/* Suggestions */}
              <div className="w-full max-w-2xl">
                <div className="grid grid-cols-2 gap-2">
                  {suggestions.map((suggestion, index) => (
                    <motion.button
                      key={index}
                      onClick={() => {
                        setInput(suggestion.prompt)
                        textareaRef.current?.focus()
                      }}
                      onMouseEnter={() => setHoveredSuggestion(index)}
                      onMouseLeave={() => setHoveredSuggestion(null)}
                      className="text-left px-4 py-3 rounded-lg transition-all border"
                      style={{
                        backgroundColor: hoveredSuggestion === index ? '#0f2439' : 'transparent',
                        borderColor: hoveredSuggestion === index ? 'rgba(107, 114, 128, 0.4)' : 'rgba(107, 114, 128, 0.2)'
                      }}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.05 }}
                    >
                      <div className="text-sm font-medium text-gray-200">{suggestion.text}</div>
                    </motion.button>
                  ))}
                </div>
              </div>
              </div>
            ) : null}

          {messages.length > 0 && (
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
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                      </svg>
                    )}
                  </div>

                  {/* Message bubble */}
                  <div className={`flex-1 max-w-[85%] ${
                    message.role === 'user' ? 'flex flex-col items-end' : 'flex flex-col items-start'
                  }`}>
                    <div className={`rounded-2xl px-4 py-2.5 relative group ${
                      message.role === 'user'
                        ? ''
                        : ''
                    }`} style={{
                      backgroundColor: message.role === 'user' ? '#0f2439' : '#0f2439',
                      color: message.role === 'user' ? '#e5e7eb' : '#e5e7eb',
                      border: message.role === 'user' ? 'none' : '1px solid rgba(107, 114, 128, 0.2)'
                    }}>
                      {/* Copy JSON button - appears on hover or when active */}
                      <button
                        onClick={() => copyMessageJSON(message)}
                        className={`absolute top-2 ${message.role === 'user' ? 'left-2' : 'right-2'} p-1.5 rounded-md transition-all opacity-0 group-hover:opacity-100 hover:bg-gray-700/50 ${
                          copiedMessageId === message.id ? 'opacity-100' : ''
                        }`}
                        style={{
                          backgroundColor: copiedMessageId === message.id ? '#10b981' : 'rgba(15, 36, 57, 0.9)',
                          color: copiedMessageId === message.id ? '#ffffff' : '#9ca3af',
                          zIndex: 10
                        }}
                        title={copiedMessageId === message.id ? 'Copied!' : 'Copy raw JSON'}
                      >
                        {copiedMessageId === message.id ? (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </button>
                      {/* Web Search Indicator - Show if web search was used and completed */}
                      {message.role === 'assistant' && 
                       message.toolResults && 
                       message.toolResults.some(tr => tr.name === 'web_search') && 
                       !message.isStreaming && (
                        <div className="mb-3 pb-2 border-b border-gray-700/50">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-400/10 border border-blue-400/20">
                              {/* Overlapping favicons - show up to 5, overlapping if more than 3 */}
                              <div className="flex items-center" style={{ marginRight: '4px' }}>
                                {message.toolResults
                                  .filter(tr => tr.name === 'web_search' && Array.isArray(tr.result))
                                  .flatMap(tr => tr.result)
                                  .slice(0, 5)
                                  .filter((item: any) => item.favicon)
                                  .map((item: any, idx: number) => (
                                    <div
                                      key={idx}
                                      className="relative"
                                      style={{
                                        marginLeft: idx > 0 ? '-6px' : '0',
                                        zIndex: 5 - idx
                                      }}
                                    >
                                      <img 
                                        src={item.favicon} 
                                        alt="" 
                                        className="w-4 h-4 rounded border border-gray-700/50 bg-gray-800"
                                        onError={(e) => { e.currentTarget.style.display = 'none' }}
                                      />
                                    </div>
                                  ))}
                              </div>
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
                                      // Hide file operation details in agentic mode, show indicators instead
                                      if (agenticModeEnabled && ['read_file', 'write_file', 'delete_file', 'list_files', 'file_exists', 'search_replace'].includes(toolCall.function.name)) {
                                        if (toolCall.function.name === 'write_file') {
                                          return (
                                            <div key={toolCall.id} className="text-xs text-purple-400 bg-purple-400/10 px-2 py-1 rounded flex items-center gap-1">
                                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                              </svg>
                                              File: {args.path || toolCall.function.name}
                                            </div>
                                          )
                                        } else if (toolCall.function.name === 'read_file') {
                                          return (
                                            <div key={toolCall.id} className="text-xs text-purple-400 bg-purple-400/10 px-2 py-1 rounded flex items-center gap-1">
                                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                              </svg>
                                              Reading: {args.path || toolCall.function.name}
                                            </div>
                                          )
                                        } else if (toolCall.function.name === 'delete_file') {
                                          return (
                                            <div key={toolCall.id} className="text-xs text-red-400 bg-red-400/10 px-2 py-1 rounded flex items-center gap-1">
                                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                              </svg>
                                              Deleting: {args.path || toolCall.function.name}
                                            </div>
                                          )
                                        } else if (toolCall.function.name === 'search_replace') {
                                          const replacementCount = Array.isArray(args.replacements) ? args.replacements.length : 0
                                          return (
                                            <div key={toolCall.id} className="text-xs text-purple-400 bg-purple-400/10 px-2 py-1 rounded flex items-center gap-1">
                                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                                              </svg>
                                              Replace: {args.path || toolCall.function.name} ({replacementCount} replacement{replacementCount !== 1 ? 's' : ''})
                                            </div>
                                          )
                                        } else {
                                          return (
                                            <div key={toolCall.id} className="text-xs text-purple-400 bg-purple-400/10 px-2 py-1 rounded">
                                              🔧 {toolCall.function.name}
                                            </div>
                                          )
                                        }
                                      }
                                      // Show web search as before
                                      if (toolCall.function.name === 'web_search') {
                                        return (
                                          <div key={toolCall.id} className="text-xs text-blue-400 bg-blue-400/10 px-2 py-1 rounded">
                                            🔍 Searched: {args.query || toolCall.function.name}
                                          </div>
                                        )
                                      }
                                      return (
                                        <div key={toolCall.id} className="text-xs text-blue-400 bg-blue-400/10 px-2 py-1 rounded">
                                          🔧 {toolCall.function.name}
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
                      
                      {/* Tool results display - minimized like thinking, hide file operation results in agentic mode */}
                      {message.role === 'assistant' && message.toolResults && message.toolResults.length > 0 && 
                       message.toolResults.some(tr => {
                         // In agentic mode, hide file operation results
                         if (agenticModeEnabled && ['read_file', 'write_file', 'delete_file', 'list_files', 'file_exists', 'search_replace'].includes(tr.name)) {
                           return false
                         }
                         return tr.name !== 'web_search' || !message.isStreaming
                       }) && (
                        <div className="mb-3 pb-3 border-b border-gray-700/50">
                          {message.isStreaming || message.isThinking ? (
                            // Show search results indicator while streaming
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                                </svg>
                                <span className="text-xs font-medium text-blue-400">Search Results</span>
                                {message.isThinking && (
                                  <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                                )}
                              </div>
                              {message.toolResults.map((result, idx) => {
                                if (result.name === 'web_search' && Array.isArray(result.result)) {
                                  return (
                                    <div key={idx} className="text-xs text-gray-400">
                                      Found {result.result.length} result{result.result.length !== 1 ? 's' : ''}
                                    </div>
                                  )
                                }
                                return null
                              })}
                            </div>
                          ) : (
                            // Collapsible search results section when done
                            <button
                              onClick={() => setExpandedSearchResults(prev => ({
                                ...prev,
                                [message.id]: !prev[message.id]
                              }))}
                              className="w-full text-left text-xs text-gray-400 hover:text-gray-300 transition-colors flex items-center gap-1"
                            >
                              <svg 
                                className={`w-3 h-3 transition-transform ${expandedSearchResults[message.id] ? 'rotate-90' : ''}`} 
                                fill="none" 
                                stroke="currentColor" 
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                              </svg>
                              Search Results
                              {message.toolResults.some(tr => tr.name === 'web_search' && Array.isArray(tr.result)) && (
                                <span className="text-gray-500">
                                  ({message.toolResults
                                    .filter(tr => tr.name === 'web_search' && Array.isArray(tr.result))
                                    .reduce((sum, tr) => sum + (tr.result as any[]).length, 0)})
                                </span>
                              )}
                            </button>
                          )}
                          {/* Expanded search results content */}
                          {expandedSearchResults[message.id] && !message.isStreaming && !message.isThinking && (
                            <div className="mt-2 space-y-2">
                              {message.toolResults.map((result, idx) => {
                                if (result.name === 'web_search' && Array.isArray(result.result)) {
                                  return (
                                    <div key={idx} className="space-y-2">
                                      {result.result.slice(0, 5).map((item: any, i: number) => (
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
                        </div>
                      )}
                      
                      {/* Main message content */}
                      <div className="text-[15px] leading-relaxed break-words">
                        {/* Render tables from tool results */}
                        {message.toolResults && message.toolResults.map((result, idx) => {
                          if (result.name === 'create_table' && result.result && typeof result.result === 'object') {
                            try {
                              const tableData = result.result as TableData
                              if (tableData.columns && Array.isArray(tableData.columns) && tableData.rows && Array.isArray(tableData.rows)) {
                                return <TableComponent key={`table-${idx}`} data={tableData} />
                              }
                            } catch (e) {
                              // Invalid table data, skip
                            }
                          }
                          return null
                        })}
                        
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
                        
                        {/* Sources section - minimized like search results */}
                        {message.role === 'assistant' && 
                         message.toolResults && 
                         message.toolResults.some(tr => tr.name === 'web_search') && 
                         !message.isStreaming && (
                          <div className="mt-4 pt-3 border-t border-gray-700/50">
                            <button
                              onClick={() => setExpandedSources(prev => ({
                                ...prev,
                                [message.id]: !prev[message.id]
                              }))}
                              className="w-full text-left text-xs text-gray-400 hover:text-gray-300 transition-colors flex items-center gap-1"
                            >
                              <svg 
                                className={`w-3 h-3 transition-transform ${expandedSources[message.id] ? 'rotate-90' : ''}`} 
                                fill="none" 
                                stroke="currentColor" 
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                              </svg>
                              Sources
                              {message.toolResults.some(tr => tr.name === 'web_search' && Array.isArray(tr.result)) && (
                                <span className="text-gray-500">
                                  ({message.toolResults
                                    .filter(tr => tr.name === 'web_search' && Array.isArray(tr.result))
                                    .reduce((sum, tr) => sum + (tr.result as any[]).length, 0)})
                                </span>
                              )}
                            </button>
                            {/* Expanded sources content */}
                            {expandedSources[message.id] && (
                              <div className="mt-2 space-y-1">
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
                            )}
                          </div>
                        )}
                      </div>
                      
                      {/* Metrics display for assistant messages - shows live during streaming */}
                      {message.role === 'assistant' && message.duration !== undefined && (
                        <div className="mt-2 pt-2 border-t border-gray-700/50">
                          <div className="flex items-center gap-4 text-xs text-gray-400">
                            {message.isStreaming && (
                              <motion.button
                                onClick={() => {
                                  chatService.cancelRequest()
                                  // The ChatService will handle updating the message with cancellation notice
                                  // We just need to stop the loading state
                                  setIsLoading(false)
                                }}
                                className="flex items-center gap-1 px-2 py-1 rounded text-red-400 hover:text-red-300 hover:bg-red-400/10 transition-colors"
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                Cancel
                              </motion.button>
                            )}
                            <span className="flex items-center gap-1">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {message.duration.toFixed(1)}s
                            </span>
                            {message.tokensPerSecond !== undefined && message.tokensPerSecond > 0 && (
                              <span className="flex items-center gap-1">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                {message.tokensPerSecond.toFixed(1)} tokens/s
                              </span>
                            )}
                            {!message.isStreaming && message.totalTokens !== undefined && message.totalTokens > 0 && (
                              <div className="relative">
                                <span 
                                  className="flex items-center gap-1 cursor-help"
                                  onMouseEnter={() => setHoveredTokensMessageId(message.id)}
                                  onMouseLeave={() => setHoveredTokensMessageId(null)}
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                                  </svg>
                                  {message.totalTokens} tokens
                                </span>
                                
                                {/* Token Details Tooltip */}
                                <AnimatePresence>
                                  {hoveredTokensMessageId === message.id && (
                                    <motion.div
                                      initial={{ opacity: 0, y: 5, scale: 0.95 }}
                                      animate={{ opacity: 1, y: 0, scale: 1 }}
                                      exit={{ opacity: 0, y: 5, scale: 0.95 }}
                                      transition={{ duration: 0.15 }}
                                      className="absolute bottom-full left-0 mb-2 px-3 py-2 rounded-lg shadow-xl z-50 whitespace-nowrap"
                                      style={{ backgroundColor: '#1f2937', border: '1px solid rgba(107, 114, 128, 0.3)' }}
                                    >
                                      <div className="text-xs font-semibold text-gray-100 mb-1.5">Token Usage</div>
                                      <div className="space-y-1">
                                        {message.inputTokens !== undefined && (
                                          <div className="text-xs text-gray-200">
                                            Input: <span className="font-medium">{message.inputTokens.toLocaleString()}</span> Tokens.
                                          </div>
                                        )}
                                        {message.reasoningTokens !== undefined && message.reasoningTokens > 0 && (
                                          <div className="text-xs text-gray-200">
                                            Reasoning: <span className="font-medium">{message.reasoningTokens.toLocaleString()}</span> Tokens.
                                          </div>
                                        )}
                                        {message.outputTokens !== undefined && (
                                          <div className="text-xs text-gray-200">
                                            Output: <span className="font-medium">{message.outputTokens.toLocaleString()}</span> Tokens.
                                          </div>
                                        )}
                                      </div>
                                      <div className="absolute bottom-0 left-4 transform translate-y-1/2 rotate-45 w-2 h-2" style={{ backgroundColor: '#1f2937', borderRight: '1px solid rgba(107, 114, 128, 0.3)', borderBottom: '1px solid rgba(107, 114, 128, 0.3)' }} />
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
          )}
          </div>
        </div>
        
        {/* File Preview Panel - shown when agentic mode is enabled and files have been modified */}
        {agenticModeEnabled && modifiedFiles.size > 0 && (
          <div className={`${previewMinimized ? 'w-12' : 'w-1/2'} flex-shrink-0 border-l border-gray-700/50 flex flex-col transition-all duration-300`} style={{ backgroundColor: '#091930' }}>
            <div className="flex-shrink-0 border-b border-gray-700/50 px-4 py-3 flex items-center justify-between">
              {!previewMinimized && (
                <>
                  <h3 className="text-sm font-semibold text-gray-100">Files</h3>
                  <span className="text-xs text-gray-400">{modifiedFiles.size} file{modifiedFiles.size !== 1 ? 's' : ''}</span>
                </>
              )}
              <button
                onClick={() => setPreviewMinimized(!previewMinimized)}
                className="p-1.5 rounded text-gray-400 hover:text-gray-300 hover:bg-gray-800/50 transition-colors ml-auto"
                title={previewMinimized ? 'Expand preview' : 'Minimize preview'}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {previewMinimized ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  )}
                </svg>
              </button>
            </div>
            
            {!previewMinimized && (
              <>
            {/* File List - Scrollable */}
            <div className="flex-shrink-0 border-b border-gray-700/50 max-h-32 overflow-y-auto">
              <div className="p-2 space-y-1">
                {Array.from(modifiedFiles).map((filePath) => {
                  const file = FileStorageService.getFile(filePath)
                  if (!file) return null
                  const isSelected = selectedFile === filePath
                  
                  return (
                    <button
                      key={filePath}
                      onClick={() => setSelectedFile(filePath)}
                      className={`w-full text-left p-2 rounded-lg transition-colors ${
                        isSelected 
                          ? 'bg-purple-500/20 border border-purple-500/50' 
                          : 'bg-gray-800/30 hover:bg-gray-800/50 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-200 truncate">{file.name}</p>
                          <p className="text-xs text-gray-500 truncate">{filePath}</p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
            
            {/* File Preview - Takes remaining space */}
            {selectedFile ? (() => {
              const file = FileStorageService.getFile(selectedFile)
              if (!file) return null
              
              const isHTML = /\.(html|htm)$/i.test(file.name)
              const isJSX = /\.(jsx|tsx)$/i.test(file.name)
              const canRender = isHTML || isJSX
              const showRaw = showRawText[selectedFile] || false
              
              return (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex-shrink-0 px-4 py-2 border-b border-gray-700/50 flex items-center justify-between bg-gray-800/30">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-200 truncate">{file.name}</p>
                      <p className="text-xs text-gray-500 truncate">{selectedFile}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {canRender && !showRaw && (
                        <button
                          onClick={() => setElementSelectionEnabled(!elementSelectionEnabled)}
                          className={`px-2 py-1 text-xs rounded transition-colors ${
                            elementSelectionEnabled 
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' 
                              : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
                          }`}
                          title={elementSelectionEnabled ? 'Disable element selection' : 'Enable element selection'}
                        >
                          {elementSelectionEnabled ? '🎯 Selecting' : '🎯 Select'}
                        </button>
                      )}
                      {canRender && (
                        <button
                          onClick={() => setShowRawText(prev => ({ ...prev, [selectedFile]: !prev[selectedFile] }))}
                          className="px-2 py-1 text-xs rounded bg-gray-700/50 text-gray-300 hover:bg-gray-700 transition-colors"
                          title={showRaw ? 'Show rendered' : 'Show raw text'}
                        >
                          {showRaw ? '📄 Raw' : '👁️ Preview'}
                        </button>
                      )}
                      <button
                        onClick={() => FileStorageService.exportFile(selectedFile)}
                        className="p-1.5 rounded text-gray-400 hover:text-blue-400 hover:bg-gray-700/50 transition-colors"
                        title="Download"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto min-h-0">
                    {showRaw || !canRender ? (
                      <div className="p-4">
                        <pre className="text-sm text-gray-300 whitespace-pre-wrap break-words font-mono">
                          {file.content}
                        </pre>
                      </div>
                    ) : isHTML ? (
                      <div className="relative w-full h-full">
                        <iframe
                          ref={htmlIframeRef}
                          srcDoc={file.content}
                          className="w-full h-full border-0"
                          title="HTML Preview"
                          sandbox="allow-scripts allow-same-origin"
                        />
                        <ElementSelector
                          iframeRef={htmlIframeRef}
                          onElementSelect={(element, x, y) => {
                            setSelectedElement({ element, x, y })
                            setShowElementMenu(true)
                          }}
                          enabled={elementSelectionEnabled && !showRaw}
                        />
                      </div>
                    ) : isJSX ? (
                      showRaw ? (
                        <div className="p-4">
                          <pre className="text-sm text-gray-300 whitespace-pre-wrap break-words font-mono">
                            {file.content}
                          </pre>
                        </div>
                      ) : (
                        <div className="relative w-full h-full">
                          <JSXRenderer 
                            code={file.content}
                            className="w-full h-full"
                            iframeRef={jsxIframeRef}
                          />
                          <ElementSelector
                            iframeRef={jsxIframeRef}
                            onElementSelect={(element, x, y) => {
                              setSelectedElement({ element, x, y })
                              setShowElementMenu(true)
                            }}
                            enabled={elementSelectionEnabled && !showRaw}
                          />
                        </div>
                      )
                    ) : (
                      <div className="p-4">
                        <pre className="text-sm text-gray-300 whitespace-pre-wrap break-words font-mono">
                          {file.content}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )
            })() : (
              <div className="flex-1 flex items-center justify-center p-4">
                <div className="text-center">
                  <svg className="w-12 h-12 text-gray-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-sm text-gray-400">Select a file to preview</p>
                </div>
              </div>
            )}
              </>
            )}
          </div>
        )}
        
        {/* Element Selection Context Menu */}
        {showElementMenu && selectedElement && (
          <div
            data-element-menu
            className="fixed z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-3 min-w-[200px]"
            style={{
              left: `${selectedElement.x}px`,
              top: `${selectedElement.y}px`,
              transform: 'translate(-50%, -100%)',
              marginTop: '-8px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-xs text-gray-400 mb-2 pb-2 border-b border-gray-700">
              Element: <span className="text-gray-300">{selectedElement.element.tagName.toLowerCase()}</span>
            </div>
            <button
              onClick={() => {
                const elementInfo = {
                  tag: selectedElement.element.tagName.toLowerCase(),
                  text: selectedElement.element.textContent?.slice(0, 50) || '',
                  classes: Array.from(selectedElement.element.classList).join(' '),
                  id: selectedElement.element.id || '',
                  html: selectedElement.element.outerHTML.slice(0, 200)
                }
                setInput(`Please modify the ${elementInfo.tag} element${elementInfo.id ? ` with id "${elementInfo.id}"` : ''}${elementInfo.classes ? ` with classes "${elementInfo.classes}"` : ''}. ${elementInfo.text ? `Current text: "${elementInfo.text}"` : ''}`)
                setShowElementMenu(false)
                setSelectedElement(null)
                textareaRef.current?.focus()
              }}
              className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 rounded transition-colors mb-1"
            >
              💬 Request changes
            </button>
            <button
              onClick={() => {
                setShowElementMenu(false)
                setSelectedElement(null)
              }}
              className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-gray-700 rounded transition-colors"
            >
              ✕ Cancel
            </button>
          </div>
        )}
      </div>

      {/* Input - Only show when there are messages */}
      {messages.length > 0 && (
        <div className="flex-shrink-0 border-t border-gray-700/50" style={{ backgroundColor: '#091930' }}>
          <div className="max-w-3xl mx-auto px-4 py-3">
            <motion.form 
              onSubmit={sendMessage} 
              className="relative"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
            <motion.div 
              className="relative rounded-xl transition-all"
              style={{ 
                backgroundColor: '#0f2439',
                border: '1px solid rgba(107, 114, 128, 0.2)'
              }}
              whileHover={{ borderColor: 'rgba(107, 114, 128, 0.4)' }}
              transition={{ duration: 0.2 }}
            >
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
                className="w-full bg-transparent rounded-xl px-3 py-2.5 resize-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed text-sm leading-relaxed text-gray-100 placeholder-gray-500"
                style={{
                  minHeight: '36px',
                  maxHeight: '120px',
                  paddingRight: input.trim() ? '100px' : '80px'
                }}
              />
              <div className="absolute right-1.5 bottom-1.5 flex items-center gap-1">
                {/* Web Search Button */}
                <div className="relative">
                  <motion.button
                    type="button"
                    onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                    onMouseEnter={() => setHoveredButton('web_search')}
                    onMouseLeave={() => setHoveredButton(null)}
                    className={`p-1.5 rounded-lg transition-all ${
                      webSearchEnabled 
                        ? 'text-blue-400 bg-blue-400/10' 
                        : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/50'
                    }`}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    style={{
                      filter: webSearchEnabled ? 'drop-shadow(0 0 6px rgba(96, 165, 250, 0.5))' : 'none'
                    }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                  </motion.button>
                  
                  {/* Web Search Tooltip */}
                  <AnimatePresence>
                    {hoveredButton === 'web_search' && (
                      <motion.div
                        initial={{ opacity: 0, y: 5, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 5, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute bottom-full right-0 mb-2 px-3 py-2 rounded-lg shadow-xl z-50 whitespace-nowrap"
                        style={{ backgroundColor: '#1f2937', border: '1px solid rgba(107, 114, 128, 0.3)' }}
                      >
                        <div className="text-xs font-semibold text-gray-100 mb-0.5">Web Search</div>
                        <div className="text-xs text-gray-400">Search the web for current information</div>
                        <div className="absolute bottom-0 right-4 transform translate-y-1/2 rotate-45 w-2 h-2" style={{ backgroundColor: '#1f2937', borderRight: '1px solid rgba(107, 114, 128, 0.3)', borderBottom: '1px solid rgba(107, 114, 128, 0.3)' }} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                
                {/* Agentic Mode Button */}
                <div className="relative">
                  <motion.button
                    type="button"
                    onClick={() => setAgenticModeEnabled(!agenticModeEnabled)}
                    onMouseEnter={() => setHoveredButton('agentic_mode')}
                    onMouseLeave={() => setHoveredButton(null)}
                    className={`p-1.5 rounded-lg transition-all ${
                      agenticModeEnabled 
                        ? 'text-purple-400 bg-purple-400/10' 
                        : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/50'
                    }`}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    style={{
                      filter: agenticModeEnabled ? 'drop-shadow(0 0 6px rgba(168, 85, 247, 0.5))' : 'none'
                    }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                  </motion.button>
                  
                  {/* Agentic Mode Tooltip */}
                  <AnimatePresence>
                    {hoveredButton === 'agentic_mode' && (
                      <motion.div
                        initial={{ opacity: 0, y: 5, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 5, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute bottom-full right-0 mb-2 px-3 py-2 rounded-lg shadow-xl z-50 whitespace-nowrap"
                        style={{ backgroundColor: '#1f2937', border: '1px solid rgba(107, 114, 128, 0.3)' }}
                      >
                        <div className="text-xs font-semibold text-gray-100 mb-0.5">Agentic Mode</div>
                        <div className="text-xs text-gray-400">Enable AI file editing capabilities</div>
                        <div className="absolute bottom-0 right-4 transform translate-y-1/2 rotate-45 w-2 h-2" style={{ backgroundColor: '#1f2937', borderRight: '1px solid rgba(107, 114, 128, 0.3)', borderBottom: '1px solid rgba(107, 114, 128, 0.3)' }} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                
                {/* Send Button - Only show when there's text */}
                <AnimatePresence>
                  {input.trim() && (
                    <motion.button
                      type="submit"
                      disabled={isLoading || !input.trim()}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.15 }}
                      className={`p-1.5 rounded-lg transition-all ${
                        isLoading || !input.trim()
                          ? 'text-gray-600 cursor-not-allowed'
                          : 'text-blue-400 hover:text-blue-300 hover:bg-blue-400/10'
                      }`}
                      whileHover={{ scale: isLoading || !input.trim() ? 1 : 1.05 }}
                      whileTap={{ scale: isLoading || !input.trim() ? 1 : 0.95 }}
                    >
                      {isLoading ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                      )}
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </motion.form>
        </div>
      </div>
      )}
      
      {/* File Manager Sidebar */}
      <AnimatePresence>
        {showFileManager && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 bottom-0 w-96 z-50"
            style={{ backgroundColor: '#091930', borderLeft: '1px solid rgba(107, 114, 128, 0.2)' }}
          >
            <div className="h-full flex flex-col">
              {/* File Manager Header */}
              <div className="flex-shrink-0 border-b border-gray-700/50 px-4 py-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-100">File Manager</h2>
                <button
                  onClick={() => setShowFileManager(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-300 hover:bg-gray-800/50 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* File List */}
              <div className="flex-1 overflow-y-auto px-4 py-4">
                {files.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <svg className="w-12 h-12 text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <p className="text-sm text-gray-400">No files yet</p>
                    <p className="text-xs text-gray-500 mt-1">Enable Agentic Mode to create files</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {files.map((file) => (
                      <div
                        key={file.path}
                        className="p-3 rounded-lg border border-gray-700/50 hover:border-gray-600/50 transition-colors"
                        style={{ backgroundColor: '#0f2439' }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              <p className="text-sm font-medium text-gray-200 truncate" title={file.path}>
                                {file.name}
                              </p>
                            </div>
                            <p className="text-xs text-gray-500 truncate" title={file.path}>
                              {file.path}
                            </p>
                            <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                              <span>{(file.size / 1024).toFixed(2)} KB</span>
                              <span>•</span>
                              <span>{new Date(file.updatedAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => FileStorageService.exportFile(file.path)}
                              className="p-1.5 rounded text-gray-400 hover:text-blue-400 hover:bg-gray-800/50 transition-colors"
                              title="Download"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Delete ${file.name}?`)) {
                                  FileStorageService.deleteFile(file.path)
                                  refreshFiles()
                                }
                              }}
                              className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-gray-800/50 transition-colors"
                              title="Delete"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* File Manager Footer */}
              <div className="flex-shrink-0 border-t border-gray-700/50 px-4 py-3">
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>{files.length} file{files.length !== 1 ? 's' : ''}</span>
                  <span>{(FileStorageService.getStorageSize() / 1024 / 1024).toFixed(2)} MB used</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Overlay when file manager is open */}
      {showFileManager && (
        <div
          className="fixed inset-0 bg-black/20 z-40"
          onClick={() => setShowFileManager(false)}
        />
      )}
    </div>
  )
}

export default App
