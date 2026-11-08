/**
 * Reads the text layer of a PDF locally, so a CB-IEP PDF can be imported
 * without sending the file to a model (PRD NFR Privacy: names are removed
 * before any model call, which needs the text first). Handles uncompressed
 * and FlateDecode content streams with literal or hex strings in simple
 * encodings. Scanned PDFs or fonts it cannot decode yield no text, and the
 * route asks for the pasted text instead.
 */

const latin1 = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return s
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }

/** A literal string starting at src[start] === '('. Returns the text and the index after it. */
function readLiteral(src: string, start: number): [string, number] {
  let depth = 0
  let out = ''
  let i = start
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') {
      const next = src[i + 1] ?? ''
      const octal = src.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0]
      if (octal) {
        out += String.fromCharCode(parseInt(octal, 8))
        i += 1 + octal.length
      } else if (next === '\r' || next === '\n') {
        i += next === '\r' && src[i + 2] === '\n' ? 3 : 2
      } else {
        out += ESCAPES[next] ?? next
        i += 2
      }
      continue
    }
    if (c === '(') {
      depth++
      if (depth > 1) out += c
    } else if (c === ')') {
      depth--
      if (depth === 0) return [out, i + 1]
      out += c
    } else {
      out += c
    }
    i++
  }
  return [out, i]
}

/** Text shown by the operators of one content stream, one line per text line. */
export function textFromContent(src: string): string {
  let out = ''
  let pending = ''
  let nums: number[] = []
  let lastY: number | null = null
  const newline = () => {
    if (out && !out.endsWith('\n')) out += '\n'
  }
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '%') {
      while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i++
      continue
    }
    if (c === '(') {
      const [text, next] = readLiteral(src, i)
      pending += text
      i = next
      continue
    }
    if (c === '<' && src[i + 1] !== '<') {
      const end = src.indexOf('>', i)
      const hex = src.slice(i + 1, end === -1 ? src.length : end).replace(/\s+/g, '')
      for (let h = 0; h < hex.length; h += 2) pending += String.fromCharCode(parseInt(hex.slice(h, h + 2).padEnd(2, '0'), 16))
      i = end === -1 ? src.length : end + 1
      continue
    }
    if (/[\s[\]{}<>]/.test(c)) {
      i++
      continue
    }
    const word = src.slice(i).match(/^\/?[^\s()<>[\]{}/%]+/)?.[0] ?? c
    i += word.length
    const num = Number(word)
    if (!Number.isNaN(num) && /^[-+.\d]/.test(word)) {
      // Inside a TJ array a large negative kerning is a word gap.
      if (num < -200 && pending && !pending.endsWith(' ')) pending += ' '
      nums.push(num)
      continue
    }
    if (word === "'" || word === '"') newline()
    if (word === 'Tj' || word === 'TJ' || word === "'" || word === '"') {
      out += pending
      pending = ''
    } else if (word === 'Td' || word === 'TD') {
      if ((nums[nums.length - 1] ?? 0) !== 0) newline()
      else if (out && !/\s$/.test(out)) out += ' '
    } else if (word === 'Tm') {
      const y = nums[nums.length - 1] ?? null
      if (lastY === null || y !== lastY) newline()
      lastY = y
    } else if (word === 'T*' || word === 'ET') {
      newline()
    }
    nums = []
  }
  return out
}

/** Every text line in the PDF's content streams, in file order. Empty when there is no readable text layer. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const src = latin1(bytes)
  const parts: string[] = []
  const streamRe = />>\s*stream\r?\n/g
  for (let m = streamRe.exec(src); m; m = streamRe.exec(src)) {
    // The stream's dictionary: from its object header ("n g obj") to the "stream" keyword.
    const header = src.lastIndexOf(' obj', m.index)
    const dict = src.slice(header === -1 ? 0 : header, m.index)
    const start = m.index + m[0].length
    const end = src.indexOf('endstream', start)
    if (end === -1) break
    streamRe.lastIndex = end
    if (/\/Subtype\s*\/Image|\/Type\s*\/(XRef|XObject|ObjStm)/.test(dict)) continue
    const filters = dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/)?.[1] ?? ''
    // A direct /Length is exact; otherwise drop the end-of-line before "endstream".
    const length = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/)?.[1]
    const stop = length && start + Number(length) <= end ? start + Number(length) : end - (src[end - 2] === '\r' ? 2 : src[end - 1] === '\n' || src[end - 1] === '\r' ? 1 : 0)
    let body: Uint8Array | null = bytes.subarray(start, stop)
    if (filters) {
      if (filters.replace(/[[\]\s]/g, '') !== '/FlateDecode') continue
      body = await inflate(body)
    }
    if (body) parts.push(textFromContent(latin1(body)))
  }
  return parts
    .join('\n')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}
