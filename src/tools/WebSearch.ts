/**
 * Tool to perform web search using Brave Search API.
 * API key should be stored in .env as BRAVE_SEARCH_API.
 * For each top result, it fetches the page and attempts to extract a snippet of content,
 * along with the link and site's favicon.
 * 
 * Example Usage:
 *   const results = await webSearch("how to bake sourdough bread");
 */

type BraveSearchResult = {
  url: string
  title: string
  description: string
  favicon: string
  snippet: string
}

export type UrlContent = {
  url: string
  title: string
  content: string
  textContent: string
  error?: string
}

// Helper to extract main snippet from HTML. Simple approach: grabs the first <p> with enough text.
async function extractSnippetFromHTML(html: string): Promise<string> {
  const div = document.createElement('div')
  div.innerHTML = html
  // Try meta description first
  const metaDesc = div.querySelector('meta[name="description"]') as HTMLMetaElement
  if (metaDesc && metaDesc.content) {
    return metaDesc.content
  }
  // Fallback to first lengthy <p>
  const paragraphs = div.getElementsByTagName('p')
  for (let p of paragraphs) {
    const text = p.textContent?.trim() || ''
    if (text.length > 80) {
      return text
    }
  }
  // Return any text content as fallback
  return (div.textContent || '').trim().slice(0, 200)
}

// Helper to extract full readable text content from HTML
function extractTextContent(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  
  // Remove script and style elements
  const scripts = div.querySelectorAll('script, style, noscript')
  scripts.forEach(el => el.remove())
  
  // Try to get main content area (common patterns)
  const mainContent = div.querySelector('main, article, [role="main"], .content, #content, .main-content')
  if (mainContent) {
    return mainContent.textContent?.trim() || ''
  }
  
  // Fallback to body text content
  return div.textContent?.trim() || ''
}

// Helper to extract title from HTML
function extractTitle(html: string, fallbackUrl: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  
  // Try various title sources
  const titleTag = div.querySelector('title')
  if (titleTag?.textContent) {
    return titleTag.textContent.trim()
  }
  
  const ogTitle = div.querySelector('meta[property="og:title"]') as HTMLMetaElement
  if (ogTitle?.content) {
    return ogTitle.content.trim()
  }
  
  const h1 = div.querySelector('h1')
  if (h1?.textContent) {
    return h1.textContent.trim()
  }
  
  // Fallback to URL
  try {
    const urlObj = new URL(fallbackUrl)
    return urlObj.hostname
  } catch {
    return fallbackUrl
  }
}

// Helper to find favicon from the HTML head, or provide a default guess
function extractFaviconURL(html: string, baseUrl: string): string {
  try {
    const dom = document.createElement('div')
    dom.innerHTML = html
    const iconLink = dom.querySelector('link[rel~="icon"]') as HTMLLinkElement
    if (iconLink && iconLink.href) {
      return iconLink.href
    }
    // Fallback to default: {origin}/favicon.ico
    const urlObj = new URL(baseUrl)
    return `${urlObj.origin}/favicon.ico`
  } catch (e) {
    return ""
  }
}

// Fetch page HTML through backend proxy to avoid CORS
async function fetchText(url: string): Promise<string> {
  const proxyUrl = `/api/fetch-page?url=${encodeURIComponent(url)}`
  const res = await fetch(proxyUrl, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    }
  })
  
  if (!res.ok) {
    throw new Error(`Failed to fetch page: ${res.status}`)
  }
  
  const data = await res.json()
  return data.html || ''
}

/**
 * Fetches and extracts readable content from a URL
 * Returns the full text content, title, and HTML content
 */
export async function fetchUrl(url: string): Promise<UrlContent> {
  try {
    const html = await fetchText(url)
    const title = extractTitle(html, url)
    const textContent = extractTextContent(html)
    
    return {
      url,
      title,
      content: html,
      textContent: textContent || 'No readable content found'
    }
  } catch (error) {
    return {
      url,
      title: 'Error',
      content: '',
      textContent: '',
      error: error instanceof Error ? error.message : 'Failed to fetch URL'
    }
  }
}

export async function webSearch(query: string, maxResults = 5): Promise<BraveSearchResult[]> {
  // Use backend proxy to avoid CORS issues
  // Vite proxy will forward /api/web-search to localhost:3001
  const proxyUrl = `/api/web-search?q=${encodeURIComponent(query)}&count=${maxResults}`

  try {
    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      }
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
      throw new Error(`Search API error: ${errorData.error || response.statusText}`)
    }

    const data = await response.json()
    const results = Array.isArray(data.web?.results) ? data.web.results.slice(0, maxResults) : []

    // For each result, try to fetch the page and extract content/snippet and favicon
    const detailedResults: BraveSearchResult[] = await Promise.all(results.map(async (item: any) => {
      let snippet = item.description || ""
      let favicon = ""
      try {
        const pageHtml = await fetchText(item.url)
        // Try to get rich snippet from the page itself if available, fallback to description
        snippet = await extractSnippetFromHTML(pageHtml) || snippet
        favicon = extractFaviconURL(pageHtml, item.url)
      } catch (err) {
        // Network or CORS fetch may fail, fallback to Brave's description and default favicon
        if (item.url) {
          try {
            const urlObj = new URL(item.url)
            favicon = `${urlObj.origin}/favicon.ico`
          } catch {}
        }
      }

      return {
        url: item.url,
        title: item.title,
        description: item.description,
        favicon,
        snippet,
      }
    }))

    return detailedResults
  } catch (error) {
    throw new Error(`Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}