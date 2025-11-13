/**
 * Backend API server for proxying Brave Search API requests
 * This avoids CORS issues by making requests from the server side
 */

import { serve } from 'bun'

const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API || process.env.VITE_BRAVE_SEARCH_API

serve({
  port: 3001,
  async fetch(req) {
    const url = new URL(req.url)
    
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }
    
    // Proxy Brave Search API requests
    if (url.pathname === '/api/web-search') {
      const searchQuery = url.searchParams.get('q')
      const count = url.searchParams.get('count') || '5'
      
      if (!searchQuery) {
        return new Response(
          JSON.stringify({ error: 'Missing query parameter' }),
          { 
            status: 400,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            }
          }
        )
      }
      
      if (!BRAVE_API_KEY) {
        return new Response(
          JSON.stringify({ error: 'BRAVE_SEARCH_API not configured' }),
          { 
            status: 500,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            }
          }
        )
      }
      
      try {
        const braveUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(searchQuery)}&count=${count}`
        
        const response = await fetch(braveUrl, {
          headers: {
            'Accept': 'application/json',
            'X-Subscription-Token': BRAVE_API_KEY
          }
        })
        
        if (!response.ok) {
          const errorText = await response.text()
          return new Response(
            JSON.stringify({ error: `Brave API error: ${response.status}`, details: errorText }),
            { 
              status: response.status,
              headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              }
            }
          )
        }
        
        const data = await response.json()
        
        return new Response(JSON.stringify(data), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        })
      } catch (error) {
        return new Response(
          JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
          { 
            status: 500,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            }
          }
        )
      }
    }
    
    // Proxy for fetching external pages (to avoid CORS)
    if (url.pathname === '/api/fetch-page') {
      const targetUrl = url.searchParams.get('url')
      
      if (!targetUrl) {
        return new Response(
          JSON.stringify({ error: 'Missing url parameter' }),
          { 
            status: 400,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            }
          }
        )
      }
      
      try {
        const response = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          redirect: 'follow',
        })
        
        if (!response.ok) {
          return new Response(
            JSON.stringify({ error: `Failed to fetch page: ${response.status}` }),
            { 
              status: response.status,
              headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              }
            }
          )
        }
        
        const html = await response.text()
        
        return new Response(JSON.stringify({ html }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        })
      } catch (error) {
        return new Response(
          JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
          { 
            status: 500,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            }
          }
        )
      }
    }
    
    return new Response('Not Found', { status: 404 })
  },
})

console.log('Backend proxy server running on http://localhost:3001')
console.log('Web search proxy: http://localhost:3001/api/web-search')

