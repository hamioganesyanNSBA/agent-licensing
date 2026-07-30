import { useUser } from '@clerk/clerk-react'

// Two-tier access on top of the AdminGate allowlist:
//   VITE_ADMIN_EMAILS  — who may sign in at all (existing behavior).
//   VITE_EDITOR_EMAILS — who may change data (Onyx sync, file imports,
//                        clear-all). Empty/unset = every signed-in admin is
//                        an editor (backwards compatible).
// NOTE: like the rest of the app this is client-side gating only — it keeps
// honest users out of dangerous buttons, it is not server-enforced security.
const EDITOR_EMAILS = (import.meta.env.VITE_EDITOR_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

export function useIsEditor() {
  const { user } = useUser()
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase()
  if (!EDITOR_EMAILS.length) return true
  return !!email && EDITOR_EMAILS.includes(email)
}
