/**
 * Message detail: metadata + three views (HTML preview / plain text / raw
 * source) + attachment download + delete.
 *
 * Security note: the HTML preview renders inside a sandbox="" iframe — no
 * scripts, no same-origin access; hyperlinks embedded in the mail open in a
 * new window by default (handled by the browser).
 */
import { useEffect, useMemo, useState } from 'react'
import { useTheme } from 'next-themes'
import {
  ArrowLeftIcon,
  CodeIcon,
  DownloadIcon,
  FileTextIcon,
  MailOpenIcon,
  PaperclipIcon,
  SunIcon,
  Trash2Icon,
  TypeIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { downloadAttachment, getMessageSource } from '@/lib/api'
import { formatBytes, formatMailTime } from '@/lib/format'
import type { MessageDetail as MessageDetailType } from '@/lib/types'

interface MessageDetailProps {
  /** The message being viewed (null shows the empty state) */
  messageId: string | null
  /** Detail data (provided by the parent's useQuery) */
  detail: MessageDetailType | undefined
  isLoading: boolean
  /** Back to the list (mobile) */
  onBack: () => void
  /** Mark unread (restore the unread state) */
  onMarkUnread: (id: string) => void
  /** Delete the message (the parent clears the selection) */
  onDelete: (id: string) => void
}

/**
 * Preview document builder: in dark mode, injects the app theme's
 * background/foreground tokens as the iframe document's canvas defaults, so
 * unstyled mail stays readable (the app theme is class-based and would not
 * propagate to the sandboxed iframe on its own). Mails that set their own
 * colors are unaffected; mails that hardcode black text need the per-message
 * light-preview override (forceLight skips injection entirely — the browser
 * then renders the default white canvas).
 */
function usePreviewDoc(html: string, forceLight: boolean): string {
  const { resolvedTheme } = useTheme()
  return useMemo(() => {
    if (forceLight || resolvedTheme !== 'dark') return html
    const rootStyle = getComputedStyle(document.documentElement)
    const bg = rootStyle.getPropertyValue('--background').trim()
    const fg = rootStyle.getPropertyValue('--foreground').trim()
    if (bg === '' || fg === '') return html
    const patch = `<style>html{color-scheme:dark;background:${bg};color:${fg}}</style>`
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${patch}`)
    if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${patch}</head>`)
    return patch + html
  }, [html, resolvedTheme, forceLight])
}

/** Attachment row: icon + filename + size + download button */
function AttachmentRow({ attachment }: { attachment: MessageDetailType['attachments'][number] }) {
  const [downloading, setDownloading] = useState(false)

  async function handleDownload(): Promise<void> {
    setDownloading(true)
    try {
      await downloadAttachment(attachment.downloadUrl, attachment.filename)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '附件下载失败')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
      <PaperclipIcon className="text-muted-foreground size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sm">{attachment.filename}</span>
      <span className="text-muted-foreground text-xs whitespace-nowrap">
        {formatBytes(attachment.size)}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => void handleDownload()}
        aria-label="下载附件"
      >
        {downloading ? <Spinner /> : <DownloadIcon />}
      </Button>
    </div>
  )
}

export function MessageDetail({
  messageId,
  detail,
  isLoading,
  onBack,
  onMarkUnread,
  onDelete,
}: MessageDetailProps) {
  /** Raw EML source: loaded on demand when the "source" tab opens */
  const [source, setSource] = useState<string | null>(null)
  /** Per-message override: render the preview on the default light canvas */
  const [lightPreview, setLightPreview] = useState(false)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  /** Preview document with theme defaults injected (dark-mode readability) */
  const previewDoc = usePreviewDoc(detail?.html ?? '', lightPreview)

  // Clear the cached source and the light-preview override when switching messages
  useEffect(() => {
    setSource(null)
    setLightPreview(false)
  }, [messageId])

  /** Fetch the source the first time the tab is opened */
  async function handleSourceTab(): Promise<void> {
    if (messageId === null || source !== null) return
    try {
      setSource(await getMessageSource(messageId))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '源码获取失败')
    }
  }

  // No message selected → empty state
  if (messageId === null) {
    return (
      <Empty className="h-full border-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MailOpenIcon />
          </EmptyMedia>
          <EmptyTitle>选择一封邮件</EmptyTitle>
          <EmptyDescription>点击左侧列表中的邮件查看内容。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  // Loading → skeleton
  if (isLoading || detail === undefined) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    // Full-height reading pane: toolbar + metadata stay pinned on top, the
    // body views below split the remaining height and scroll by themselves
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar row: back (mobile) + action buttons */}
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          onClick={onBack}
          aria-label="返回列表"
        >
          <ArrowLeftIcon />
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onMarkUnread(detail.id)}
                  aria-label="标记为未读"
                />
              }
            >
              <MailOpenIcon />
            </TooltipTrigger>
            <TooltipContent>标记为未读</TooltipContent>
          </Tooltip>
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label="删除邮件" />}
            >
              <Trash2Icon className="text-destructive" />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除这封邮件？</AlertDialogTitle>
                <AlertDialogDescription>
                  「{detail.subject ?? '（无主题）'}」将被永久删除，无法恢复。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(detail.id)}>删除</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Pinned header: metadata + attachments */}
      <div className="flex shrink-0 flex-col gap-4 px-4 pt-1 pb-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg leading-tight font-semibold">
            {detail.subject ?? '（无主题）'}
          </h2>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
            <span className="text-foreground font-medium">
              {detail.from.name ?? detail.from.address}
            </span>
            {detail.from.name !== null && detail.from.name !== '' && (
              <span>&lt;{detail.from.address}&gt;</span>
            )}
            <span>→ {detail.to.map((t) => t.address).join(', ')}</span>
            <Separator orientation="vertical" className="h-3" />
            <span>{formatMailTime(detail.createdAt)}</span>
            <span>{formatBytes(detail.size)}</span>
            {detail.seen ? <Badge variant="secondary">已读</Badge> : <Badge>未读</Badge>}
          </div>
        </div>

        {detail.attachments.length > 0 && (
          <div className="flex flex-col gap-2">
            {detail.attachments
              .filter((a) => !a.contentType.startsWith('image/') || !detail.html)
              .map((a) => (
                <AttachmentRow key={a.id} attachment={a} />
              ))}
          </div>
        )}
      </div>

      {/* Body: three views, each filling the remaining pane height */}
      <Tabs
        defaultValue={detail.html !== null ? 'preview' : 'text'}
        onValueChange={(v) => {
          if (v === 'source') void handleSourceTab()
        }}
        className="min-h-0 flex-1"
      >
        <TabsList className="mx-4 shrink-0">
          {detail.html !== null && (
            <TabsTrigger value="preview">
              <CodeIcon data-icon="inline-start" />
              预览
            </TabsTrigger>
          )}
          <TabsTrigger value="text" disabled={detail.text === null}>
            <TypeIcon data-icon="inline-start" />
            纯文本
          </TabsTrigger>
          <TabsTrigger value="source">
            <FileTextIcon data-icon="inline-start" />
            源码
          </TabsTrigger>
        </TabsList>

        {/* HTML preview: the sandbox="" iframe disables scripts and fills the
            remaining height, scrolling inside like a real mail reader. In dark
            mode, mails that hardcode black text are unreadable on the dark
            canvas — offer a per-message light preview. */}
        {detail.html !== null && (
          <TabsContent value="preview" className="mt-3 flex min-h-0 flex-1 flex-col">
            {isDark && !lightPreview && (
              <div className="text-muted-foreground flex items-center gap-2 pb-2 text-xs">
                <SunIcon className="size-3.5 shrink-0" />
                深色模式下部分邮件可能看不清
                <Button variant="outline" size="xs" onClick={() => setLightPreview(true)}>
                  用浅色显示
                </Button>
              </div>
            )}
            {isDark && lightPreview && (
              <div className="text-muted-foreground flex items-center gap-2 pb-2 text-xs">
                此邮件正以浅色显示
                <Button variant="ghost" size="xs" onClick={() => setLightPreview(false)}>
                  恢复深色
                </Button>
              </div>
            )}
            <iframe
              title="邮件预览"
              sandbox=""
              srcDoc={previewDoc}
              className="min-h-0 w-full flex-1 border-t bg-background"
            />
          </TabsContent>
        )}

        <TabsContent value="text" className="mt-3 flex min-h-0 flex-1 flex-col">
          <pre className="h-full w-full overflow-auto border-t p-4 text-sm whitespace-pre-wrap">
            {detail.text}
          </pre>
        </TabsContent>

        <TabsContent value="source" className="mt-3 flex min-h-0 flex-1 flex-col">
          {source === null ? (
            <div className="text-muted-foreground flex items-center gap-2 border-t p-4 text-sm">
              <Spinner />
              加载源码…
            </div>
          ) : (
            <pre className="h-full w-full overflow-auto border-t p-4 text-xs">{source}</pre>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
