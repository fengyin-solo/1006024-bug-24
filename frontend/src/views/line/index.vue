<template>
  <section class="page" data-module="line">
    <header class="page-head">
      <div>
        <h2>机务勤务管理</h2>
        <p class="page-desc">勤务任务登记与放行。放行授权以检查单号归属台账为准，只有归属放行人员本人才能放行，跨班组提交一律拒绝，每次尝试都留痕。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记勤务任务</button>
        <button class="btn" type="button" @click="exportRows">导出机务勤务清单</button>
      </div>
    </header>

    <!-- 当前值班身份：归属校验按姓名 + 班组双要素进行，切换身份可验证越权拦截。 -->
    <div class="identity-bar">
      <span class="identity-label">当前值班身份</span>
      <select v-model="identityKey" class="identity-select">
        <option v-for="person in roster" :key="`${person.team}-${person.name}`" :value="`${person.team}|${person.name}`">
          {{ person.team }} · {{ person.name }}（{{ person.role }}）
        </option>
      </select>
      <span class="identity-hint">放行时将以「{{ store.team }} {{ store.operator }}」的身份校验检查单号归属</span>
    </div>

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

    <div v-if="conflictNotice" class="conflict-banner">
      <strong>检测到 {{ conflictNotice }} 条记录的放行字段被绕过校验改写。</strong>
      已按「留痕 + 检查单号归属台账」为准完成校正，放行人员与放行状态均以台账/留痕为准，校正动作已写入历史记录。
    </div>

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
          <th>放行结论 / 归属</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="ctx in filteredContexts" :key="String(ctx.row.id)">
          <td v-for="column in columns" :key="column">{{ ctx.row[column] ?? '—' }}</td>
          <td>
            <span :class="['status-tag', ctx.released ? 'status-done' : 'status-wait']">{{ ctx.row.status }}</span>
            <div v-if="ctx.released && ctx.releaseRecord" class="cell-sub">
              {{ ctx.releaseRecord.actorTeam }} {{ ctx.releaseRecord.actor }} 于 {{ formatTime(ctx.releaseRecord.time) }} 放行
            </div>
          </td>
          <td>
            <template v-if="ctx.owner">
              {{ ctx.owner.team }} · {{ ctx.owner.releasePerson }}
              <div class="cell-sub">检查单号 {{ ctx.owner.checkNo }} 的归属放行人员</div>
            </template>
            <span v-else class="error-text">无归属台账，禁止放行</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(ctx)"
              :key="action.name"
              :class="['link', { disabled: !action.enabled }]"
              type="button"
              :title="action.hint"
              @click="action.enabled && runAction(action.name, ctx.row)"
            >
              {{ action.name }}
            </button>
            <button class="link" type="button" @click="openDetail(ctx.row)">任务详情</button>
          </td>
        </tr>
        <tr v-if="!filteredContexts.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无机务勤务数据，可先登记勤务任务</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ filteredContexts.length }} 条机务勤务记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="lastMessage" class="ok-text">{{ lastMessage }}</span>
    </footer>

    <!-- 任务详情：与放行列表同一份放行结论，归属信息、变更与历史记录都在这里查。 -->
    <div v-if="detail" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>勤务任务详情 · {{ detail.row['任务编号'] }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>

        <div v-if="detail.conflicts.length" class="conflict-banner">
          <div v-for="(note, index) in detail.conflicts" :key="index">· {{ note }}</div>
        </div>

        <section class="drawer-section">
          <h4>放行信息</h4>
          <dl class="detail-grid">
            <div><dt>检查单号</dt><dd>{{ detail.row['检查单号'] }}</dd></div>
            <div><dt>航班号</dt><dd>{{ detail.row['航班号'] }}</dd></div>
            <div><dt>勤务项目</dt><dd>{{ detail.row['勤务项目'] }}</dd></div>
            <div><dt>任务状态</dt><dd>{{ detail.row.status }}</dd></div>
            <div><dt>归属班组</dt><dd>{{ detail.owner?.team ?? '台账缺失' }}</dd></div>
            <div><dt>归属放行人员</dt><dd>{{ detail.owner?.releasePerson ?? '台账缺失' }}</dd></div>
            <div><dt>放行结论</dt>
              <dd>
                <span v-if="detail.released" class="ok-text">已放行</span>
                <span v-else>未放行</span>
                <span v-if="detail.released && detail.releaseRecord" class="cell-sub">
                  由 {{ detail.releaseRecord.actorTeam }} {{ detail.releaseRecord.actor }} 于 {{ formatTime(detail.releaseRecord.time) }} 操作
                </span>
              </dd>
            </div>
          </dl>

          <button
            class="btn primary"
            type="button"
            :disabled="!detail.canRelease || detail.released || detail.row.status !== '待放行'"
            :title="releaseButtonHint(detail)"
            @click="runAction('确认放行', detail.row)"
          >
            {{ detail.released ? '已放行（不可重复放行）' : '确认放行' }}
          </button>
          <p v-if="releaseButtonHint(detail)" class="cell-sub deny-hint">{{ releaseButtonHint(detail) }}</p>
        </section>

        <section v-if="!detail.released && detail.owner" class="drawer-section">
          <h4>归属变更</h4>
          <p class="cell-sub">只有现任归属放行人员本人或生产调度室可以变更；变更后原归属人仍可在历史记录中查到。已放行任务归属锁定。</p>
          <div class="transfer-form">
            <label>
              <span>新归属班组</span>
              <input v-model="transfer.team" placeholder="如：机务三组" />
            </label>
            <label>
              <span>新归属放行人员</span>
              <input v-model="transfer.person" placeholder="姓名" />
            </label>
            <button class="btn" type="button" @click="submitTransfer">提交归属变更</button>
          </div>
        </section>

        <section class="drawer-section">
          <h4>安全演练（模拟越权直改，不经过校验与留痕）</h4>
          <div class="tamper-row">
            <button class="btn ghost danger" type="button" @click="tamperReleased">把状态直改为「已放行」</button>
            <button class="btn ghost danger" type="button" @click="tamperPerson">把放行人员直改为当前值班人</button>
          </div>
          <p class="cell-sub">直改后重新打开本页：数据层会发现状态/人员与留痕、台账冲突，自动校正并把冲突写进下方历史记录。</p>
        </section>

        <section class="drawer-section">
          <h4>放行与归属历史记录</h4>
          <table class="data-table audit-table">
            <thead>
              <tr><th>时间</th><th>动作</th><th>结果</th><th>操作人</th><th>归属变化</th><th>说明</th></tr>
            </thead>
            <tbody>
              <tr v-for="audit in detailAudits" :key="audit.id">
                <td>{{ formatTime(audit.time) }}</td>
                <td>{{ audit.action }}</td>
                <td>
                  <span :class="audit.result === '成功' ? 'ok-text' : audit.result === '拒绝' ? 'error-text' : 'warn-text'">
                    {{ audit.result }}
                  </span>
                </td>
                <td>{{ audit.actorTeam }} {{ audit.actor }}</td>
                <td>
                  <template v-if="audit.fromPerson || audit.toPerson">
                    {{ audit.fromTeam ? `${audit.fromTeam} ` : '' }}{{ audit.fromPerson || '—' }}
                    → {{ audit.toTeam ? `${audit.toTeam} ` : '' }}{{ audit.toPerson || '—' }}
                  </template>
                  <span v-else>—</span>
                </td>
                <td>{{ audit.reason }}</td>
              </tr>
              <tr v-if="!detailAudits.length">
                <td colspan="6" class="empty-state">该检查单号暂无历史记录</td>
              </tr>
            </tbody>
          </table>
        </section>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import {
  auditsForCheck,
  confirmRelease,
  releaseContexts,
  tamperRowDirect,
  transferOwnership,
} from '@/api/release-service'
import {
  downloadEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import { ACTOR_ROSTER } from '@/data/release-seed'
import type { ActionResult, EntryRow, ReleaseContext } from '@/data/types'

const store = useSessionStore()
const roster = ACTOR_ROSTER
const meta = moduleMeta('line')
const columns = ['任务编号', '航班号', '勤务项目', '放行人员', '开始时间', '结束时间', '检查单号', '任务状态']
const statuses = ['待执行', '执行中', '待放行', '已放行']

const contexts = ref<ReleaseContext[]>([])
const errorMessage = ref('')
const lastMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['任务编号', '航班号', '勤务项目']

const identityKey = computed({
  get: () => `${store.team}|${store.operator}`,
  set: (value: string) => {
    const [team, name] = value.split('|')
    store.setIdentity({ team, name })
  },
})

const detail = ref<ReleaseContext | null>(null)
const detailAudits = ref<ReturnType<typeof auditsForCheck>>([])
const transfer = reactive({ team: '', person: '' })

const stats = computed(() => [
  { label: '待执行勤务', value: contexts.value.filter((ctx) => ctx.row.status === '待执行').length },
  { label: '执行中勤务', value: contexts.value.filter((ctx) => ctx.row.status === '执行中').length },
  { label: '待放行任务', value: contexts.value.filter((ctx) => !ctx.released && ctx.row.status === '待放行').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: contexts.value.filter((ctx) => String(ctx.row.status) === status).length,
  })),
)

const conflictNotice = computed(() => {
  const count = contexts.value.reduce((sum, ctx) => sum + ctx.conflicts.length, 0)
  return count > 0 ? count : ''
})

const filteredContexts = computed(() => {
  const pairs = Object.entries(filters.value).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return contexts.value
  }
  return contexts.value.filter((ctx) =>
    pairs.every(([field, value]) => String(ctx.row[field] ?? '').includes(value.trim())),
  )
})

// 外层按钮的可用性也按归属判定，做前置拦截；内层放行服务会再独立校验一遍。
function availableActions(ctx: ReleaseContext): { name: string; enabled: boolean; hint: string }[] {
  if (ctx.released) {
    return []
  }
  const status = String(ctx.row.status)
  if (status === '待执行') {
    return [{ name: '开始勤务', enabled: true, hint: '' }]
  }
  if (status === '执行中') {
    return [{ name: '提交放行', enabled: true, hint: '' }]
  }
  if (status === '待放行') {
    return [
      {
        name: '确认放行',
        enabled: ctx.canRelease,
        hint: ctx.canRelease ? '' : (ctx.denyReason ?? '归属校验未通过'),
      },
    ]
  }
  return []
}

function releaseButtonHint(ctx: ReleaseContext): string {
  if (ctx.released) {
    return ''
  }
  if (String(ctx.row.status) !== '待放行') {
    return `任务当前为「${ctx.row.status}」，需提交放行后才能确认放行`
  }
  return ctx.canRelease ? '' : (ctx.denyReason ?? '归属校验未通过')
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '勤务任务登记入口尚未接入审批流'
}

function finish(result: ActionResult) {
  if (!result.ok) {
    lastMessage.value = ''
    errorMessage.value = result.message
  } else {
    errorMessage.value = ''
    lastMessage.value = result.message
  }
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  lastMessage.value = ''
  // 放行列表与任务详情都走同一个入口；line/确认放行 在内层同样被强制导向放行服务。
  const result =
    action === '确认放行'
      ? confirmRelease(store.actor, Number(row.id))
      : applyAction(meta.key, Number(row.id), action)
  finish(result)
}

function openDetail(row: EntryRow) {
  const ctx = contexts.value.find((item) => item.row.id === row.id) ?? null
  detail.value = ctx
  if (ctx) {
    detailAudits.value = auditsForCheck(String(ctx.row['检查单号'] ?? ''))
    transfer.team = ''
    transfer.person = ''
  }
  errorMessage.value = ''
}

function closeDetail() {
  detail.value = null
}

function submitTransfer() {
  if (!detail.value) {
    return
  }
  const result = transferOwnership(store.actor, Number(detail.value.row.id), transfer.person, transfer.team)
  finish(result)
  if (result.ok) {
    transfer.team = ''
    transfer.person = ''
  }
}

function tamperReleased() {
  if (!detail.value) {
    return
  }
  const result = tamperRowDirect(Number(detail.value.row.id), { status: '已放行', pending: false })
  finish(result)
}

function tamperPerson() {
  if (!detail.value) {
    return
  }
  const result = tamperRowDirect(Number(detail.value.row.id), { 放行人员: store.operator })
  finish(result)
}

function formatTime(value: string): string {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  const pad = (num: number) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function reload() {
  errorMessage.value = ''
  try {
    // 放行结论、归属、校正一律取自放行服务；这里不再用通用列表的行数据渲染放行状态。
    contexts.value = releaseContexts(store.actor)
    if (detail.value) {
      const refreshed = contexts.value.find((ctx) => ctx.row.id === detail.value?.row.id)
      detail.value = refreshed ?? null
      if (refreshed) {
        detailAudits.value = auditsForCheck(String(refreshed.row['检查单号'] ?? ''))
      }
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '机务勤务列表读取失败'
  }
}

// 身份切换后立即重新计算每行的放行权限。
watch(
  () => [store.operator, store.team],
  () => reload(),
)

onMounted(reload)
</script>
