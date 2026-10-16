type Render = (markdown: string) => string

let pipeline: Promise<Render> | null = null

/**
 * Render markdown from the repository.
 *
 * The content is written by the team rather than by strangers, but it is still
 * rendered into the app's own origin, and a repository is exactly the kind of
 * thing that arrives from a colleague. Sanitise unconditionally.
 *
 * The parser and the sanitiser are imported lazily so they stay out of the
 * initial bundle — the board never needs them, and they are a third of the
 * JavaScript.
 */
function load(): Promise<Render> {
  pipeline ??= (async () => {
    const [{ marked }, dompurify] = await Promise.all([import('marked'), import('dompurify')])
    const purify = dompurify.default
    marked.setOptions({ gfm: true, breaks: false })
    return (markdown: string) =>
      purify.sanitize(marked.parse(markdown, { async: false }) as string, {
        ADD_TAGS: ['input'],
        ADD_ATTR: ['type', 'checked', 'disabled', 'target', 'rel'],
        FORBID_TAGS: ['style', 'form'],
      })
  })()
  return pipeline
}

export async function renderMarkdown(markdown: string): Promise<string> {
  const render = await load()
  return render(markdown)
}
