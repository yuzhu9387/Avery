import type { ReactNode } from 'react'

export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="mb-3 flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      {children}
    </label>
  )
}
