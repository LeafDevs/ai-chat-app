/**
 * FileStorageService - Manages file storage using localStorage
 * 
 * Files are stored in localStorage as JSON objects with metadata
 */

export interface FileMetadata {
  name: string
  path: string
  content: string
  createdAt: number
  updatedAt: number
  size: number
}

export class FileStorageService {
  private static readonly STORAGE_KEY = 'agentic_files'
  private static readonly MAX_STORAGE_SIZE = 5 * 1024 * 1024 // 5MB limit

  /**
   * Gets all files from storage
   */
  static getAllFiles(): FileMetadata[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY)
      if (!stored) return []
      const files = JSON.parse(stored) as Record<string, FileMetadata>
      return Object.values(files)
    } catch (error) {
      console.error('Error reading files from storage:', error)
      return []
    }
  }

  /**
   * Gets a file by path
   */
  static getFile(path: string): FileMetadata | null {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY)
      if (!stored) return null
      const files = JSON.parse(stored) as Record<string, FileMetadata>
      return files[path] || null
    } catch (error) {
      console.error('Error reading file from storage:', error)
      return null
    }
  }

  /**
   * Checks if a file exists
   */
  static fileExists(path: string): boolean {
    return this.getFile(path) !== null
  }

  /**
   * Creates or updates a file
   */
  static writeFile(path: string, content: string): { success: boolean; error?: string; file?: FileMetadata } {
    try {
      // Normalize path (remove leading/trailing slashes, handle .. and .)
      const normalizedPath = this.normalizePath(path)
      
      // Validate path
      if (!this.isValidPath(normalizedPath)) {
        return { success: false, error: 'Invalid file path' }
      }

      // Check storage size
      const currentSize = this.getStorageSize()
      const newFileSize = new Blob([content]).size
      const existingFile = this.getFile(normalizedPath)
      const existingSize = existingFile ? existingFile.size : 0
      
      if (currentSize - existingSize + newFileSize > this.MAX_STORAGE_SIZE) {
        return { success: false, error: 'Storage limit exceeded (5MB)' }
      }

      const stored = localStorage.getItem(this.STORAGE_KEY)
      const files: Record<string, FileMetadata> = stored ? JSON.parse(stored) : {}

      const now = Date.now()
      const fileMetadata: FileMetadata = {
        name: normalizedPath.split('/').pop() || normalizedPath,
        path: normalizedPath,
        content,
        createdAt: existingFile?.createdAt || now,
        updatedAt: now,
        size: newFileSize
      }

      files[normalizedPath] = fileMetadata
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(files))

      return { success: true, file: fileMetadata }
    } catch (error) {
      console.error('Error writing file:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Failed to write file' }
    }
  }

  /**
   * Reads a file's content
   */
  static readFile(path: string): { success: boolean; content?: string; error?: string } {
    try {
      const normalizedPath = this.normalizePath(path)
      const file = this.getFile(normalizedPath)
      
      if (!file) {
        return { success: false, error: `File not found: ${normalizedPath}` }
      }

      return { success: true, content: file.content }
    } catch (error) {
      console.error('Error reading file:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Failed to read file' }
    }
  }

  /**
   * Deletes a file
   */
  static deleteFile(path: string): { success: boolean; error?: string } {
    try {
      const normalizedPath = this.normalizePath(path)
      const stored = localStorage.getItem(this.STORAGE_KEY)
      
      if (!stored) {
        return { success: false, error: 'No files found' }
      }

      const files = JSON.parse(stored) as Record<string, FileMetadata>
      
      if (!files[normalizedPath]) {
        return { success: false, error: `File not found: ${normalizedPath}` }
      }

      delete files[normalizedPath]
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(files))

      return { success: true }
    } catch (error) {
      console.error('Error deleting file:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete file' }
    }
  }

  /**
   * Lists files in a directory (or all files if path is empty)
   */
  static listFiles(path?: string): FileMetadata[] {
    try {
      const allFiles = this.getAllFiles()
      
      if (!path || path === '/' || path === '') {
        return allFiles
      }

      const normalizedPath = this.normalizePath(path)
      const pathWithSlash = normalizedPath.endsWith('/') ? normalizedPath : normalizedPath + '/'

      return allFiles.filter(file => file.path.startsWith(pathWithSlash))
    } catch (error) {
      console.error('Error listing files:', error)
      return []
    }
  }

  /**
   * Creates a directory (actually just a prefix for organization)
   * Directories are implicit based on file paths
   */
  static createDirectory(path: string): { success: boolean; error?: string } {
    // Directories are created implicitly when files are created in them
    // This is just for validation
    const normalizedPath = this.normalizePath(path)
    
    if (!this.isValidPath(normalizedPath)) {
      return { success: false, error: 'Invalid directory path' }
    }

    return { success: true }
  }

  /**
   * Gets the total storage size used
   */
  static getStorageSize(): number {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY)
      if (!stored) return 0
      return new Blob([stored]).size
    } catch {
      return 0
    }
  }

  /**
   * Clears all files
   */
  static clearAll(): void {
    localStorage.removeItem(this.STORAGE_KEY)
  }

  /**
   * Normalizes a file path
   */
  private static normalizePath(path: string): string {
    // Remove leading/trailing slashes
    let normalized = path.trim().replace(/^\/+|\/+$/g, '')
    
    // Handle relative paths
    const parts = normalized.split('/').filter(p => p !== '' && p !== '.')
    const resolved: string[] = []
    
    for (const part of parts) {
      if (part === '..') {
        if (resolved.length > 0) {
          resolved.pop()
        }
      } else {
        resolved.push(part)
      }
    }
    
    return resolved.join('/')
  }

  /**
   * Validates a file path
   */
  private static isValidPath(path: string): boolean {
    if (!path || path.length === 0) return false
    // Prevent absolute paths and dangerous patterns
    if (path.startsWith('/') || path.includes('..')) {
      // We allow .. in normalized paths, but validate after normalization
      return false
    }
    // Prevent certain dangerous characters
    if (/[<>:"|?*\x00-\x1f]/.test(path)) {
      return false
    }
    return true
  }

  /**
   * Exports a file for download
   */
  static exportFile(path: string, filename?: string): { success: boolean; error?: string } {
    try {
      const file = this.getFile(path)
      if (!file) {
        return { success: false, error: 'File not found' }
      }

      const blob = new Blob([file.content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename || file.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      return { success: true }
    } catch (error) {
      console.error('Error exporting file:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Failed to export file' }
    }
  }
}

