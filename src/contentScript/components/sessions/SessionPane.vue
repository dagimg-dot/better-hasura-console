<template>
  <details open class="bhh-session-details">
    <summary class="cursor-pointer items-center bhh-summary">
      <span class="inline-block text-xs mr-sm">
        <!-- Chevron SVG -->
        <svg
          v-once
          class="bhh-chevron"
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </span>
      <span class="bhh-summary-content">
        <div class="font-semibold" style="display: flex; align-items: center; gap: 8px">
          <span>Better Session</span>
          <button class="bhh-new-session-btn" @click.stop="handleAddSession">+ New Session</button>
        </div>
      </span>
    </summary>
    <div v-if="activeAuth" class="bhh-auth-status">
      <span class="bhh-auth-label">Authorization:</span>
      <span class="bhh-auth-bearer">Bearer {{ activeAuth.shortToken }}</span>
      <span v-if="activeAuth.roleName" class="bhh-auth-role">| {{ activeAuth.roleName }}</span>
    </div>
    <div class="mt-sm">
      <div v-if="sessions.length === 0" class="bhh-empty-state">
        No sessions configured. Click "+ New Session" to add one.
      </div>
      <div v-else class="bhh-session-list">
        <SessionRow
          v-for="session in sessions"
          :key="session.id"
          :session="session"
          :active="session.id === activeSessionId"
          @authenticate="handleAuthenticate"
          @toggle-active="handleToggleActive"
        />
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import {
  SessionAuthService,
  decodeJWTPayload,
  getValueByDotPath,
} from '@/contentScript/services/SessionAuthService'
import { useSessions } from '@/contentScript/composables/useSessions'
import SessionRow from './SessionRow.vue'
import { logger } from '@/contentScript/utils/logger'
import type { Session } from '@/shared/types'

import { ref, watch } from 'vue'
import { EXTENSION_CONFIG } from '@/shared/constants'

const { sessions, addSession, updateSession, removeSession } = useSessions()

const DEFAULT_ROLE_NAME_PATH = 'klik.x-hasura-default-role'

function extractRoleName(token: string, roleNamePath: string | undefined): string {
  try {
    const path = roleNamePath || DEFAULT_ROLE_NAME_PATH
    if (!path) return ''

    const payload = decodeJWTPayload(token)
    if (!payload) {
      logger.warn('SessionPane: failed to decode JWT payload')
      return ''
    }

    const val = getValueByDotPath(payload, path)
    if (typeof val === 'string' && val.length > 0) return val

    if (roleNamePath) {
      // Custom path was set but didn't resolve — warn the user
      logger.warn('SessionPane: roleNamePath not found in JWT', { path })
    } else {
      // Default path didn't resolve — the JWT structure might differ
      logger.warn(
        'SessionPane: default roleNamePath not found in JWT, the JWT may not have klik.x-hasura-default-role',
        { path },
      )
    }
    return ''
  } catch (error) {
    logger.error(
      'SessionPane: error extracting role name',
      error instanceof Error ? error : new Error(String(error)),
    )
    return ''
  }
}

function findActiveSession() {
  try {
    const raw = localStorage.getItem(EXTENSION_CONFIG.STORAGE_KEYS.GRAPHQL_HEADERS)
    if (!raw) return null
    const headers = JSON.parse(raw) as Array<{
      key: string
      value: string
      isActive: boolean
    }>
    const auth = headers.find((h) => h.key.toLowerCase() === 'authorization' && h.isActive)
    if (!auth) return null
    const bearerToken = auth.value.replace(/^Bearer\s+/i, '')
    return sessions.value.find((s) => s.token === bearerToken) ?? null
  } catch {
    return null
  }
}

function buildAuthDisplay(
  session: NonNullable<ReturnType<typeof findActiveSession>>,
): { token: string; shortToken: string; roleName: string } | null {
  if (!session.token) return null

  const shortToken =
    session.token.length > 24
      ? session.token.substring(0, 8) + '...' + session.token.slice(-6)
      : session.token

  const roleName = extractRoleName(session.token, session.roleNamePath)

  return { token: session.token, shortToken, roleName }
}

function syncActiveSession() {
  const active = findActiveSession()
  activeSessionId.value = active?.id ?? null
  activeAuth.value = active ? buildAuthDisplay(active) : null
}

const activeSessionId = ref<string | null>(null)
const activeAuth = ref<{ token: string; shortToken: string; roleName: string } | null>(null)

syncActiveSession()
watch(sessions, syncActiveSession)

function handleAddSession() {
  addSession()
  logger.debug('SessionPane: new session added')
}

async function handleAuthenticate(sessionId: string) {
  const session = sessions.value.find((s) => s.id === sessionId)
  if (!session) return

  updateSession(sessionId, { status: 'authenticating', error: undefined, token: undefined })

  try {
    const { token } = await SessionAuthService.authenticate(session.mutation, session.variables)
    const updates: Record<string, any> = { status: 'success', token }

    const roleName = extractRoleName(token, session.roleNamePath)
    if (roleName) {
      updates.name = roleName
    }

    updateSession(sessionId, updates)
    syncActiveSession()
    logger.info('SessionPane: authentication successful for', {
      name: updates.name || session.name,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error(
      'SessionPane: authentication failed',
      error instanceof Error ? error : new Error(msg),
    )
    updateSession(sessionId, { status: 'error', error: msg })
  }
}

function handleToggleActive(sessionId: string) {
  try {
    const session = sessions.value.find((s) => s.id === sessionId)
    if (!session?.token) return

    const raw = localStorage.getItem(EXTENSION_CONFIG.STORAGE_KEYS.GRAPHQL_HEADERS)
    if (!raw) return
    const headers = JSON.parse(raw) as Array<{
      key: string
      value: string
      isActive: boolean
      isNewHeader: boolean
      isDisabled?: boolean
    }>
    const authIdx = headers.findIndex(
      (h) => h.key.toLowerCase() === 'authorization' && !h.isNewHeader,
    )
    if (authIdx < 0) return

    const wasActive = headers[authIdx].isActive
    const currentBearer = headers[authIdx].value
    const currentToken = currentBearer.replace(/^Bearer\s+/i, '')

    if (wasActive && currentToken === session.token) {
      // Toggle OFF: deactivate but keep the value
      headers[authIdx] = { ...headers[authIdx], isActive: false }
      localStorage.setItem(EXTENSION_CONFIG.STORAGE_KEYS.GRAPHQL_HEADERS, JSON.stringify(headers))
      window.postMessage({ type: 'BHH_REFRESH_HEADERS' }, '*')
    } else {
      // Toggle ON: set value to this session's token and activate
      headers[authIdx] = {
        ...headers[authIdx],
        value: `Bearer ${session.token}`,
        isActive: true,
      }
      localStorage.setItem(EXTENSION_CONFIG.STORAGE_KEYS.GRAPHQL_HEADERS, JSON.stringify(headers))
      window.postMessage({ type: 'BHH_REFRESH_HEADERS', data: { token: session.token } }, '*')
    }

    syncActiveSession()
    logger.info('SessionPane: toggled session', {
      sessionId,
      toActive: !wasActive || currentToken !== session.token,
    })
  } catch (error) {
    logger.error(
      'SessionPane: failed to toggle session',
      error instanceof Error ? error : new Error(String(error)),
    )
  }
}
</script>

<style scoped>
.bhh-session-details {
  margin-top: 8px;
}

.bhh-chevron {
  display: block;
}

.bhh-session-details[open] .bhh-chevron {
  transform: rotate(90deg);
}

.bhh-session-details:not([open]) .bhh-chevron {
  transform: rotate(0deg);
  transition: transform 0.15s ease;
}

.bhh-session-details summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.bhh-summary-content {
  flex: 1;
  min-width: 0;
}

.bhh-new-session-btn {
  margin-left: auto;
  font-size: 12px;
  padding: 1px 8px;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  background: linear-gradient(#f9f9f9, #ececec);
  color: #555;
  cursor: pointer;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-weight: 500;
  line-height: 1.6;
}

.bhh-new-session-btn:hover {
  background: linear-gradient(#f0f0f0, #e0e0e0);
}

.bhh-auth-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0 4px 20px;
  font-size: 11px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  color: #059669;
}

.bhh-auth-label {
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.bhh-auth-bearer {
  color: #374151;
}

.bhh-auth-role {
  color: #059669;
  font-weight: 600;
}

.bhh-empty-state {
  padding: 16px;
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
}

.bhh-session-list {
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: 4px 12px;
  background: #fff;
}
</style>
