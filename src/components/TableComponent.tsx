import React from 'react'
import type { TableData } from '../tools/TableRenderer'

interface TableComponentProps {
  data: TableData
}

/**
 * Renders a beautiful, styled table component
 */
export function TableComponent({ data }: TableComponentProps) {
  const { title, columns, rows } = data

  const getAlignment = (align?: string): string => {
    switch (align) {
      case 'center':
        return 'text-center'
      case 'right':
        return 'text-right'
      default:
        return 'text-left'
    }
  }

  return (
    <div className="my-4 rounded-lg overflow-hidden border border-gray-700 bg-[#0a1629]">
      {title && (
        <div className="px-4 py-3 bg-[#0f2439] border-b border-gray-700">
          <h3 className="text-lg font-semibold text-gray-100">{title}</h3>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="bg-[#0f2439] border-b border-gray-700">
              {columns.map((column, index) => (
                <th
                  key={column.key}
                  className={`px-4 py-3 font-semibold text-gray-200 ${getAlignment(column.align)} ${
                    index === 0 ? 'pl-6' : ''
                  } ${index === columns.length - 1 ? 'pr-6' : ''}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className={`border-b border-gray-700/50 hover:bg-[#0f2439]/30 transition-colors ${
                  rowIndex === rows.length - 1 ? 'border-b-0' : ''
                }`}
              >
                {columns.map((column, colIndex) => (
                  <td
                    key={column.key}
                    className={`px-4 py-3 text-gray-300 ${getAlignment(column.align)} ${
                      colIndex === 0 ? 'pl-6' : ''
                    } ${colIndex === columns.length - 1 ? 'pr-6' : ''}`}
                  >
                    {row[column.key] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

