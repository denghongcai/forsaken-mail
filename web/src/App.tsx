/**
 * Inbox main page:
 *   a full-viewport mail-client shell — header on top, below it a fixed-width
 *   message list and a detail pane that splits the remaining space; each pane
 *   scrolls independently (no page-level scrolling). On mobile selecting a
 *   message switches to a full-screen detail view.
 * Data flow: useAccount manages the account lifecycle; useMessageList /
 * useMessageDetail go through TanStack Query; realtime push invalidates the
 * list via useRealtimeMessages.
 */
import { useCallback, useEffect, useState } from 'react'
import { InboxHeader } from '@/components/inbox-header'
import { MessageDetail } from '@/components/message-detail'
import { MessageList } from '@/components/message-list'
import { ChangeAddressDialog } from '@/components/change-address-dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { useAccount } from '@/hooks/use-account'
import {
  useDeleteMessage,
  useMarkSeen,
  useMessageDetail,
  useMessageList,
  useRealtimeMessages,
  useRealtimeStatus,
} from '@/hooks/use-messages'
import type { MessageSummary } from '@/lib/types'

export default function App() {
  const { state, applyAccount, switchToNewRandom, destroyAndRenew } = useAccount()
  const ready = state.status === 'ready'

  // Currently selected message id; null = show the empty state
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Mobile: hide the list view once a message is selected
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [customDialogOpen, setCustomDialogOpen] = useState(false)

  const listQuery = useMessageList(ready)
  const detailQuery = useMessageDetail(selectedId, ready)
  const realtimeConnected = useRealtimeStatus(ready)
  const markSeen = useMarkSeen()
  const deleteMutation = useDeleteMessage(() => {
    setSelectedId(null)
    setMobileDetailOpen(false)
  })

  // Realtime push → the list refreshes automatically
  useRealtimeMessages(ready)

  /** Select a message: mark it seen at the same time */
  const handleSelect = useCallback(
    (message: MessageSummary) => {
      setSelectedId(message.id)
      setMobileDetailOpen(true)
      if (!message.seen) {
        markSeen.mutate({ id: message.id, seen: true })
      }
    },
    [markSeen],
  )

  // Ask for browser notification permission on first entry (needs a user
  // gesture; failures are silent)
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => undefined)
    }
  }, [])

  /* ------------------------------ State branches ------------------------------ */

  if (state.status === 'loading') {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3">
        <Spinner className="size-6" />
        <p className="text-muted-foreground text-sm">正在准备你的临时邮箱…</p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="flex h-dvh items-center justify-center p-4">
        <Alert>
          <AlertTitle>初始化失败</AlertTitle>
          <AlertDescription>
            {state.message}
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                重试
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const { account } = state

  return (
    // Fixed-height app shell: the header and the two panes fill the viewport;
    // only the panes scroll, never the page itself
    <div className="flex h-dvh flex-col overflow-hidden">
      <InboxHeader
        account={account}
        realtimeConnected={realtimeConnected}
        onNewRandom={() => void switchToNewRandom()}
        onOpenCustomDialog={() => setCustomDialogOpen(true)}
        onDestroyAndRenew={() => void destroyAndRenew()}
      />

      <main className="flex min-h-0 flex-1">
        {/* List column: fixed width, full height, scrolls on its own; hidden
            on mobile while a message is selected */}
        <section
          className={`w-full min-h-0 flex-col overflow-y-auto border-b lg:w-[400px] lg:shrink-0 lg:border-r lg:border-b-0 xl:w-[440px] ${mobileDetailOpen ? 'hidden lg:flex' : 'flex'}`}
        >
          <MessageList
            messages={listQuery.data?.items}
            isLoading={listQuery.isLoading}
            selectedId={selectedId}
            onSelect={handleSelect}
          />
        </section>

        {/* Detail column: takes the rest of the viewport; scrolls inside */}
        <section
          className={`min-h-0 min-w-0 flex-1 flex-col ${mobileDetailOpen ? 'flex' : 'hidden lg:flex'}`}
        >
          <MessageDetail
            messageId={selectedId}
            detail={detailQuery.data}
            isLoading={detailQuery.isLoading}
            onBack={() => setMobileDetailOpen(false)}
            onMarkUnread={(id) => markSeen.mutate({ id, seen: false })}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        </section>
      </main>

      <ChangeAddressDialog
        open={customDialogOpen}
        onOpenChange={setCustomDialogOpen}
        onSwitched={(next) => {
          applyAccount(next)
          setSelectedId(null)
        }}
      />
    </div>
  )
}
