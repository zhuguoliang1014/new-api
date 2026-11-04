/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import DOMPurify from 'dompurify'
import { Marked } from 'marked'

const markdown = new Marked({
  gfm: false,
  breaks: true,
  renderer: {
    html: () => '',
    image: ({ text }) => escapeText(text),
  },
})

function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function sanitizeAnnouncementHTML(value: string): string {
  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: ['b', 'i', 's', 'a', 'code', 'pre', 'blockquote'],
    ALLOWED_ATTR: ['href'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  })
}

// The shared Markdown component supports tables, media and math; announcements
// use only the formatting that Telegram can reproduce without fetching media.
export function renderAnnouncementMarkdown(value: string): string {
  if (value.length > 65536) return escapeText(value)
  const container = document.createElement('template')
  container.innerHTML = markdown.parse(value, { async: false })
  function render(
    node: Node,
    depth = 0,
    inQuote = false,
    inInline = false
  ): string {
    if (depth > 64) return ''
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement?.tagName
      if (
        (!parent ||
          parent === 'UL' ||
          parent === 'OL' ||
          parent === 'BLOCKQUOTE') &&
        !node.textContent?.trim()
      ) {
        return ''
      }
      return escapeText(node.textContent ?? '')
    }
    if (
      node.nodeType !== Node.ELEMENT_NODE &&
      node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE
    ) {
      return ''
    }
    const element = node instanceof Element ? node : null
    const name = element?.tagName.toLowerCase() ?? ''
    if (['script', 'style', 'iframe', 'object', 'svg', 'math'].includes(name)) {
      return ''
    }
    let tag = ''
    let ending = ''
    let prefix = ''
    switch (name) {
      case 'strong':
      case 'b':
        tag = 'b'
        break
      case 'em':
      case 'i':
        tag = 'i'
        break
      case 'del':
      case 's':
        tag = 's'
        break
      case 'code':
        tag = 'code'
        break
      case 'pre':
        tag = 'pre'
        ending = '\n\n'
        break
      case 'blockquote':
        if (!inQuote) tag = 'blockquote'
        inQuote = true
        ending = '\n\n'
        break
      case 'p':
        ending = element?.parentElement?.tagName === 'LI' ? '\n' : '\n\n'
        break
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        tag = 'b'
        ending = '\n\n'
        break
      case 'br':
        return '\n'
      case 'li': {
        const parent = element?.parentElement
        const index =
          parent && element ? [...parent.children].indexOf(element) : 0
        const start = Number(parent?.getAttribute('start') ?? 1)
        prefix = parent?.tagName === 'OL' ? `${start + index}. ` : '• '
        ending = '\n'
        break
      }
      case 'ul':
      case 'ol':
        ending = '\n\n'
        break
      case 'a': {
        try {
          const href = element?.getAttribute('href') ?? ''
          const url = new URL(href)
          if (
            ['https:', 'http:'].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !/[\r\n\t]/.test(href)
          ) {
            tag = 'a'
            prefix = `<a href="${escapeText(href)}">`
          }
        } catch {
          /* Unsafe and relative links remain plain text. */
        }
        break
      }
    }
    if ((tag === 'code' || tag === 'pre') && (inInline || inQuote)) tag = ''
    const childInline = inInline || ['b', 'i', 's', 'a'].includes(tag)
    let content = [...node.childNodes]
      .map((child) => render(child, depth + 1, inQuote, childInline))
      .join('')
    if (['blockquote', 'ul', 'ol', 'li'].includes(name)) {
      content = content.replace(/\n+$/, '')
    }
    const opening = tag && tag !== 'a' ? `<${tag}>` : ''
    return prefix + opening + content + (tag ? `</${tag}>` : '') + ending
  }
  return sanitizeAnnouncementHTML(render(container.content).trim())
}
