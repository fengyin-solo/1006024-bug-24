import { RELEASE_OWNER_SEED } from './release-seed'
import type { ReleaseAuditEntry, ReleaseOwner } from './types'

// 放行域两份独立数据：归属台账可变更（留痕），放行留痕只增不改。
const OWNER_KEY = 'airport-ground-ops:release-owners'
const AUDIT_KEY = 'airport-ground-ops:release-audit'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readJson<T>(storageKey: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(storageKey)
  if (!raw) {
    window.localStorage.setItem(storageKey, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    window.localStorage.setItem(storageKey, JSON.stringify(fallback))
    return clone(fallback)
  }
}

function writeJson(storageKey: string, value: unknown): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(storageKey, JSON.stringify(value))
  }
}

let ownerCache: ReleaseOwner[] | null = null
let auditCache: ReleaseAuditEntry[] | null = null

export function listOwners(): ReleaseOwner[] {
  if (ownerCache === null) {
    ownerCache = readJson<ReleaseOwner[]>(OWNER_KEY, RELEASE_OWNER_SEED)
  }
  return ownerCache
}

export function saveOwners(owners: ReleaseOwner[]): void {
  ownerCache = owners
  writeJson(OWNER_KEY, owners)
}

export function listAudits(): ReleaseAuditEntry[] {
  if (auditCache === null) {
    auditCache = readJson<ReleaseAuditEntry[]>(AUDIT_KEY, [])
  }
  return auditCache
}

// 留痕只增不改：没有更新/删除接口，任何写动作都只能走这里追加。
export function appendAudit(entry: Omit<ReleaseAuditEntry, 'id' | 'time'>): ReleaseAuditEntry {
  const audits = listAudits()
  const next: ReleaseAuditEntry = {
    ...entry,
    id: audits.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    time: new Date().toISOString(),
  }
  const nextList = [...audits, next]
  auditCache = nextList
  writeJson(AUDIT_KEY, nextList)
  return next
}
