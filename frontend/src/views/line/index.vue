<template>
  <section class="page" data-module="line">
    <header class="page-head">
      <div>
        <h2>机务勤务管理</h2>
        <p class="page-desc">维护勤务任务，围绕任务编号、航班号、勤务项目、放行人员做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <label class="operator-picker">
          <span>当前操作人</span>
          <select v-model="operatorKey">
            <option v-for="item in operatorOptions" :key="item.key" :value="item.key">
              {{ item.name }}（{{ item.team }}）
            </option>
          </select>
        </label>
        <button class="btn primary" type="button" @click="openCreate">登记勤务任务</button>
        <button class="btn" type="button" @click="exportRows">导出机务勤务清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="isRelease(action) && !canRelease(row)"
              :title="isRelease(action) ? releaseHint(row) : ''"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openDetail(row)">任务详情</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无机务勤务数据，可先登记勤务任务</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条机务勤务记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
    </footer>

    <div v-if="detailRow" class="detail-mask" @click.self="closeDetail">
      <section class="detail-panel">
        <header class="detail-head">
          <h3>勤务任务详情 · {{ detailRow['任务编号'] }}</h3>
          <button class="link" type="button" @click="closeDetail">关闭</button>
        </header>

        <dl class="detail-grid">
          <template v-for="column in columns" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ detailRow[column] ?? '—' }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detailRow.status }}</dd>
        </dl>

        <p class="detail-owner">
          检查单号 {{ detailCheckNo }} 的归属放行人员：
          <strong>{{ detailAssignment ? `${detailAssignment.releaser}（${detailAssignment.team}）` : '未登记' }}</strong>
        </p>

        <div class="detail-actions">
          <button
            class="btn primary"
            type="button"
            :disabled="!canRelease(detailRow)"
            :title="releaseHint(detailRow)"
            @click="runAction('确认放行', detailRow)"
          >
            确认放行
          </button>
          <label class="operator-picker">
            <span>归属变更为</span>
            <select v-model="nextReleaser">
              <option v-for="item in operatorOptions" :key="item.key" :value="item.name">
                {{ item.name }}（{{ item.team }}）
              </option>
            </select>
          </label>
          <button class="btn" type="button" @click="submitReassign">变更归属</button>
        </div>

        <h4 class="audit-title">放行留痕</h4>
        <table class="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>操作人</th>
              <th>动作</th>
              <th>结果</th>
              <th>归属变化</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in detailAudit" :key="entry.seq">
              <td>{{ formatTime(entry.time) }}</td>
              <td>{{ entry.operator }}（{{ entry.operatorTeam }}）</td>
              <td>{{ entry.action }}</td>
              <td>{{ entry.result }}</td>
              <td>{{ entry.fromReleaser === entry.toReleaser ? entry.fromReleaser || '—' : `${entry.fromReleaser || '—'} → ${entry.toReleaser || '—'}` }}</td>
              <td>{{ entry.message }}</td>
            </tr>
            <tr v-if="!detailAudit.length">
              <td colspan="6" class="empty-state">该检查单号暂无留痕</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listReleaseAssignments,
  listReleaseAudit,
  moduleMeta,
  reassignReleaser,
  runAction as applyAction,
} from '@/api/local-service'
import type { Assignment, AuditEntry, EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('line')
const columns = ["任务编号", "航班号", "勤务项目", "放行人员", "开始时间", "结束时间", "检查单号", "任务状态"]
const actions = ["开始勤务", "提交放行", "确认放行"]
const statuses = ["待执行", "执行中", "待放行", "已放行"]
const stats = [{"label": "待执行勤务", "value": 0}, {"label": "执行中勤务", "value": 0}, {"label": "待放行任务", "value": 0}]
const RELEASE_ACTION = '确认放行'

const store = useSessionStore()
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const assignments = ref<Assignment[]>([])
const detailRow = ref<EntryRow | null>(null)
const detailAudit = ref<AuditEntry[]>([])
const nextReleaser = ref('')

// 操作人候选 = 归属登记里的放行人员 + 值班管理员，切换后全局生效，别的页签也是这个身份。
const operatorOptions = computed(() => {
  const seen = new Map<string, { key: string; name: string; team: string }>()
  for (const item of assignments.value) {
    seen.set(`${item.releaser}@${item.team}`, { key: `${item.releaser}@${item.team}`, name: item.releaser, team: item.team })
  }
  seen.set('值班管理员@值班室', { key: '值班管理员@值班室', name: '值班管理员', team: '值班室' })
  return [...seen.values()]
})

const operatorKey = computed({
  get: () => `${store.operator}@${store.operatorTeam}`,
  set: (key: string) => {
    const picked = operatorOptions.value.find((item) => item.key === key)
    if (picked) {
      store.setOperator(picked.name, picked.team)
    }
  },
})

const detailCheckNo = computed(() => String(detailRow.value?.['检查单号'] ?? ''))
const detailAssignment = computed(() =>
  assignments.value.find((item) => item.checkNo === detailCheckNo.value),
)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isRelease(action: string) {
  return action === RELEASE_ACTION
}

function assignmentOf(row: EntryRow) {
  return assignments.value.find((item) => item.checkNo === String(row['检查单号'] ?? ''))
}

// 外层第一道防线：不是归属放行人员，按钮直接置灰并说明原因；
// 内层 local-service 还会再校验一次，绕过页面也改不动。
function canRelease(row: EntryRow) {
  if (String(row.status) === '已放行') {
    return false
  }
  const assignment = assignmentOf(row)
  return Boolean(assignment) && store.operator === assignment!.releaser
}

function releaseHint(row: EntryRow) {
  if (String(row.status) === '已放行') {
    return '该任务已放行，重复提交不会重复生效'
  }
  const assignment = assignmentOf(row)
  if (!assignment) {
    return '该检查单号未登记放行归属，禁止放行'
  }
  if (store.operator !== assignment.releaser) {
    return `仅归属放行人员 ${assignment.releaser}（${assignment.team}）可放行`
  }
  return ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  noticeMessage.value = ''
  errorMessage.value = '勤务任务登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, {
    name: store.operator,
    team: store.operatorTeam,
  })
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    noticeMessage.value = result.message
  }
  reload()
  if (detailRow.value && Number(detailRow.value.id) === Number(row.id)) {
    const fresh = rows.value.find((item) => Number(item.id) === Number(row.id))
    if (fresh) {
      openDetail(fresh)
    }
  }
}

function openDetail(row: EntryRow) {
  detailRow.value = row
  nextReleaser.value = assignmentOf(row)?.releaser ?? operatorOptions.value[0]?.name ?? ''
  detailAudit.value = listReleaseAudit(String(row['检查单号'] ?? ''))
}

function closeDetail() {
  detailRow.value = null
  detailAudit.value = []
}

function submitReassign() {
  if (!detailRow.value) {
    return
  }
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = reassignReleaser(detailCheckNo.value, nextReleaser.value, {
    name: store.operator,
    team: store.operatorTeam,
  })
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    noticeMessage.value = result.message
  }
  reload()
  const fresh = rows.value.find((item) => Number(item.id) === Number(detailRow.value?.id))
  if (fresh) {
    openDetail(fresh)
  }
}

function formatTime(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function reload() {
  errorMessage.value = ''
  try {
    assignments.value = listReleaseAssignments()
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '机务勤务列表读取失败'
  }
}

onMounted(reload)
</script>
