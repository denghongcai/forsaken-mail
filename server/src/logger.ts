/**
 * Minimal logger on top of node:util — zero external dependencies.
 *
 * Adds what console lacks out of the box: an ISO timestamp, a level tag, and
 * stderr routing for warnings/errors. Arguments are formatted with util.format,
 * so plain strings pass through untouched and objects are inspected.
 * Colors degrade automatically when the stream is not a TTY.
 */
import { format, styleText } from 'node:util'

type Level = 'INFO' | 'WARN' | 'ERROR'

function write(stream: NodeJS.WriteStream, level: Level, message: unknown[]): void {
  const color = level === 'INFO' ? 'blue' : level === 'WARN' ? 'yellow' : 'red'
  const tag = styleText(color, level, { stream })
  stream.write(format('%s [%s] %s\n', new Date().toISOString(), tag, format(...message)))
}

/** Timestamped, level-tagged logging: info → stdout, warn/error → stderr */
export const logger = {
  info: (...message: unknown[]) => write(process.stdout, 'INFO', message),
  warn: (...message: unknown[]) => write(process.stderr, 'WARN', message),
  error: (...message: unknown[]) => write(process.stderr, 'ERROR', message),
}
