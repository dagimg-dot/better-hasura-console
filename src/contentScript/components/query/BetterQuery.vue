<template>
  <div class="better-query-container">
    <div class="better-query-header" @click="toggleCollapse" title="Toggle Better Query">
      <span class="better-query-collapse-icon">{{ isExpanded ? '▼' : '▶' }}</span>
      <span class="better-query-title">Better Query</span>
    </div>

    <div v-show="isExpanded" class="better-query-body">
      <div class="better-query-row">
        <div
          class="better-query-input-wrap"
          data-tooltip="Key value to search across all tracked tables"
        >
          <input
            v-model="keyInput"
            type="text"
            placeholder="Search key..."
            @focus="showKeyDropdown = true"
            @blur="handleKeyBlur"
            @keydown="handleKeyKeydown"
            @keydown.enter="handleSearch"
          />
          <ul v-if="showKeyDropdown && filteredKeys.length > 0" class="better-query-dropdown">
            <li
              v-for="(item, idx) in filteredKeys"
              :key="item"
              :class="{ selected: idx === selectedKeyIdx }"
              @mousedown.prevent="selectKey(item)"
              @mouseenter="selectedKeyIdx = idx"
            >
              <span>{{ item }}</span>
            </li>
          </ul>
        </div>
        <div
          class="better-query-input-wrap"
          data-tooltip="Regex pattern to select which columns to search in"
        >
          <input
            v-model="regexInput"
            type="text"
            placeholder="Column regex..."
            @focus="showRegexDropdown = true"
            @blur="handleRegexBlur"
            @keydown="handleRegexKeydown"
            @keydown.enter="handleSearch"
          />
          <ul v-if="showRegexDropdown && filteredRegexes.length > 0" class="better-query-dropdown">
            <li
              v-for="(item, idx) in filteredRegexes"
              :key="item"
              :class="{ selected: idx === selectedRegexIdx }"
              @mousedown.prevent="selectRegex(item)"
              @mouseenter="selectedRegexIdx = idx"
            >
              <span>{{ item }}</span>
            </li>
          </ul>
        </div>
        <span
          class="better-query-select-wrap"
          data-tooltip="How the key value is matched against column data"
        >
          <select v-model="searchMode">
            <option v-for="opt in SEARCH_MODE_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </span>
        <button
          class="better-query-search-btn"
          :disabled="isSearching || !keyInput || !regexInput"
          @click="handleSearch"
        >
          {{ isSearching ? 'Searching...' : 'Search' }}
        </button>
        <button
          v-show="keyInput || regexInput || results.length > 0 || error"
          class="better-query-clear-btn"
          title="Clear inputs and results"
          @click="handleClear"
        >
          ✕
        </button>
      </div>

      <div v-if="error && !isSearching" class="better-query-error">{{ error }}</div>

      <div v-if="results.length > 0" class="better-query-results">
        <div class="better-query-results-summary">
          Found {{ totalMatchCount }} match{{ totalMatchCount !== 1 ? 'es' : '' }} across
          {{ groupedResults.length }} table{{ groupedResults.length !== 1 ? 's' : ''
          }}<span v-if="isSearching"> (loading...)</span>
        </div>
        <div v-for="(group, idx) in groupedResults" :key="idx" class="better-query-table-group">
          <div class="better-query-table-name">{{ group.tableDisplayName }}</div>
          <div v-for="(result, ridx) in group.results" :key="ridx" class="better-query-result-row">
            <span class="better-query-column">{{ result.column }}</span>
            <span class="better-query-count"
              >{{ result.matchCount }} match{{ result.matchCount !== 1 ? 'es' : '' }}</span
            >
            <button
              class="better-query-browse-btn"
              @click="navigateToTable(result)"
              title="Browse table with filter"
            >
              Browse
            </button>
          </div>
        </div>
      </div>

      <div v-if="isSearching" class="better-query-loading">
        <!-- Spinner SVG -->
        <svg
          v-once
          class="better-query-spinner"
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
        </svg>
        Scanning tables...
      </div>

      <div
        v-if="hasSearched && results.length === 0 && !isSearching && !error"
        class="better-query-no-results"
      >
        No matches found
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { watchDebounced, useStorage } from '@vueuse/core'
import {
  BetterQueryService,
  SEARCH_MODE_OPTIONS,
  type SearchMode,
  type SearchResult,
  type ColumnInfo,
} from '@/contentScript/services/BetterQueryService'
import { logger } from '@/shared/logging'

const COMMON_REGEXES = ['_id$']
const MAX_RECENT = 10

const recentKeys = useStorage<string[]>('better-hasura-recent-keys', [])
const recentRegexes = useStorage<string[]>('better-hasura-recent-regexes', [])
const isExpanded = useStorage('better-hasura-query-expanded', true)

const keyInput = ref('')
const regexInput = ref('')
const searchMode = ref<SearchMode>('contains')
const isSearching = ref(false)
const hasSearched = ref(false)
const error = ref('')
const results = ref<SearchResult[]>([])

// Dropdown state
const showKeyDropdown = ref(false)
const showRegexDropdown = ref(false)
const selectedKeyIdx = ref(0)
const selectedRegexIdx = ref(0)

const filteredKeys = computed(() => {
  const q = keyInput.value.trim().toLowerCase()
  if (!q) return recentKeys.value
  return recentKeys.value.filter((k) => k.toLowerCase().includes(q))
})

const filteredRegexes = computed(() => {
  const q = regexInput.value.trim().toLowerCase()
  const seen = new Set(COMMON_REGEXES)
  const combined = [...COMMON_REGEXES]
  for (const r of recentRegexes.value) {
    if (!seen.has(r)) {
      seen.add(r)
      combined.push(r)
    }
  }
  if (!q) return combined
  return combined.filter((r) => r.toLowerCase().includes(q))
})

watchDebounced(
  keyInput,
  () => {
    selectedKeyIdx.value = 0
  },
  { debounce: 100, maxWait: 300 },
)
watchDebounced(
  regexInput,
  () => {
    selectedRegexIdx.value = 0
  },
  { debounce: 100, maxWait: 300 },
)

// Phase 3: Background pre-fetch columns when regex input settles
const prefetchedColumns = ref<ColumnInfo[] | null>(null)
let prefetchedRegex = ''

watchDebounced(
  regexInput,
  async (val: string) => {
    const regex = val.trim()
    if (!regex) {
      prefetchedColumns.value = null
      return
    }
    try {
      const columns = await BetterQueryService.findMatchingColumns(regex)
      prefetchedColumns.value = columns
      prefetchedRegex = regex
    } catch {
      // Pre-fetch errors are non-critical; search will retry
    }
  },
  { debounce: 500, maxWait: 1500 },
)

function handleKeyKeydown(e: KeyboardEvent) {
  if (!showKeyDropdown.value) return
  const items = filteredKeys.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedKeyIdx.value = Math.min(selectedKeyIdx.value + 1, items.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedKeyIdx.value = Math.max(selectedKeyIdx.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (items[selectedKeyIdx.value]) selectKey(items[selectedKeyIdx.value])
  } else if (e.key === 'Escape') {
    showKeyDropdown.value = false
  }
}

function handleKeyBlur() {
  setTimeout(() => {
    showKeyDropdown.value = false
  }, 200)
}

function selectKey(key: string) {
  keyInput.value = key
  showKeyDropdown.value = false
}

function handleRegexKeydown(e: KeyboardEvent) {
  if (!showRegexDropdown.value) return
  const items = filteredRegexes.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedRegexIdx.value = Math.min(selectedRegexIdx.value + 1, items.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedRegexIdx.value = Math.max(selectedRegexIdx.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (items[selectedRegexIdx.value]) selectRegex(items[selectedRegexIdx.value])
  } else if (e.key === 'Escape') {
    showRegexDropdown.value = false
  }
}

function handleRegexBlur() {
  setTimeout(() => {
    showRegexDropdown.value = false
  }, 200)
}

function selectRegex(regex: string) {
  regexInput.value = regex
  showRegexDropdown.value = false
}

function addToRecents(key: string, regex: string) {
  const keys = recentKeys.value.filter((k) => k !== key)
  recentKeys.value = [key, ...keys].slice(0, MAX_RECENT)

  const regexes = recentRegexes.value.filter((r) => r !== regex)
  recentRegexes.value = [regex, ...regexes].slice(0, MAX_RECENT)
}

function toggleCollapse() {
  isExpanded.value = !isExpanded.value
}

const totalMatchCount = computed(() => results.value.reduce((sum, r) => sum + r.matchCount, 0))

const groupedResults = computed(() => {
  const groups = new Map<string, SearchResult[]>()
  for (const r of results.value) {
    if (!groups.has(r.tableDisplayName)) {
      groups.set(r.tableDisplayName, [])
    }
    groups.get(r.tableDisplayName)!.push(r)
  }
  return Array.from(groups.entries()).map(([tableDisplayName, res]) => ({
    tableDisplayName,
    results: res,
  }))
})

async function handleSearch() {
  const key = keyInput.value.trim()
  const regex = regexInput.value.trim()
  if (!key || !regex) return

  addToRecents(key, regex)

  isSearching.value = true
  error.value = ''
  hasSearched.value = false
  results.value = []

  try {
    // Use pre-fetched columns if regex matches; otherwise discover fresh
    let columns: ColumnInfo[] | null = null
    if (prefetchedRegex === regex && prefetchedColumns.value) {
      columns = prefetchedColumns.value
    }
    if (!columns) {
      columns = await BetterQueryService.findMatchingColumns(regex)
    }
    if (columns.length === 0) {
      hasSearched.value = true
      isSearching.value = false
      return
    }

    await BetterQueryService.searchInTablesBatched(
      key,
      columns,
      searchMode.value,
      (batch) => {
        results.value = [...results.value, ...batch]
      },
      (err) => {
        logger.error('BetterQuery: batch search error', err)
      },
    )
    hasSearched.value = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Search failed'
    logger.error('BetterQuery: search error', err as Error)
  } finally {
    isSearching.value = false
  }
}

function navigateToTable(result: SearchResult) {
  const url = BetterQueryService.buildBrowseUrl(
    result,
    keyInput.value.trim(),
    searchMode.value,
    window.location.origin,
  )
  window.open(url, '_blank')
}

function handleClear() {
  keyInput.value = ''
  regexInput.value = ''
  results.value = []
  error.value = ''
  hasSearched.value = false
}
</script>

<style scoped>
.better-query-container {
  padding: 0 0 10px 0;
}

.better-query-header {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  padding: 8px 0 4px 0;
}

.better-query-title {
  font-size: 20px;
  font-weight: 700;
  color: #555;
}

.better-query-collapse-icon {
  font-size: 10px;
  color: #999;
  flex-shrink: 0;
}

.better-query-header:hover .better-query-collapse-icon {
  color: #555;
}

.better-query-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.better-query-input-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}

.better-query-input-wrap input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  outline: none;
  background: transparent;
  box-sizing: border-box;
}

.better-query-row input:focus {
  border-color: #2dbbe1;
}

.better-query-row input::placeholder {
  color: #999;
}

/* Custom tooltip on hover (native title hidden by Hasura CSS) */
.better-query-input-wrap[data-tooltip]::after,
.better-query-select-wrap[data-tooltip]::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 6px;
  padding: 5px 8px;
  background: #333;
  color: #fff;
  font-size: 11px;
  line-height: 1.3;
  border-radius: 4px;
  white-space: nowrap;
  z-index: 1001;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.better-query-input-wrap[data-tooltip]:hover::after,
.better-query-select-wrap[data-tooltip]:hover::after {
  opacity: 1;
}

.better-query-select-wrap {
  position: relative;
  flex-shrink: 0;
}

.better-query-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: white;
  border: 1px solid #ddd;
  border-radius: 4px;
  max-height: 200px;
  overflow-y: auto;
  list-style: none;
  padding: 0;
  margin: 0;
  z-index: 1000;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.better-query-dropdown li {
  padding: 6px 10px;
  cursor: pointer;
  font-size: 13px;
  font-family: monospace;
  color: #333;
  border-bottom: 1px solid #eee;
}

.better-query-dropdown li:last-child {
  border-bottom: none;
}

.better-query-dropdown li:hover,
.better-query-dropdown li.selected {
  background: #f5f5f5;
}

.better-query-row select {
  flex-shrink: 0;
  padding: 5px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  outline: none;
  background: white;
  color: #555;
  cursor: pointer;
  appearance: auto;
  -webkit-appearance: auto;
  -moz-appearance: auto;
}

.better-query-row select:focus {
  border-color: #2dbbe1;
}

.better-query-search-btn {
  padding: 5px 16px;
  background: linear-gradient(#f9f9f9, #ececec);
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 14px;
  color: #555;
  cursor: pointer;
  white-space: nowrap;
}

.better-query-search-btn:hover:not(:disabled) {
  background: linear-gradient(#f0f0f0, #e0e0e0);
}

.better-query-search-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.better-query-clear-btn {
  flex-shrink: 0;
  padding: 5px 9px;
  background: transparent;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  line-height: 1.4;
  color: #999;
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s;
}

.better-query-clear-btn:hover {
  color: #d32f2f;
  border-color: #d32f2f;
}

.better-query-loading {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  font-size: 13px;
  color: #888;
  padding: 8px 6px;
}

.better-query-spinner {
  flex: none;
  animation: better-query-spin 1s linear infinite;
}

@keyframes better-query-spin {
  to {
    transform: rotate(360deg);
  }
}

.better-query-error {
  margin-top: 8px;
  font-size: 13px;
  color: #d32f2f;
  padding: 8px 6px;
  background: #fef2f2;
  border: 1px solid #fee;
  border-radius: 4px;
}

.better-query-results {
  margin-top: 8px;
  max-height: 400px;
  overflow-y: auto;
}

.better-query-results-summary {
  font-size: 12px;
  color: #888;
  padding: 4px 6px 8px;
}

.better-query-table-group {
  margin-bottom: 6px;
}

.better-query-table-name {
  font-size: 13px;
  font-weight: 600;
  color: #555;
  padding: 4px 6px;
  background: #f5f5f5;
  border-radius: 3px;
}

.better-query-result-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px 4px 12px;
  font-size: 13px;
}

.better-query-result-row:hover {
  background: #fafafa;
}

.better-query-column {
  flex: 1;
  color: #333;
  font-family: monospace;
  font-size: 13px;
}

.better-query-count {
  color: #888;
  font-size: 12px;
  white-space: nowrap;
}

.better-query-browse-btn {
  padding: 2px 8px;
  font-size: 12px;
  background: linear-gradient(#f9f9f9, #ececec);
  border: 1px solid #ccc;
  border-radius: 3px;
  color: #555;
  cursor: pointer;
  white-space: nowrap;
}

.better-query-browse-btn:hover {
  background: linear-gradient(#f0f0f0, #e0e0e0);
}

.better-query-no-results {
  margin-top: 8px;
  font-size: 13px;
  color: #888;
  padding: 8px 6px;
}
</style>
