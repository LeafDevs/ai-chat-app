/**
 * Tool for rendering structured tables with columns and rows
 * The AI can use this to create nicely formatted tables
 */

export type TableColumn = {
  key: string
  label: string
  align?: 'left' | 'center' | 'right'
}

export type TableData = {
  title?: string
  columns: TableColumn[]
  rows: Array<Record<string, any>>
}

/**
 * Creates a table data structure that can be rendered in the UI
 */
export function createTable(data: TableData): TableData {
  // Validate the structure
  if (!data.columns || !Array.isArray(data.columns)) {
    throw new Error('Table must have a columns array')
  }
  
  if (!data.rows || !Array.isArray(data.rows)) {
    throw new Error('Table must have a rows array')
  }
  
  // Ensure all rows have values for all columns
  const columnKeys = data.columns.map(col => col.key)
  const validatedRows = data.rows.map(row => {
    const validatedRow: Record<string, any> = {}
    columnKeys.forEach(key => {
      validatedRow[key] = row[key] ?? ''
    })
    return validatedRow
  })
  
  return {
    title: data.title,
    columns: data.columns,
    rows: validatedRows
  }
}

