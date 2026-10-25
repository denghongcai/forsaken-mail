/**
 * Theme selector: light / dark / follow-system (three-state dropdown).
 * The trigger icon reflects the current setting; the system option restores
 * next-themes' default so the page tracks the OS preference again.
 */
import { CheckIcon, MoonIcon, MonitorIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from 'cn'

/** The three selectable theme settings, in menu order */
const OPTIONS = [
  { value: 'light', label: '浅色', icon: SunIcon },
  { value: 'dark', label: '深色', icon: MoonIcon },
  { value: 'system', label: '跟随系统', icon: MonitorIcon },
] as const

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const active = OPTIONS.find((option) => option.value === theme)
  const TriggerIcon = active !== undefined ? active.icon : MonitorIcon

  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="选择主题" />} />}>
          <TriggerIcon />
        </TooltipTrigger>
        <TooltipContent>主题</TooltipContent>
        <DropdownMenuContent align="end" className="w-36">
          {OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => setTheme(option.value)}
              className={cn(option.value === theme && 'font-medium')}
            >
              <option.icon />
              {option.label}
              {option.value === theme && <CheckIcon className="ml-auto" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Tooltip>
  )
}
