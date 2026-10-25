/**
 * Message list: stacked rows designed for the fixed-width list pane
 * (sender + time on the first line, subject and intro below).
 * Clicking a row selects the message; unread mail carries a dot marker.
 */
import { InboxIcon, PaperclipIcon } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from 'cn'
import { formatMailTime } from '@/lib/format'
import type { MessageSummary } from '@/lib/types'

interface MessageListProps {
  messages: MessageSummary[] | undefined
  isLoading: boolean
  selectedId: string | null
  onSelect: (message: MessageSummary) => void
}

/** Sender display label: the name when present, otherwise the address */
function senderLabel(message: MessageSummary): string {
  return message.from.name !== null && message.from.name !== ''
    ? message.from.name
    : message.from.address
}

export function MessageList({ messages, isLoading, selectedId, onSelect }: MessageListProps) {
  // Loading: skeleton placeholders
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  // Empty state
  if (messages === undefined || messages.length === 0) {
    return (
      <Empty className="h-full border-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InboxIcon />
          </EmptyMedia>
          <EmptyTitle>等待邮件中…</EmptyTitle>
          <EmptyDescription>把上方地址告诉对方，新邮件会实时出现在这里。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ul className="flex w-full flex-col">
      {messages.map((message) => (
        <li key={message.id}>
          <button
            type="button"
            onClick={() => onSelect(message)}
            aria-current={message.id === selectedId || undefined}
            // Unread rows are bold; the selected row is highlighted
            className={cn(
              'flex w-full flex-col gap-0.5 border-b px-4 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none',
              message.id === selectedId && 'bg-muted hover:bg-muted',
            )}
          >
            {/* Line 1: unread dot + sender + time */}
            <span className="flex w-full items-center gap-2">
              {!message.seen && (
                <span aria-label="未读" className="bg-primary size-2 shrink-0 rounded-full" />
              )}
              <span className={cn('min-w-0 flex-1 truncate text-sm', !message.seen && 'font-medium')}>
                {senderLabel(message)}
              </span>
              {message.hasAttachments && (
                <PaperclipIcon className="text-muted-foreground size-3.5 shrink-0" />
              )}
              <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
                {formatMailTime(message.createdAt)}
              </span>
            </span>
            {/* Line 2: subject */}
            <span
              className={cn('truncate text-sm', !message.seen ? 'font-medium' : 'text-muted-foreground')}
            >
              {message.subject ?? '（无主题）'}
            </span>
            {/* Line 3: plain-text intro (optional) */}
            {message.intro !== null && (
              <span className="text-muted-foreground truncate text-xs">{message.intro}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
