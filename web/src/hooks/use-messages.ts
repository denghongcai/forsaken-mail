/**
 * Message data hooks: TanStack Query manages the list and detail caches;
 * a socket-pushed message:new event invalidates the list (refetch) and shows a toast.
 */
import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { deleteMessage, getMessage, listMessages, setMessageSeen } from '@/lib/api'
import { onNewMessage } from '@/lib/socket'

/** List query key (used for invalidation) */
export const MESSAGES_KEY = ['messages'] as const

/** Message list (first page; 50 messages is plenty for disposable mail) */
export function useMessageList(enabled: boolean) {
  return useQuery({
    queryKey: MESSAGES_KEY,
    queryFn: () => listMessages(),
    enabled,
  })
}

/** Single message detail */
export function useMessageDetail(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['messages', id],
    queryFn: () => getMessage(id as string),
    enabled: enabled && id !== null,
  })
}

/** Subscribe to realtime new messages: invalidate the list + system notification + toast */
export function useRealtimeMessages(enabled: boolean): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled) return
    return onNewMessage((summary) => {
      // New message → refetch the list immediately
      void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
      const who = summary.from.name ?? summary.from.address
      toast(`新邮件来自 ${who}`, { description: summary.subject ?? '（无主题）' })
      // Browser notification (when the user granted permission); the permission
      // request is triggered separately by page interaction
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`新邮件来自 ${who}`, { body: summary.subject ?? '（无主题）' })
      }
    })
  }, [enabled, queryClient])
}

/** Mark seen */
export function useMarkSeen() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, seen }: { id: string; seen: boolean }) => setMessageSeen(id, seen),
    onSuccess: (detail) => {
      // Write the response straight into the cache, saving a GET
      queryClient.setQueryData(['messages', detail.id], detail)
      void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
    },
    onError: (err: Error) => toast.error(`标记失败：${err.message}`),
  })
}

/** Delete a message */
export function useDeleteMessage(onDeleted?: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteMessage(id),
    onSuccess: () => {
      toast.success('邮件已删除')
      void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
      onDeleted?.()
    },
    onError: (err: Error) => toast.error(`删除失败：${err.message}`),
  })
}
