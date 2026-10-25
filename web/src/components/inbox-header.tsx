/**
 * Top bar: brand + current mailbox address (copy/change) + theme toggle.
 */
import { useState } from 'react'
import { CheckIcon, CopyIcon, MailIcon, RefreshCwIcon, UserRoundPenIcon } from 'lucide-react'
import { toast } from 'sonner'
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
import { ThemeToggle } from '@/components/theme-toggle'
import type { StoredAccount } from '@/lib/account'

interface InboxHeaderProps {
  account: StoredAccount
  /** Switch to a new random address */
  onNewRandom: () => void
  /** Open the "custom address" dialog */
  onOpenCustomDialog: () => void
  /** Delete the current account and switch to a new one */
  onDestroyAndRenew: () => void
}

export function InboxHeader({
  account,
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
    <header className="bg-background/95 supports-backdrop-filter:bg-background/60 sticky top-0 z-10 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        {/* Brand */}
        <div className="flex items-center gap-2 font-semibold">
          <MailIcon className="text-primary" />
          <span className="hidden sm:inline">Forsaken Mail</span>
        </div>

        {/* Current address: read-only input + copy button */}
        <InputGroup className="ml-auto h-9 max-w-md">
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

        <ThemeToggle />
      </div>
    </header>
  )
}
