/**
 * JSXRenderer - Renders JSX/React code in a sandboxed iframe
 * Uses @babel/standalone to transpile JSX to JavaScript
 */

import { useEffect, useRef } from 'react'

interface JSXRendererProps {
  code: string
  className?: string
  iframeRef?: React.RefObject<HTMLIFrameElement | null>
}

export function JSXRenderer({ code, className = '', iframeRef: externalIframeRef }: JSXRendererProps) {
  const internalIframeRef = useRef<HTMLIFrameElement>(null)
  const iframeRef = externalIframeRef || internalIframeRef

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    try {
      // Get the iframe's document
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
      if (!iframeDoc) return

      // Escape the code for embedding in template literal
      // We need to escape backticks and ${} but NOT < and > (those are valid JSX)
      const escapedCode = code
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\${/g, '\\${')

      // Set up the iframe HTML with React and Babel from CDN
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>JSX Preview</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      padding: 20px;
      background: #091930;
      color: #e5e7eb;
    }
    #root {
      width: 100%;
      min-height: 100vh;
    }
    .error {
      color: #ef4444;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      padding: 12px;
      border-radius: 6px;
      margin: 12px 0;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      white-space: pre-wrap;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script>
    (function() {
      const { useState, useEffect, useRef, useMemo, useCallback, useContext, createContext, useReducer, useImperativeHandle, useLayoutEffect, useDebugValue, memo, forwardRef, lazy, Suspense, Fragment, StrictMode, createElement } = React;
      
      try {
        const userCode = \`${escapedCode}\`;
        
        // Wrap code if it doesn't export anything or is just JSX
        let wrappedCode = userCode.trim();
        
        // Check if it's already a component function or export
        const hasExport = /export\\s+(default\\s+)?(function|const|class|var|let)/.test(wrappedCode);
        const hasFunction = /^(function|const|class|var|let)\\s+\\w+/.test(wrappedCode);
        
        if (!hasExport && !hasFunction) {
          // Wrap in a simple component
          wrappedCode = \`function App() {
  return (
    \${wrappedCode}
  );
}

export default App;\`;
        } else if (!hasExport && hasFunction) {
          // Add export default if missing
          if (!/export\\s+default/.test(wrappedCode)) {
            const funcMatch = wrappedCode.match(/(function|const|class|var|let)\\s+(\\w+)/);
            if (funcMatch) {
              wrappedCode += \`\\nexport default \${funcMatch[2]};\`;
            }
          }
        }
        
        // Transform JSX to JavaScript
        const transformedCode = Babel.transform(wrappedCode, {
          presets: ['react'],
          plugins: []
        }).code;
        
        // Create a module-like environment
        const module = { exports: {} };
        const exports = module.exports;
        
        // Execute the transformed code
        const func = new Function(
          'React',
          'ReactDOM',
          'useState',
          'useEffect',
          'useRef',
          'useMemo',
          'useCallback',
          'useContext',
          'createContext',
          'useReducer',
          'useImperativeHandle',
          'useLayoutEffect',
          'useDebugValue',
          'memo',
          'forwardRef',
          'lazy',
          'Suspense',
          'Fragment',
          'StrictMode',
          'module',
          'exports',
          transformedCode
        );
        
        func(
          React,
          ReactDOM,
          useState,
          useEffect,
          useRef,
          useMemo,
          useCallback,
          useContext,
          createContext,
          useReducer,
          useImperativeHandle,
          useLayoutEffect,
          useDebugValue,
          memo,
          forwardRef,
          lazy,
          Suspense,
          Fragment,
          StrictMode,
          module,
          exports
        );
        
        // Get the component from exports
        let Component = module.exports.default || module.exports;
        
        // If still not a function, try to find one
        if (typeof Component !== 'function' && typeof Component === 'object' && Component !== null) {
          const keys = Object.keys(Component);
          Component = Component[keys.find(k => typeof Component[k] === 'function')] || Component[keys[0]];
        }
        
        if (typeof Component !== 'function') {
          throw new Error('No valid React component found. Make sure your code exports a component function.');
        }
        
        // Render the component
        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(React.createElement(Component));
        
      } catch (error) {
        const errorMsg = error.toString() + (error.stack ? '\\n\\n' + error.stack : '');
        document.getElementById('root').innerHTML = '<div class="error">Error rendering JSX:\\n\\n' + errorMsg.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
      }
    })();
  </script>
</body>
</html>
      `

      // Write the HTML to the iframe
      iframeDoc.open()
      iframeDoc.write(html)
      iframeDoc.close()
    } catch (error) {
      // Handle errors
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
      if (iframeDoc) {
        iframeDoc.body.innerHTML = `
          <div style="color: #ef4444; padding: 20px; font-family: monospace;">
            <h3>Error loading JSX renderer:</h3>
            <pre>${error instanceof Error ? error.message : String(error)}</pre>
          </div>
        `
      }
    }
  }, [code])

  return (
    <iframe
      ref={iframeRef}
      className={className}
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        backgroundColor: '#091930'
      }}
      sandbox="allow-scripts allow-same-origin"
      title="JSX Preview"
    />
  )
}

