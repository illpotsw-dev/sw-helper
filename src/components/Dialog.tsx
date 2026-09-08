import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Modal shell built on the native <dialog>, which brings focus trapping and
 * Escape-to-close with it. Deliberately not window.confirm: that blocks the
 * page and, with the browser extension attached, wedges the whole session.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-slate-200 p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        {description && (
          <p className="mt-0.5 text-sm text-slate-500">{description}</p>
        )}
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  )
}

export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex flex-wrap justify-end gap-2">{children}</div>
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="mt-3 block first:mt-0">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

