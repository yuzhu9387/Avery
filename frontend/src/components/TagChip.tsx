import { tint } from '../lib/color'
import type { Tag } from '../api/types'

export function TagChip({ tag, size = 'sm' }: { tag: Tag | undefined; size?: 'sm' | 'xs' }) {
  if (!tag) return null
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-2 py-px text-[11px]',
      ].join(' ')}
      style={{ background: tint(tag.color, 0.35), color: 'var(--ink)' }}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ background: tag.color }}
        aria-hidden
      />
      {tag.name}
    </span>
  )
}
