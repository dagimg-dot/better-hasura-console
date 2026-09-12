import { EXTENSION_CONFIG } from '@/shared/constants'
import {
  ExtensionLifecycleManager,
  NavigationManager,
  RouteManager,
  SearchInputManager,
  SettingsManager,
  TableService,
} from './services'
import { logger } from './utils/logger'
import type { PageType } from '@/shared/types/services'
import type { Settings } from './services/SettingsManager'
import { useExtensionState } from './composables/useExtensionState'
import { useHistory } from './composables/useHistory'
import { TableSearch } from './components/table'
import type { App } from 'vue'

const script = document.createElement('script')
script.src = chrome.runtime.getURL('src/contentScript/script-injector.js')
;(document.head || document.documentElement).prepend(script)

window.addEventListener('message', (event) => {
  if (event.source !== window) return

  const { type, data } = event.data
  if (type === 'BHH_EXPORT_HISTORY_REQUEST') {
    chrome.runtime.sendMessage({ type: 'BHH_DOWNLOAD_HISTORY', data })
  }
})

let tableSearchInjected = false
let tableSearchApp: App<Element> | null = null
let extensionEnabled = true
let currentRoute: string = 'unknown'

const searchInputManager = new SearchInputManager()

function setupGlobalShortcut(): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      searchInputManager.focus()
    }
    if (e.key === 'Escape') {
      searchInputManager.blurAll()
    }
  })
}

function resetTableSearchState(): void {
  tableSearchInjected = false
  currentRoute = 'unknown'
}

function removeTableSearch(): void {
  if (tableSearchApp) {
    tableSearchApp.unmount()
    tableSearchApp = null
  }
  const wrapper = document.querySelector('.bhh-table-search-wrapper')
  if (!wrapper) return

  wrapper.remove()
  tableSearchInjected = false
  logger.debug('Table search removed')
}

async function injectTableSearch(): Promise<void> {
  if (!extensionEnabled) return
  const pageInfo = RouteManager.getPageInfo()

  if (pageInfo.route === 'data' || pageInfo.route === 'sql') {
    if (pageInfo.route !== currentRoute) {
      currentRoute = pageInfo.route
      tableSearchInjected = false
    }
  }

  if (tableSearchInjected) return

  const tableLinks = document.querySelector(EXTENSION_CONFIG.DOM_SELECTORS.TABLE_LINKS)
  if (!tableLinks) {
    logger.debug('Table links element not found, waiting...')
    return
  }

  const parent = tableLinks.parentElement
  if (!parent) return

  const existingSearch = parent.querySelector('.table-search-container')
  if (existingSearch) {
    tableSearchInjected = true
    return
  }

  try {
    const wrapper = document.createElement('div')
    wrapper.className = 'bhh-table-search-wrapper'
    // The sidebar heading above is a row of uncleared Bootstrap `col-xs-*` floats.
    // A flex container establishes its own formatting context, so without `clear`
    // it gets squeezed into the sliver of space left beside them.
    wrapper.style.clear = 'both'
    wrapper.style.width = '100%'
    wrapper.style.boxSizing = 'border-box'
    wrapper.style.display = 'flex'
    wrapper.style.flexDirection = 'column'

    parent.insertBefore(wrapper, tableLinks)

    const searchContainer = document.createElement('div')
    searchContainer.className = 'table-search-container'
    wrapper.appendChild(searchContainer)

    const vueApp = document.createElement('div')
    searchContainer.appendChild(vueApp)

    const { createApp } = await import('vue')
    const app = createApp(TableSearch)
    tableSearchApp = app
    app.mount(vueApp)

    tableSearchInjected = true
    logger.debug('Table search injected successfully')
  } catch (error) {
    logger.error('Failed to inject table search', error as Error)
  }
}

function setupTableSearchObserver(): void {
  const observer = new MutationObserver(() => {
    if (!extensionEnabled) return
    const pageInfo = RouteManager.getPageInfo()
    if (pageInfo.route === 'data' || pageInfo.route === 'sql') {
      injectTableSearch()
    } else if (currentRoute !== 'unknown') {
      resetTableSearchState()
    }
  })

  observer.observe(document.body, { childList: true, subtree: true })
}

async function autoDiscoverAdminSecret(): Promise<void> {
  try {
    const secret = localStorage.getItem('console:adminSecret')
    if (!secret) return

    const hostname = SettingsManager.getCurrentHost()
    const settings = await SettingsManager.getSettings()
    const existing = settings.hosts?.[hostname]
    const autoGraphqlEndpoint = `${window.location.protocol}//${hostname}`

    if (existing?.adminSecret && existing?.graphqlEndpoint) {
      if (TableService.getTables().length > 0) return
      TableService.fetchTables().catch((err) => {
        logger.error('Auto-fetch tables failed', err as Error)
      })
      return
    }
    if (settings.adminSecret === secret && settings.graphqlEndpoint === autoGraphqlEndpoint) return

    await SettingsManager.saveHostSettings(hostname, {
      adminSecret: secret,
      graphqlEndpoint: autoGraphqlEndpoint,
    })
    logger.info('Auto-discovered credentials for', { hostname })

    TableService.fetchTables().catch((err) => {
      logger.error('Auto-fetch tables failed', err as Error)
    })
  } catch (error) {
    logger.error('Auto-discover failed', error as Error)
  }
}

const lifecycleManager = new ExtensionLifecycleManager()

function initializeNavigation(): void {
  const navigationManager = new NavigationManager(
    document.body,
    (pageType: PageType) => {
      SettingsManager.getSettings().then((settings: Settings) => {
        if (settings.extensionEnabled) {
          lifecycleManager.initialize(pageType, settings).catch((error) => {
            logger.error('Failed to initialize extension on navigation', error as Error)
          })

          const { setPageType } = useExtensionState()
          const { setPageFilter } = useHistory()
          setPageType(pageType)
          setPageFilter(pageType)

          autoDiscoverAdminSecret()
        }
      })
    },
    () => {
      lifecycleManager.cleanup()
    },
  )

  navigationManager.start()

  setupGlobalShortcut()

  const pageInfo = RouteManager.getPageInfo()
  if (pageInfo.route === 'data' || pageInfo.route === 'sql') {
    injectTableSearch()
  }

  setupTableSearchObserver()
}

try {
  SettingsManager.getSettings().then((s) => {
    extensionEnabled = s.extensionEnabled !== false
  })
  initializeNavigation()
} catch (error) {
  logger.error('Failed to start navigation manager', error as Error)
}

chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace !== 'local' || !changes.settings) return

  try {
    const { oldValue, newValue } = changes.settings
    const mergedNew = SettingsManager.mergeSettings(newValue)

    extensionEnabled = mergedNew.extensionEnabled !== false

    if (!mergedNew.extensionEnabled) {
      removeTableSearch()
    }

    await lifecycleManager.handleSettingsChange(oldValue, newValue)
  } catch (error) {
    logger.error('Error handling settings change', error as Error)
  }
})
