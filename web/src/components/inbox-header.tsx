/**
 * Top bar: brand + realtime link badge + current mailbox address (copy/change)
 * + GitHub link + theme toggle.
 */
import { useState } from 'react'
import {
  CheckIcon,
  CopyIcon,
  MailIcon,
  RefreshCwIcon,
  UserRoundPenIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { GithubIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from 'cn'
import type { StoredAccount } from '@/lib/account'

interface InboxHeaderProps {
  account: StoredAccount
  /** Whether the realtime socket is currently connected */
  realtimeConnected: boolean
  /** Switch to a new random address */
  onNewRandom: () => void
  /** Open the "custom address" dialog */
  onOpenCustomDialog: () => void
  /** Delete the current account and switch to a new one */
  onDestroyAndRenew: () => void
}

/** Repository URL for the GitHub badge */
const GITHUB_URL = 'https://github.com/denghongcai/forsaken-mail'

export function InboxHeader({
  account,
  realtimeConnected,
  onNewRandom,
  onOpenCustomDialog,
  onDestroyAndRenew,
}: InboxHeaderProps) {
  const [copied, setCopied] = useState(false)

  /** Copy the full address to the clipboard */
  async function copyAddress(): Promise<void> {
    await navigator.clipboard.writeText(account.address)
    setCopied(true)
    toast.success('地址已复制')
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    // Full-width toolbar; no page scrolling happens beneath it (app shell),
    // so no sticky/backdrop treatment is needed
    <header className="bg-background border-b">
      <div className="flex h-14 w-full items-center gap-3 px-4">
        {/* Brand */}
        <div className="flex shrink-0 items-center gap-2 font-semibold">
          <MailIcon className="text-primary" />
          <span className="hidden sm:inline">Forsaken Mail</span>
        </div>

        {/* Realtime link badge: green = push connected, amber = reconnecting */}
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={cn(
                  'hidden items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-muted-foreground text-xs md:flex',
                )}
                aria-live="polite"
              />
            }
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                realtimeConnected ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-amber-500',
                !realtimeConnected && 'animate-pulse',
              )}
            />
            {realtimeConnected ? '实时' : '重连中'}
          </TooltipTrigger>
          <TooltipContent>
            {realtimeConnected ? '实时推送已连接' : '连接断开，正在自动重连…'}
          </TooltipContent>
        </Tooltip>

        {/* Current address: read-only input + copy button */}
        <InputGroup className="mx-auto h-9 w-full max-w-md">
          <InputGroupInput value={account.address} readOnly aria-label="当前邮箱地址" />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              onClick={() => void copyAddress()}
              aria-label="复制地址"
            >
              {copied ? <CheckIcon className="text-emerald-600" /> : <CopyIcon />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>

        {/* Account actions menu */}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <RefreshCwIcon data-icon="inline-start" />
            <span className="hidden sm:inline">更换地址</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => onNewRandom()}>
                <RefreshCwIcon />
                随机新地址
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenCustomDialog}>
                <UserRoundPenIcon />
                自定义地址…
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground text-xs">
                当前账号 {account.address}
              </DropdownMenuLabel>
              <DropdownMenuItem variant="destructive" onClick={() => onDestroyAndRenew()}>
                注销并更换
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* GitHub project link */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                render={
                  <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub 项目主页" />
                }
              />
            }
          >
            <GithubIcon />
          </TooltipTrigger>
          <TooltipContent>GitHub 项目主页</TooltipContent>
        </Tooltip>

        <ThemeToggle />
      </div>
    </header>
  )
}
