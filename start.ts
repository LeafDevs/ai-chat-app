#!/usr/bin/env bun

/**
 * Simple script to start both backend and frontend servers
 * Make sure BRAVE_SEARCH_API is set in your environment
 */

export {}

/// <reference types="bun-types" />

console.log('🚀 Starting development servers...')
console.log('📝 Make sure BRAVE_SEARCH_API is set in your environment\n')

// Check if API key is set
if (!process.env.BRAVE_SEARCH_API && !process.env.VITE_BRAVE_SEARCH_API) {
  console.warn('⚠️  Warning: BRAVE_SEARCH_API not found in environment variables')
  console.warn('   Web search will not work until you set it.\n')
}

console.log('🔧 Starting backend server on http://localhost:3001...')
const backend = (globalThis as any).Bun.spawn(['bun', 'run', 'server.ts'], {
  stdout: 'inherit',
  stderr: 'inherit',
  env: { ...process.env }
})

// Wait a bit for backend to start
await new Promise(resolve => setTimeout(resolve, 1000))

console.log('🎨 Starting frontend server...\n')

const frontend = (globalThis as any).Bun.spawn(['bun', 'run', 'dev:frontend'], {
  stdout: 'inherit',
  stderr: 'inherit',
  env: { ...process.env }
})

// Handle cleanup
const cleanup = () => {
  console.log('\n🛑 Shutting down servers...')
  backend.kill()
  frontend.kill()
  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

// Keep the script running
await Promise.all([backend, frontend])

