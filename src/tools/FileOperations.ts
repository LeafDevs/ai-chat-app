/**
 * FileOperations - Tools for file management operations
 * These functions are called by the AI agent to interact with files
 */

import { FileStorageService } from '../services/FileStorageService'

/**
 * Reads a file and returns its content
 */
export async function readFile(args: { path: string }): Promise<any> {
  const { path } = args
  if (!path) {
    return { error: 'Path is required' }
  }

  const result = FileStorageService.readFile(path)
  if (!result.success) {
    return { error: result.error }
  }

  return {
    path,
    content: result.content,
    size: result.content?.length || 0
  }
}

/**
 * Writes content to a file (creates if doesn't exist, updates if exists)
 */
export async function writeFile(args: { path: string; content: string }): Promise<any> {
  const { path, content } = args
  if (!path) {
    return { error: 'Path is required' }
  }
  if (content === undefined) {
    return { error: 'Content is required' }
  }

  const result = FileStorageService.writeFile(path, content)
  if (!result.success) {
    return { error: result.error }
  }

  return {
    path: result.file?.path,
    name: result.file?.name,
    size: result.file?.size,
    createdAt: result.file?.createdAt,
    updatedAt: result.file?.updatedAt,
    message: result.file?.createdAt === result.file?.updatedAt ? 'File created' : 'File updated'
  }
}

/**
 * Lists files in a directory or all files
 */
export async function listFiles(args: { path?: string }): Promise<any> {
  const { path } = args
  const files = FileStorageService.listFiles(path)

  return {
    path: path || '/',
    files: files.map(file => ({
      name: file.name,
      path: file.path,
      size: file.size,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt
    })),
    count: files.length
  }
}

/**
 * Deletes a file
 */
export async function deleteFile(args: { path: string }): Promise<any> {
  const { path } = args
  if (!path) {
    return { error: 'Path is required' }
  }

  const result = FileStorageService.deleteFile(path)
  if (!result.success) {
    return { error: result.error }
  }

  return {
    path,
    message: 'File deleted successfully'
  }
}

/**
 * Checks if a file exists
 */
export async function fileExists(args: { path: string }): Promise<any> {
  const { path } = args
  if (!path) {
    return { error: 'Path is required' }
  }

  const exists = FileStorageService.fileExists(path)
  return {
    path,
    exists
  }
}

/**
 * Search and replace text in a file
 * Supports single or multiple replacements
 * Supports both literal text matching and regex patterns
 * Supports multi-line replacements (before/after can span multiple lines)
 */
export async function searchReplace(args: { 
  path: string
  replacements: Array<{ 
    before: string
    after: string
    useRegex?: boolean
    flags?: string
  }>
}): Promise<any> {
  const { path, replacements } = args
  
  if (!path) {
    return { error: 'Path is required' }
  }
  
  if (!replacements || !Array.isArray(replacements) || replacements.length === 0) {
    return { error: 'Replacements array is required and must not be empty' }
  }
  
  // Validate replacements
  for (const replacement of replacements) {
    if (typeof replacement.before !== 'string' || typeof replacement.after !== 'string') {
      return { error: 'Each replacement must have "before" and "after" strings' }
    }
  }
  
  // Read the file
  const readResult = FileStorageService.readFile(path)
  if (!readResult.success) {
    return { error: readResult.error || 'Failed to read file' }
  }
  
  let content = readResult.content || ''
  const originalContent = content
  const appliedReplacements: Array<{ before: string; after: string; found: boolean; error?: string }> = []
  
  // Apply each replacement
  for (const replacement of replacements) {
    const before = replacement.before
    const after = replacement.after
    const useRegex = replacement.useRegex === true
    const flags = replacement.flags || 'g'
    
    try {
      let regex: RegExp
      
      if (useRegex) {
        // Use regex pattern directly
        try {
          regex = new RegExp(before, flags)
        } catch (regexError) {
          appliedReplacements.push({ 
            before, 
            after, 
            found: false, 
            error: `Invalid regex pattern: ${regexError instanceof Error ? regexError.message : String(regexError)}` 
          })
          continue
        }
      } else {
        // Escape special regex characters for literal matching
        regex = new RegExp(escapeRegExp(before), flags)
      }
      
      // Check if the pattern matches
      const found = regex.test(content)
      
      if (found) {
        // Replace all occurrences (reset regex lastIndex for global flag)
        regex.lastIndex = 0
        content = content.replace(regex, after)
        appliedReplacements.push({ before, after, found: true })
      } else {
        appliedReplacements.push({ before, after, found: false })
      }
    } catch (error) {
      appliedReplacements.push({ 
        before, 
        after, 
        found: false, 
        error: error instanceof Error ? error.message : String(error) 
      })
    }
  }
  
  // Only write if something changed
  if (content !== originalContent) {
    const writeResult = FileStorageService.writeFile(path, content)
    if (!writeResult.success) {
      return { error: writeResult.error || 'Failed to write file' }
    }
    
    return {
      path,
      success: true,
      replacementsApplied: appliedReplacements.filter(r => r.found).length,
      totalReplacements: replacements.length,
      details: appliedReplacements,
      message: `Applied ${appliedReplacements.filter(r => r.found).length} of ${replacements.length} replacement(s)`
    }
  } else {
    return {
      path,
      success: false,
      replacementsApplied: 0,
      totalReplacements: replacements.length,
      details: appliedReplacements,
      message: 'No replacements were applied (text not found)'
    }
  }
}

/**
 * Escapes special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

