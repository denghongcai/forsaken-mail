/**
 * Message list: table view shared by desktop and mobile.
 * Clicking a row selects the message; unread mail carries a dot marker.
 */
import { InboxIcon, PaperclipIcon } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from 'cn'
import { formatBytes, formatMailTime } from '@/lib/format'
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
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>发件人</TableHead>
            <TableHead className="min-w-48">主题</TableHead>
            <TableHead className="hidden text-right md:table-cell">大小</TableHead>
            <TableHead className="w-28 text-right">时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {messages.map((message) => (
            <TableRow
              key={message.id}
              // Unread rows are bold; the selected row is highlighted
              className={cn(
                'cursor-pointer',
                message.id === selectedId && 'bg-muted',
                !message.seen && 'font-medium',
              )}
              onClick={() => onSelect(message)}
            >
              <TableCell className="w-8">
                {/* Unread dot */}
                {!message.seen && (
                  <span aria-label="未读" className="bg-primary size-2 rounded-full" />
                )}
              </TableCell>
              <TableCell className="max-w-40 truncate">{senderLabel(message)}</TableCell>
              <TableCell className="max-w-56">
                <span className="flex items-center gap-1.5">
                  {message.hasAttachments && (
                    <PaperclipIcon className="text-muted-foreground size-3.5 shrink-0" />
                  )}
                  <span className="truncate">{message.subject ?? '（无主题）'}</span>
                </span>
                {message.intro !== null && (
                  <span className="text-muted-foreground block truncate text-xs font-normal">
                    {message.intro}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground hidden text-right text-xs md:table-cell">
                {formatBytes(message.size)}
              </TableCell>
              <TableCell className="text-muted-foreground text-right text-xs whitespace-nowrap">
                {formatMailTime(message.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
