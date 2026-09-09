import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogActions } from './Dialog.tsx'
import { buttonStyles } from './styles.ts'

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * A generated document, copied to the clipboard: the design as army-oob.yml
 * (mvp-oob-designer.md §8), or the stockpile report (mvp-stockpile.md §7).
 *
 * The text is shown as well as copied rather than copied silently: clipboard
 * writes are refused outright in a few browser configurations, and on a phone a
 * player may want to read what they are about to paste before pasting it.
 */
export function ExportDialog({
  title,
  description,
  text,
  summary,
  monospace = true,
  onClose,
}: {
  title: string
  description: string
  text: string
  /** The line under the box: what the player is about to paste. */
  summary: string
  /** Off for markdown, which is prose and reads badly in a mono face. */
  monospace?: boolean
  onClose: () => void
}) {
  const [copy, setCopy] = useState<CopyState>('idle')
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (copy === 'idle') return
    const timer = setTimeout(() => setCopy('idle'), 3000)
    return () => clearTimeout(timer)
  }, [copy])

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopy('copied')
    } catch {
      // No clipboard permission, or an insecure context. Selecting the text is
      // the one thing left that still gets the roster out of the app.
      textRef.current?.focus()
      textRef.current?.select()
      setCopy('failed')
    }
  }

  return (
    <Dialog title={title} description={description} wide onClose={onClose}>
      <textarea
        ref={textRef}
        readOnly
        value={text}
        rows={16}
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
        className={`w-full rounded border border-slate-300 bg-slate-50 p-2 text-xs text-slate-800 focus:border-slate-500 focus:outline-none ${monospace ? 'font-mono' : ''}`}
      />
      <p className="mt-1 text-xs text-slate-500">
        {summary} · {text.split('\n').length} lines
      </p>

      <DialogActions>
        {copy === 'copied' && (
          <span className="mr-auto self-center text-sm text-emerald-700">
            Copied to the clipboard.
          </span>
        )}
        {copy === 'failed' && (
          <span className="mr-auto self-center text-sm text-red-700">
            The browser blocked the clipboard — the text is selected, so copy it
            by hand.
          </span>
        )}
        <button type="button" className={buttonStyles.quiet} onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          // Focused on open, so the dialog does not start with the whole
          // roster highlighted by the textarea's select-on-focus.
          autoFocus
          className={buttonStyles.primary}
          onClick={() => void onCopy()}
        >
          Copy
        </button>
      </DialogActions>
    </Dialog>
  )
}
