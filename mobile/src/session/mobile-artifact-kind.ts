// Classifies a file path into how the mobile viewer should render it. Images
// route through files.readPreview (base64) and render as an <Image>; HTML routes
// through files.read (text) and renders in a sandboxed WebView with a source
// toggle; everything else stays on the existing text/syntax path.
export type MobileArtifactKind = 'image' | 'html' | 'other'

// Image extensions the host's files.readPreview returns base64 + mimeType for.
// (PDF is previewable on the host too but needs a dedicated renderer — Tier 3.)
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'])

const HTML_EXTENSIONS = new Set(['html', 'htm'])

function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  // A leading dot (dotfile, no real extension) or no dot → no extension.
  if (dot <= 0) {
    return ''
  }
  return base.slice(dot + 1).toLowerCase()
}

export function classifyMobileArtifact(path: string): MobileArtifactKind {
  const ext = extensionOf(path)
  if (IMAGE_EXTENSIONS.has(ext)) {
    return 'image'
  }
  if (HTML_EXTENSIONS.has(ext)) {
    return 'html'
  }
  return 'other'
}
