import type { Capabilities } from './model.ts'
import type { PermissionState } from './source.ts'

/** The most restrictive answer, used before a repo is open. */
export const RESTRICTIVE_CAPABILITIES: Capabilities = {
  canWrite: false,
  canWatch: false,
  access: 'none',
  git: 'none',
}

/**
 * Combine what a source can do with what the browser has granted.
 *
 * A writable handle the user has not re-granted is read-only in practice, which
 * is why permission and capability are separate inputs and one answer.
 */
export function resolveCapabilities(
  base: Capabilities,
  permission: PermissionState,
): Capabilities {
  const allowed = base.access === 'handle' ? permission === 'granted' : true
  return { ...base, canWrite: base.canWrite && allowed }
}

/** One explanation for a refused write, chosen by tier. */
export function writeRefusalMessage(
  capabilities: Capabilities,
  permission: PermissionState,
): string {
  if (capabilities.access === 'handle' && permission !== 'granted') {
    return 'This repository is read-only until you grant access to the folder.'
  }
  if (capabilities.access === 'http') {
    return 'The local server is not responding. Your change was not written.'
  }
  return 'This repository is read-only in this browser. Run `npx scrumit serve` for write access.'
}
