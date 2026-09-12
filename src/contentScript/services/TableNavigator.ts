import { logger } from '@/shared/logging'
import type { TableInfo } from './TableService'

// Expanding a schema is a route change, not a cheap tree toggle: the console
// navigates to the schema page and re-renders the tree. Measured at ~220ms from
// a schema page and ~4.8s from a table browse page, so poll generously rather
// than guess a delay.
const LINK_RENDER_TIMEOUT_MS = 15000
const POLL_INTERVAL_MS = 150

async function waitFor<T>(get: () => T | null, timeout: number): Promise<T | null> {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = get()
    if (value) return value
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

/**
 * Finds the sidebar link for a table, which exists only while its schema is
 * expanded.
 *
 * Matches on the full href tail rather than `data-test`, so a table whose name
 * is a prefix of another cannot be confused for it. Views live under `/views/`
 * rather than `/tables/`, and the metadata we index does not record which a
 * relation is, so accept either.
 */
function renderedLink(table: TableInfo): HTMLElement | null {
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('[data-test="table-links"] a'),
  )
  const asTable = `/${table.schema}/tables/${table.table}/browse`
  const asView = `/${table.schema}/views/${table.table}/browse`

  for (const link of links) {
    const href = link.getAttribute('href') ?? ''
    if (href.endsWith(asTable) || href.endsWith(asView)) return link
  }
  return null
}

function schemaRow(schema: string): HTMLElement | null {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>('[data-test="table-links"] div[role="button"]'),
  )
  // Exact match: `includes` would pick `tiger_data` when asked for `tiger`.
  return rows.find((row) => row.textContent?.trim() === schema) ?? null
}

export const TableNavigator = {
  /**
   * Opens a table's Browse Rows page from the search results, always in place —
   * never with a page load.
   *
   * Both steps go through the console's own sidebar, so navigation stays
   * client-side. Deliberately not a `history.pushState` + `popstate` route
   * push, which the console picks up only intermittently and otherwise hangs
   * on "Loading data...", nor a full URL load, which is reliable but costs a
   * reload.
   */
  async open(table: TableInfo): Promise<void> {
    // Its schema is expanded, so the console's own router Link is on screen.
    const existing = renderedLink(table)
    if (existing) {
      existing.click()
      return
    }

    // Otherwise expand the schema first. Note this navigates to the schema
    // page as a side effect, then re-renders the tree.
    const row = schemaRow(table.schema)
    if (!row) {
      logger.error(`TableNavigator: no sidebar row for schema ${table.schema}`)
      return
    }

    row.click()

    const link = await waitFor(() => renderedLink(table), LINK_RENDER_TIMEOUT_MS)
    if (!link) {
      // The schema is expanded now even though we timed out, so picking the
      // same result again will take the fast path above.
      logger.error(`TableNavigator: ${table.displayName} link did not render; retry to open it`)
      return
    }

    link.click()
  },
}
