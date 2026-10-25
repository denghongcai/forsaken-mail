/**
 * Dark/light theme toggle button (built on next-themes' class strategy).
 */
import { MoonIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            aria-label="切换主题"
          />
        }
      >
        {isDark ? <SunIcon /> : <MoonIcon />}
      </TooltipTrigger>
      <TooltipContent>{isDark ? '切换为浅色' : '切换为深色'}</TooltipContent>
    </Tooltip>
  )
}
