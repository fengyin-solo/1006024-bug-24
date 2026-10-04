import { SEED_ASSIGNMENTS, SEED_ROWS } from './seed'
import type { Assignment, AuditEntry, EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-ops:entries'
// 检查单号归属登记：独立存储，是放行权限的唯一权威来源。
const ASSIGNMENT_KEY = 'airport-ground-ops:assignments'
// 留痕：放行、拒绝、归属变更的流水，只增不改。
const AUDIT_KEY = 'airport-ground-ops:audit'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

let assignmentCache: Assignment[] | null = null
let auditCache: AuditEntry[] | null = null

export function listAssignments(): Assignment[] {
  if (assignmentCache === null) {
    assignmentCache = readJson<Assignment[]>(ASSIGNMENT_KEY, SEED_ASSIGNMENTS)
  }
  return assignmentCache
}

export function getAssignment(checkNo: string): Assignment | undefined {
  return listAssignments().find((item) => item.checkNo === checkNo)
}

export function saveAssignment(next: Assignment): void {
  const items = listAssignments().map((item) => (item.checkNo === next.checkNo ? next : item))
  if (!items.some((item) => item.checkNo === next.checkNo)) {
    items.push(next)
  }
  assignmentCache = items
  writeJson(ASSIGNMENT_KEY, items)
}

export function listAudit(): AuditEntry[] {
  if (auditCache === null) {
    auditCache = readJson<AuditEntry[]>(AUDIT_KEY, [])
  }
  return auditCache
}

// 留痕只追加不修改，seq 单调递增，保证历史顺序可查。
export function appendAudit(entry: Omit<AuditEntry, 'seq' | 'time'>): AuditEntry {
  const items = listAudit()
  const saved: AuditEntry = {
    ...entry,
    seq: items.length > 0 ? items[items.length - 1].seq + 1 : 1,
    time: new Date().toISOString(),
  }
  const next = [...items, saved]
  auditCache = next
  writeJson(AUDIT_KEY, next)
  return saved
}
