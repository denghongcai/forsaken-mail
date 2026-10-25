/**
 * "Custom address" dialog: enter a username, pick a domain, set a password —
 * creates a new account and switches to it.
 * Form layout follows the shadcn conventions: FieldGroup + Field; the domain
 * uses the Select component.
 */
import { useEffect, useState } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { createAccount, getDomains, login } from '@/lib/api'
import { saveStoredAccount, type StoredAccount } from '@/lib/account'

interface ChangeAddressDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Apply the new account after creation (the parent reconnects the socket) */
  onSwitched: (account: StoredAccount) => void
}

/** Username validity: frontend pre-check kept in sync with the backend's LOCAL_PART_RE */
const LOCAL_PART_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function ChangeAddressDialog({ open, onOpenChange, onSwitched }: ChangeAddressDialogProps) {
  const [domains, setDomains] = useState<string[]>([])
  const [localPart, setLocalPart] = useState('')
  const [domain, setDomain] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load the domain list and reset the form when the dialog opens
  useEffect(() => {
    if (!open) return
    setLocalPart('')
    setError(null)
    void getDomains()
      .then(({ domains: list }) => {
        setDomains(list)
        setDomain(list[0] ?? '')
      })
      .catch(() => setError('域名列表获取失败，请稍后重试'))
  }, [open])

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)

    // Client-side pre-check: don't send the request when it fails
    if (!LOCAL_PART_RE.test(localPart)) {
      setError('用户名只能包含小写字母、数字、点、下划线和连字符')
      return
    }
    if (password.length < 4) {
      setError('密码至少 4 位（保存好凭据可用于在其他设备恢复此地址）')
      return
    }

    setSubmitting(true)
    try {
      const address = `${localPart}@${domain}`
      const created = await createAccount(address, password)
      const { token, id } = await login(created.address, password)
      onSwitched(saveStoredAccount({ id, address: created.address, password, token }))
      onOpenChange(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>自定义邮箱地址</DialogTitle>
          <DialogDescription>
            创建一个你喜欢的地址。凭据（地址 + 密码）可用于在其他设备恢复同一信箱。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <FieldGroup>
            <Field data-invalid={error !== null || undefined}>
              <FieldLabel htmlFor="local-part">用户名</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="local-part"
                  value={localPart}
                  onChange={(e) => setLocalPart(e.target.value.toLowerCase())}
                  placeholder="例如 docker-fan"
                  autoComplete="off"
                  autoFocus
                  aria-invalid={error !== null || undefined}
                />
                <Select value={domain} onValueChange={(v) => setDomain(v ?? '')}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="域名" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {domains.map((d) => (
                        <SelectItem key={d} value={d}>
                          @{d}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <FieldDescription>仅限小写字母、数字、点、下划线、连字符。</FieldDescription>
            </Field>

            <Field data-invalid={error !== null || undefined}>
              <FieldLabel htmlFor="custom-password">密码</FieldLabel>
              <Input
                id="custom-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 4 位"
                autoComplete="new-password"
                aria-invalid={error !== null || undefined}
              />
              <FieldDescription>请自行牢记；可用于换取 token 恢复信箱。</FieldDescription>
            </Field>

            {error !== null && (
              <Field>
                <p className="text-destructive text-sm">{error}</p>
              </Field>
            )}
          </FieldGroup>

          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Spinner data-icon="inline-start" />}
              创建并切换
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
