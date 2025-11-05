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

// Universal fetch function for browser and Node.js
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    // Fetch as 'cors' if browser, as 'follow' redirect otherwise
    mode: typeof window !== 'undefined' ? 'cors' : undefined,
    redirect: 'follow',
  })
  return await res.text()
}

export async function webSearch(query: string, maxResults = 5): Promise<BraveSearchResult[]> {
  // Use Vite import.meta.env for browser
  const apiKey = (typeof import.meta !== 'undefined'
    ? (import.meta as any).env?.VITE_BRAVE_SEARCH_API || (import.meta as any).env?.BRAVE_SEARCH_API
    : undefined)

  if (!apiKey) {
    throw new Error("BRAVE_SEARCH_API environment variable not set. Did you prefix it with VITE_?")
  }

  const endpoint = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`

  const response = await fetch(endpoint, {
    headers: {
      "Accept": "application/json",
      "X-Subscription-Token": apiKey
    }
  })

  if (!response.ok) {
    throw new Error(`Brave Search API returned HTTP ${response.status}: ${await response.text()}`)
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
}