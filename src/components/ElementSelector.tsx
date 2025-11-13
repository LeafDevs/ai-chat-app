/**
 * ElementSelector - Adds element selection functionality to iframes
 * Allows users to click on elements in rendered HTML/JSX and request changes
 */

import { useEffect, useRef } from 'react'

interface ElementSelectorProps {
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  onElementSelect: (element: HTMLElement, x: number, y: number) => void
  enabled: boolean
}

export function ElementSelector({ iframeRef, onElementSelect, enabled }: ElementSelectorProps) {
  useEffect(() => {
    if (!enabled || !iframeRef.current) return

    const iframe = iframeRef.current
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
    if (!iframeDoc) return

    let isSelecting = false
    let hoveredElement: HTMLElement | null = null

    const highlightElement = (element: HTMLElement | null) => {
      // Remove previous highlights
      iframeDoc.querySelectorAll('.element-selector-highlight').forEach(el => {
        el.classList.remove('element-selector-highlight')
      })

      if (element) {
        element.classList.add('element-selector-highlight')
        hoveredElement = element
      } else {
        hoveredElement = null
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isSelecting) return
      
      const target = e.target as HTMLElement
      if (target && target !== iframeDoc.body && target !== iframeDoc.documentElement) {
        highlightElement(target)
      }
    }

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return // Only left click
      
      isSelecting = true
      const target = e.target as HTMLElement
      if (target && target !== iframeDoc.body && target !== iframeDoc.documentElement) {
        highlightElement(target)
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!isSelecting) return
      isSelecting = false

      if (hoveredElement) {
        // Get position relative to viewport
        const rect = hoveredElement.getBoundingClientRect()
        const iframeRect = iframe.getBoundingClientRect()
        
        const x = iframeRect.left + rect.left + rect.width / 2
        const y = iframeRect.top + rect.top

        onElementSelect(hoveredElement, x, y)
        highlightElement(null)
      }
    }

    const handleClick = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }

    // Add CSS for highlighting
    const style = iframeDoc.createElement('style')
    style.textContent = `
      .element-selector-highlight {
        outline: 2px solid #8b5cf6 !important;
        outline-offset: 2px !important;
        cursor: pointer !important;
        background-color: rgba(139, 92, 246, 0.1) !important;
      }
    `
    if (!iframeDoc.head.querySelector('style[data-element-selector]')) {
      style.setAttribute('data-element-selector', 'true')
      iframeDoc.head.appendChild(style)
    }

    // Add event listeners
    iframeDoc.addEventListener('mousemove', handleMouseMove)
    iframeDoc.addEventListener('mousedown', handleMouseDown)
    iframeDoc.addEventListener('mouseup', handleMouseUp)
    iframeDoc.addEventListener('click', handleClick, true)

    return () => {
      iframeDoc.removeEventListener('mousemove', handleMouseMove)
      iframeDoc.removeEventListener('mousedown', handleMouseDown)
      iframeDoc.removeEventListener('mouseup', handleMouseUp)
      iframeDoc.removeEventListener('click', handleClick, true)
      highlightElement(null)
    }
  }, [iframeRef, onElementSelect, enabled])

  return null
}

