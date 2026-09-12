<template>
  <div class="table-search-container">
    <div class="table-search-title">Tables ({{ tableCount }})</div>
    <div class="table-search-input-wrapper">
      <input
        ref="searchInput"
        type="text"
        placeholder="Search tables..."
        v-model="searchTerm"
        @focus="handleFocus"
        @blur="handleBlur"
        @keydown="handleKeydown"
      />
      <button class="refresh-btn" @click.stop="handleRefresh" title="Refresh tables">
        <!-- Refresh SVG -->
        <svg
          :class="{ spinning: isRefreshing }"
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="23 4 23 10 17 10"></polyline>
          <polyline points="1 20 1 14 7 14"></polyline>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
      </button>
    </div>
    <ul v-if="showDropdown && filteredTables.length > 0" class="table-search-results">
      <li
        v-for="(table, index) in filteredTables"
        :key="table.displayName"
        :class="{ selected: index === selectedIndex }"
        @mousedown.prevent="selectTable(table)"
        @mouseenter="selectedIndex = index"
      >
        <span class="table-name">{{ table.displayName }}</span>
      </li>
    </ul>
    <div
      v-else-if="showDropdown && searchTerm && filteredTables.length === 0"
      class="table-search-results"
    >
      <li class="no-results">No tables found</li>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { TableService, type TableInfo } from '@/contentScript/services/TableService'
import { TableNavigator } from '@/contentScript/services/TableNavigator'
import { logger } from '@/shared/logging'

const searchTerm = ref('')
const showDropdown = ref(false)
const selectedIndex = ref(0)
const isRefreshing = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)

const tableCount = computed(() => TableService.getTables().length)

const filteredTables = computed(() => {
  return TableService.search(searchTerm.value).slice(0, 20)
})

watchDebounced(
  searchTerm,
  () => {
    selectedIndex.value = 0
  },
  { debounce: 100, maxWait: 300 },
)

const handleFocus = () => {
  if (searchTerm.value) {
    searchInput.value?.select()
  }
  showDropdown.value = true
}

const handleBlur = () => {
  setTimeout(() => {
    showDropdown.value = false
  }, 200)
}

const handleKeydown = (event: KeyboardEvent) => {
  if (!showDropdown.value) return

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, filteredTables.value.length - 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    if (filteredTables.value[selectedIndex.value]) {
      selectTable(filteredTables.value[selectedIndex.value])
    }
  } else if (event.key === 'Escape') {
    showDropdown.value = false
  }
}

const selectTable = (table: TableInfo) => {
  showDropdown.value = false
  searchInput.value?.blur()

  TableService.markAccessed(table.displayName)
  void TableNavigator.open(table)
}

const handleRefresh = async () => {
  logger.debug('TableSearch: refresh clicked')
  isRefreshing.value = true
  try {
    await TableService.refreshTables()
    logger.debug('TableSearch: refresh complete', { tableCount: TableService.getTables().length })
  } catch (error) {
    logger.error('TableSearch: refresh failed', error as Error)
  }
  isRefreshing.value = false
  showDropdown.value = true
}
</script>

<style scoped>
.table-search-container {
  position: relative;
  padding: 8px 10px 10px 0 !important;
}

.table-search-title {
  font-size: 12px;
  font-weight: 600;
  color: #666;
  margin-bottom: 6px;
  padding: 0 0 6px 6px;
}

.table-search-input-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
}

.table-search-container input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  outline: none;
  background: transparent;
}

.table-search-container input:focus {
  border-color: #2dbbe1;
}

.table-search-container input::placeholder {
  color: #999;
}

.refresh-btn {
  padding: 6px 8px;
  background: transparent;
  border: 1px solid #ddd;
  border-radius: 4px;
  color: #666;
  cursor: pointer;
  transition: all 0.2s;
}

.refresh-btn:hover {
  background: #f5f5f5;
  color: #333;
}

.refresh-btn svg {
  display: block;
}

.refresh-btn svg.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.table-search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 10px !important;
  background: white;
  border: 1px solid #ddd;
  border-radius: 4px;
  max-height: 300px;
  overflow-y: auto;
  list-style: none;
  padding: 0;
  z-index: 1000;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.table-search-results li {
  padding: 8px 12px;
  cursor: pointer;
  color: #333;
  border-bottom: 1px solid #eee;
}

.table-search-results li:last-child {
  border-bottom: none;
}

.table-search-results li:hover,
.table-search-results li.selected {
  background: #f5f5f5;
}

.table-search-results li.no-results {
  color: #999;
  cursor: default;
}

.table-name {
  font-size: 13px;
}
</style>
