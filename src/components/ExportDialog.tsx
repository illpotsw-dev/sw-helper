import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogActions } from './Dialog.tsx'
import { buttonStyles } from './styles.ts'
import { exportOobYaml } from '../oob/export.ts'
import type { Loaded } from '../oob/load.ts'

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * The design as army-oob.yml, copied to the clipboard — mvp-oob-designer.md §8.
 *
 * The text is shown as well as copied rather than copied silently: clipboard
 * writes are refused outright in a few browser configurations, and on a phone a
 * player may want to read what they are about to paste before pasting it.
 */
export function ExportDialog({
  data,
  onClose,
}: {
  data: Loaded
  onClose: () => void
}) {
  const [copy, setCopy] = useState<CopyState>('idle')
  const textRef = useRef<HTMLTextAreaElement>(null)

  const text = useMemo(
    () =>
      exportOobYaml({
        tree: data.tree,
        formations: data.formations,
        units: data.units,
        design: data.design,
      }),
    [data],
  )

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

  const lines = text.split('\n').length

  return (
    <Dialog
      title="Export YAML"
      description={`${data.design.name} in army-oob.yml format — re-imports unchanged.`}
      wide
      onClose={onClose}
    >
      <textarea
        ref={textRef}
        readOnly
        value={text}
        rows={16}
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
        className="w-full rounded border border-slate-300 bg-slate-50 p-2 font-mono text-xs text-slate-800 focus:border-slate-500 focus:outline-none"
      />
      <p className="mt-1 text-xs text-slate-500">
        {data.formations.length} formation
        {data.formations.length === 1 ? '' : 's'} · {data.units.length} unit
        {data.units.length === 1 ? '' : 's'} · {lines} lines
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
