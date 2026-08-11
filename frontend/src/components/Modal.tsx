import { useEffect } from 'react'
import type { ReactNode } from 'react'

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    // `absolute`, not `fixed`: every current caller renders from inside
    // `CalendarOverlayShell`'s content column (`absolute inset-0 ... left-56/left-0`,
    // see that component), which is itself the nearest positioned ancestor. `fixed`
    // sized this against the whole viewport, sidebar included, so centering the panel
    // put it visibly left-of-center over the content column, which sits right of a
    // 224px sidebar. `absolute inset-0` instead sizes and centers this overlay against
    // that content column — exactly the area the modal should sit over — with no
    // context wiring needed, and it isn't clipped by that column's inner
    // `overflow-y-auto` wrapper since its containing block is the column itself, not
    // that wrapper.
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md p-5"
        style={{ background: 'var(--surface-raised)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-card)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h2 className="mb-4 text-sm font-semibold text-ink">{title}</h2>}
        {children}
      </div>
    </div>
  )
}
