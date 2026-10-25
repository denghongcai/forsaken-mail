/**
 * Application entrypoint: wires up the global providers.
 *  - QueryClientProvider: TanStack Query data layer
 *  - ThemeProvider: next-themes light/dark (class strategy, follows the system)
 *  - TooltipProvider: global context for shadcn Tooltip
 *  - Toaster: sonner global notifications
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import './index.css'
import App from './App.tsx'

// The single global QueryClient: retry failures once, no refetch on window
// focus (mail is push-driven)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <TooltipProvider>
          <App />
          <Toaster richColors position="top-center" />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
