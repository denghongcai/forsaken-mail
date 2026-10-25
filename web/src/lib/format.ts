/**
 * Display formatters: time and file size.
 */

/** Message time: today shows the time only; otherwise date + time */
export function formatMailTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return time
  return `${date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${time}`
}

/** File size: B → KB → MB, one decimal place */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
