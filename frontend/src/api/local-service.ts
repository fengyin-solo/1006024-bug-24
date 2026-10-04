import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  appendAudit,
  getAssignment,
  listAssignments,
  listAudit,
  listRows,
  resetRows,
  saveAssignment,
  saveRows,
} from '@/data/local-store'
import type {
  ActionResult,
  Assignment,
  AuditEntry,
  EntryRow,
  ModuleMeta,
  OperatorRef,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 勤务放行：只有归属该检查单号的放行人员本人能把任务推到「已放行」。
const LINE_MODULE = 'line'
const RELEASE_TARGET = '已放行'
const RELEASE_FIELD = '放行人员'
const CHECK_FIELD = '检查单号'
const FLIGHT_NO_FIELD = '航班号'
// 航班保障任务上的放行待办列：由勤务放行状态实时派生，不落库，保证两边同源。
const FLIGHT_TODO_FIELD = '放行待办'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  const items = key === 'flight' ? matched.map(withFlightReleaseTodo) : matched
  return { items, total: items.length, page: 1, size: items.length }
}

// 航班保障任务的放行待办由勤务放行结论驱动：读取时按航班号实时派生，不存副本，
// 勤务那边放行一落地，这边待办跟着变，两边永远同源。
function withFlightReleaseTodo(row: EntryRow): EntryRow {
  const flightNo = String(row[FLIGHT_NO_FIELD] ?? '')
  const lineRows = listRows(LINE_MODULE).filter((item) => String(item[FLIGHT_NO_FIELD] ?? '') === flightNo)
  let todo = '—'
  if (lineRows.length > 0) {
    todo = lineRows.every((item) => String(item.status) === RELEASE_TARGET) ? '已放行' : '待放行'
  }
  return { ...row, [FLIGHT_TODO_FIELD]: todo }
}

export function runAction(
  key: string,
  id: number,
  action: string,
  operator?: OperatorRef,
): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  if (key === LINE_MODULE && target === RELEASE_TARGET) {
    return runLineRelease(meta, rows, index, action, operator)
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 勤务放行专属分支：归属校验 + 留痕 + 幂等，数据层的最后一道防线，
// 不管外层是哪个入口（放行列表、任务详情）调进来，规则都一样。
function runLineRelease(
  meta: ModuleMeta,
  rows: EntryRow[],
  index: number,
  action: string,
  operator?: OperatorRef,
): ActionResult {
  const row = rows[index]
  const checkNo = String(row[CHECK_FIELD] ?? '')
  const taskId = String(row['任务编号'] ?? row.id)
  const current = String(row.status)
  const operatorName = operator?.name.trim() ?? ''
  const operatorTeam = operator?.team.trim() ?? ''

  const trail = (result: string, message: string, fromReleaser: string, toReleaser: string, toStatus: string) =>
    appendAudit({
      module: LINE_MODULE,
      action,
      operator: operatorName || '未识别',
      operatorTeam: operatorTeam || '未识别',
      taskId,
      checkNo,
      fromStatus: current,
      toStatus,
      fromReleaser,
      toReleaser,
      result,
      message,
    })

  // 幂等：同一任务重复放行只生效一次，不重复改数据、不重复留痕。
  if (current === RELEASE_TARGET) {
    return { ok: true, message: `${meta.entity}已是「已放行」，重复提交未重复生效` }
  }

  const assignment = getAssignment(checkNo)
  if (!assignment) {
    const message = `检查单号 ${checkNo} 没有登记放行归属，禁止放行`
    trail('已拒绝', message, String(row[RELEASE_FIELD] ?? ''), '', current)
    return { ok: false, message }
  }
  if (!operatorName) {
    const message = '未识别当前操作人，禁止放行'
    trail('已拒绝', message, assignment.releaser, assignment.releaser, current)
    return { ok: false, message }
  }
  if (operatorName !== assignment.releaser) {
    // 归属校验按「人」不按班组：同班组其他成员与跨班组提交一律拒绝，留痕里都能查到是谁试的。
    const message =
      operatorTeam === assignment.team
        ? `检查单号 ${checkNo} 的归属放行人员是 ${assignment.releaser}，同班组其他成员无权放行`
        : `检查单号 ${checkNo} 归属 ${assignment.team} 的 ${assignment.releaser}，跨班组提交一律拒绝`
    trail('已拒绝', message, assignment.releaser, assignment.releaser, current)
    return { ok: false, message }
  }

  // 放行状态与检查单号归属冲突时以归属登记为准：行内「放行人员」只是展示副本，
  // 这里按登记回写纠正，并把纠正前后的归属人都写进留痕。
  const rowReleaser = String(row[RELEASE_FIELD] ?? '')
  const updated: EntryRow = {
    ...row,
    status: RELEASE_TARGET,
    pending: false,
    abnormal: false,
    [RELEASE_FIELD]: assignment.releaser,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(LINE_MODULE, next)
  const correction =
    rowReleaser !== assignment.releaser
      ? `，行内放行人员「${rowReleaser || '空'}」与归属登记冲突，已按登记纠正`
      : ''
  trail('成功', `${meta.entity}已${action}，当前状态「已放行」${correction}`, rowReleaser, assignment.releaser, RELEASE_TARGET)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「已放行」` }
}

// 归属变更：登记改一份，任务行展示副本同步改，留痕里保留变更前后的归属人，
// 历史记录随时能查出原来归谁、是谁改的。
export function reassignReleaser(checkNo: string, nextReleaser: string, operator: OperatorRef): ActionResult {
  const assignment = getAssignment(checkNo)
  if (!assignment) {
    return { ok: false, message: `检查单号 ${checkNo} 没有登记放行归属` }
  }
  const name = nextReleaser.trim()
  if (!name) {
    return { ok: false, message: '新的放行人员不能为空' }
  }
  if (name === assignment.releaser) {
    return { ok: false, message: `检查单号 ${checkNo} 已归属 ${name}，无需变更` }
  }
  const previous = assignment.releaser
  saveAssignment({ ...assignment, releaser: name })
  const rows = listRows(LINE_MODULE)
  const lineRow = rows.find((row) => String(row[CHECK_FIELD] ?? '') === checkNo)
  if (lineRow) {
    saveRows(
      LINE_MODULE,
      rows.map((row) =>
        String(row[CHECK_FIELD] ?? '') === checkNo ? { ...row, [RELEASE_FIELD]: name } : row,
      ),
    )
  }
  appendAudit({
    module: LINE_MODULE,
    action: '变更归属',
    operator: operator.name.trim() || '未识别',
    operatorTeam: operator.team.trim() || '未识别',
    taskId: String(lineRow?.['任务编号'] ?? ''),
    checkNo,
    fromStatus: String(lineRow?.status ?? ''),
    toStatus: String(lineRow?.status ?? ''),
    fromReleaser: previous,
    toReleaser: name,
    result: '归属变更',
    message: `检查单号 ${checkNo} 的放行归属由 ${previous} 变更为 ${name}`,
  })
  return { ok: true, message: `检查单号 ${checkNo} 的放行归属已由 ${previous} 变更为 ${name}` }
}

export function listReleaseAssignments(): Assignment[] {
  return listAssignments()
}

export function listReleaseAudit(checkNo?: string): AuditEntry[] {
  const items = checkNo ? listAudit().filter((entry) => entry.checkNo === checkNo) : listAudit()
  return [...items].sort((a, b) => b.seq - a.seq)
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
