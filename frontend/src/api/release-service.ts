import { listRows, saveRows } from '@/data/local-store'
import { appendAudit, listAudits, listOwners, saveOwners } from '@/data/release-store'
import type {
  ActionResult,
  Actor,
  EntryRow,
  ReleaseAuditEntry,
  ReleaseContext,
  ReleaseOwner,
  ReleaseTodo,
} from '@/data/types'

const LINE_KEY = 'line'
const FLIGHT_KEY = 'flight'
const RELEASE_STATUS = '已放行'
const WAIT_RELEASE_STATUS = '待放行'
const RELEASE_ACTION = '确认放行'

// 放行结论的唯一事实来源：留痕中该检查单号最后一条「成功」的确认放行记录。
// 归属授权的唯一事实来源：检查单号归属台账。
// 行上的 status / 放行人员 字段只是可被任意改写的缓存，与以上两份冲突时一律以
// 「留痕 + 台账」为准——它们只能经带校验的接口产生，比可直接覆写的状态字段可信。
export function releasedCheckNos(): Set<string> {
  const released = new Set<string>()
  for (const audit of listAudits()) {
    if (audit.action === RELEASE_ACTION && audit.result === '成功' && audit.releasedAfter) {
      released.add(audit.checkNo)
    }
  }
  return released
}

export function lastSuccessRelease(checkNo: string): ReleaseAuditEntry | undefined {
  return [...listAudits()]
    .reverse()
    .find(
      (audit) =>
        audit.checkNo === checkNo &&
        audit.action === RELEASE_ACTION &&
        audit.result === '成功' &&
        audit.releasedAfter,
    )
}

export function auditsForCheck(checkNo: string): ReleaseAuditEntry[] {
  return listAudits()
    .filter((audit) => audit.checkNo === checkNo)
    .sort((a, b) => b.id - a.id)
}

export function allAudits(): ReleaseAuditEntry[] {
  return [...listAudits()].sort((a, b) => b.id - a.id)
}

function ownerOf(checkNo: string): ReleaseOwner | undefined {
  return listOwners().find((owner) => owner.checkNo === checkNo)
}

// 归属判定：姓名与班组必须同时匹配。同班组的其他人、同名不同班组都不算归属人。
export function evaluateOwner(
  owner: ReleaseOwner | undefined,
  actor: Actor,
): { canRelease: boolean; denyReason?: string } {
  if (!owner) {
    return { canRelease: false, denyReason: '该检查单号没有归属台账，任何身份都不能放行' }
  }
  if (actor.name === owner.releasePerson && actor.team === owner.team) {
    return { canRelease: true }
  }
  if (actor.team === owner.team) {
    return {
      canRelease: false,
      denyReason: `同一班组也不能代放行：检查单号 ${owner.checkNo} 归属 ${owner.team} ${owner.releasePerson}，须由本人操作`,
    }
  }
  return {
    canRelease: false,
    denyReason: `跨班组提交一律拒绝：检查单号 ${owner.checkNo} 归属 ${owner.team} ${owner.releasePerson}，${actor.team} ${actor.name} 无权放行`,
  }
}

function baseAudit(row: EntryRow) {
  return {
    checkNo: String(row['检查单号'] ?? ''),
    taskNo: String(row['任务编号'] ?? ''),
    flightNo: String(row['航班号'] ?? ''),
    releasedAfter: false,
  }
}

// 读时校正：以台账/留痕为准把被改写过的状态与人员字段修回来，并各记一条校正留痕。
function reconcile(actor?: Actor): ReleaseContext[] {
  const rows = listRows(LINE_KEY)
  const owners = listOwners()
  const releasedSet = releasedCheckNos()
  const conflicts: Record<number, string[]> = {}
  let rowsDirty = false
  let ownersDirty = false

  const nextRows = rows.map((row) => {
    const checkNo = String(row['检查单号'] ?? '')
    const owner = ownerOf(checkNo)
    const released = releasedSet.has(checkNo)
    const expectedStatus = released ? RELEASE_STATUS : undefined
    const notes: string[] = []
    let updated: EntryRow = row

    if (owner && String(row['放行人员'] ?? '') !== owner.releasePerson) {
      const fromPerson = String(row['放行人员'] ?? '')
      updated = { ...updated, 放行人员: owner.releasePerson }
      rowsDirty = true
      notes.push('放行人员字段与归属台账不一致，已按台账校正')
      appendAudit({
        ...baseAudit(row),
        action: '归属校正',
        result: '校正',
        actor: '系统校正',
        actorTeam: '数据层',
        fromPerson,
        fromTeam: owner.team,
        toPerson: owner.releasePerson,
        toTeam: owner.team,
        reason: `放行人员字段（${fromPerson || '空'}）与检查单号归属台账（${owner.releasePerson}）不一致，以台账为准`,
      })
    }

    const current = String(row.status)
    if (expectedStatus && current !== RELEASE_STATUS) {
      updated = { ...updated, status: RELEASE_STATUS, pending: false, 任务状态: RELEASE_STATUS }
      rowsDirty = true
      notes.push(`状态字段为「${current}」，留痕已有成功放行记录，已校正为「已放行」`)
      appendAudit({
        ...baseAudit(row),
        action: '状态校正',
        result: '校正',
        actor: '系统校正',
        actorTeam: '数据层',
        reason: `留痕存在成功放行记录而状态字段为「${current}」，放行结论以留痕为准，校正为「${RELEASE_STATUS}」`,
        releasedAfter: true,
      })
    } else if (!expectedStatus && current === RELEASE_STATUS) {
      updated = { ...updated, status: WAIT_RELEASE_STATUS, pending: true, 任务状态: WAIT_RELEASE_STATUS }
      rowsDirty = true
      notes.push('状态字段被置为「已放行」但没有成功放行留痕，已回退为「待放行」')
      appendAudit({
        ...baseAudit(row),
        action: '状态校正',
        result: '校正',
        actor: '系统校正',
        actorTeam: '数据层',
        reason: `状态字段为「${RELEASE_STATUS}」却查无成功放行留痕，放行结论以留痕为准，回退为「${WAIT_RELEASE_STATUS}」`,
      })
    }

    if (owner && owners.find((item) => item.checkNo === checkNo)) {
      // 台账自身与任务字段（任务编号/航班号）漂移时，以任务登记为准同步索引字段。
      const index = owners.findIndex((item) => item.checkNo === checkNo)
      const live = owners[index]
      if (
        live &&
        (live.taskNo !== String(row['任务编号'] ?? live.taskNo) ||
          live.flightNo !== String(row['航班号'] ?? live.flightNo))
      ) {
        owners[index] = {
          ...live,
          taskNo: String(row['任务编号'] ?? live.taskNo),
          flightNo: String(row['航班号'] ?? live.flightNo),
        }
        ownersDirty = true
      }
    }

    conflicts[Number(row.id)] = notes
    return updated
  })

  if (rowsDirty) {
    saveRows(LINE_KEY, nextRows)
  }
  if (ownersDirty) {
    saveOwners(owners)
  }

  return nextRows.map((row) => {
    const checkNo = String(row['检查单号'] ?? '')
    const owner = ownerOf(checkNo)
    const released = releasedSet.has(checkNo)
    const verdict = actor ? evaluateOwner(owner, actor) : { canRelease: false, denyReason: undefined }
    return {
      row,
      owner,
      released,
      releaseRecord: released ? lastSuccessRelease(checkNo) : undefined,
      canRelease: verdict.canRelease,
      denyReason: actor ? verdict.denyReason : undefined,
      conflicts: conflicts[Number(row.id)] ?? [],
    }
  })
}

// 勤务任务详情/列表统一入口：两个页面拿到的放行结论都出自这里。
export function releaseContexts(actor?: Actor): ReleaseContext[] {
  return reconcile(actor)
}

// 放行动作：归属校验 → 幂等 → 流转校验，全部不过都给拒绝结论并留痕。
export function confirmRelease(actor: Actor, id: number): ActionResult {
  const contexts = releaseContexts(actor)
  const context = contexts.find((item) => Number(item.row.id) === id)
  if (!context) {
    return { ok: false, message: `没有找到编号为 ${id} 的勤务任务` }
  }
  const { row, owner } = context

  const verdict = evaluateOwner(owner, actor)
  if (!verdict.canRelease) {
    appendAudit({
      ...baseAudit(row),
      action: '拒绝放行',
      result: '拒绝',
      actor: actor.name,
      actorTeam: actor.team,
      toPerson: owner?.releasePerson,
      toTeam: owner?.team,
      reason: verdict.denyReason ?? '归属校验未通过',
    })
    return { ok: false, message: verdict.denyReason ?? '归属校验未通过' }
  }

  if (context.released) {
    appendAudit({
      ...baseAudit(row),
      action: '重复放行',
      result: '拒绝',
      actor: actor.name,
      actorTeam: actor.team,
      reason: '该检查单号已有成功放行留痕，重复提交不生效',
      releasedAfter: true,
    })
    return { ok: false, message: `检查单号 ${owner!.checkNo} 已放行，同一任务重复放行只生效一次` }
  }

  if (String(row.status) !== WAIT_RELEASE_STATUS) {
    const reason = `任务尚未到「待放行」环节，当前状态「${row.status}」，不能放行`
    appendAudit({
      ...baseAudit(row),
      action: '拒绝放行',
      result: '拒绝',
      actor: actor.name,
      actorTeam: actor.team,
      toPerson: owner!.releasePerson,
      toTeam: owner!.team,
      reason,
    })
    return { ok: false, message: reason }
  }

  const rows = listRows(LINE_KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  const updated: EntryRow = {
    ...rows[index],
    status: RELEASE_STATUS,
    pending: false,
    任务状态: RELEASE_STATUS,
    放行人员: owner!.releasePerson,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(LINE_KEY, next)

  appendAudit({
    ...baseAudit(updated),
    action: RELEASE_ACTION,
    result: '成功',
    actor: actor.name,
    actorTeam: actor.team,
    toPerson: owner!.releasePerson,
    toTeam: owner!.team,
    reason: `归属校验通过（${actor.team} ${actor.name} 持有检查单号 ${owner!.checkNo}），放行生效`,
    releasedAfter: true,
  })

  return {
    ok: true,
    message: `检查单号 ${owner!.checkNo} 放行生效，放行结论已写留痕并同步航班保障待办`,
  }
}

// 归属变更：现任归属人或生产调度室可发起；已放行任务不允许再改归属。
export function transferOwnership(
  actor: Actor,
  id: number,
  nextPerson: string,
  nextTeam: string,
): ActionResult {
  const person = nextPerson.trim()
  const team = nextTeam.trim()
  if (!person || !team) {
    return { ok: false, message: '新的归属放行人员与班组都必须填写' }
  }
  const contexts = releaseContexts(actor)
  const context = contexts.find((item) => Number(item.row.id) === id)
  if (!context || !context.owner) {
    return { ok: false, message: `没有找到编号为 ${id} 的勤务任务归属台账` }
  }
  const { row, owner } = context

  if (context.released) {
    appendAudit({
      ...baseAudit(row),
      action: '归属变更',
      result: '拒绝',
      actor: actor.name,
      actorTeam: actor.team,
      reason: '任务已放行，归属不得再变更',
      releasedAfter: true,
    })
    return { ok: false, message: '该任务已放行，归属锁定，不能再变更' }
  }

  const allowed =
    (actor.name === owner.releasePerson && actor.team === owner.team) || actor.team === '生产调度室'
  if (!allowed) {
    appendAudit({
      ...baseAudit(row),
      action: '归属变更',
      result: '拒绝',
      actor: actor.name,
      actorTeam: actor.team,
      fromPerson: owner.releasePerson,
      fromTeam: owner.team,
      toPerson: person,
      toTeam: team,
      reason: `只有现任归属人或生产调度室能变更归属，${actor.team} ${actor.name} 无权操作`,
    })
    return { ok: false, message: '只有现任归属放行人员本人或生产调度室能变更检查单号归属' }
  }

  if (person === owner.releasePerson && team === owner.team) {
    return { ok: false, message: '新归属与现归属相同，无需变更' }
  }

  const owners = listOwners().map((item) =>
    item.checkNo === owner.checkNo
      ? { ...item, releasePerson: person, team, updatedAt: new Date().toISOString() }
      : item,
  )
  saveOwners(owners)

  const rows = listRows(LINE_KEY)
  const rowIndex = rows.findIndex((item) => Number(item.id) === id)
  const updatedRow: EntryRow = { ...rows[rowIndex], 放行人员: person }
  const nextRows = [...rows]
  nextRows[rowIndex] = updatedRow
  saveRows(LINE_KEY, nextRows)

  appendAudit({
    ...baseAudit(updatedRow),
    action: '归属变更',
    result: '成功',
    actor: actor.name,
    actorTeam: actor.team,
    fromPerson: owner.releasePerson,
    fromTeam: owner.team,
    toPerson: person,
    toTeam: team,
    reason: `检查单号 ${owner.checkNo} 归属由 ${owner.team} ${owner.releasePerson} 变更为 ${team} ${person}（操作人 ${actor.team} ${actor.name}）`,
  })

  return {
    ok: true,
    message: `检查单号 ${owner.checkNo} 归属已变更为 ${team} ${person}，原归属人已留痕`,
  }
}

// 安全演练：模拟绕过服务校验、直接覆写状态/放行人员字段（即本次漏洞的越权路径）。
// 不写留痕、不查归属；下次读取时由 reconcile 发现冲突、按留痕/台账校正并留痕。
export function tamperRowDirect(id: number, patch: Record<string, string | number | boolean>): ActionResult {
  const rows = listRows(LINE_KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的勤务任务` }
  }
  const next = [...rows]
  next[index] = { ...next[index], ...patch }
  saveRows(LINE_KEY, next)
  return { ok: true, message: '已绕过校验直接改写字段（未留痕）' }
}

// 航班保障侧放行待办：直接读勤务侧校正后的同源数据，本函数是两边唯一的交汇处。
export function releaseTodosForFlight(): ReleaseTodo[] {
  const contexts = releaseContexts()
  const flightRows = listRows(FLIGHT_KEY)
  return contexts.map(({ row, owner, released, conflicts }) => {
    const flightNo = String(row['航班号'] ?? '')
    const matchedFlight = flightRows.some((flight) =>
      String(flight['航班号'] ?? '').includes(flightNo),
    )
    return {
      taskId: Number(row.id),
      taskNo: String(row['任务编号'] ?? ''),
      checkNo: String(row['检查单号'] ?? ''),
      flightNo,
      ownerPerson: owner?.releasePerson ?? '（台账缺失）',
      ownerTeam: owner?.team ?? '（台账缺失）',
      status: String(row.status),
      released,
      pendingRelease: !released && String(row.status) === WAIT_RELEASE_STATUS,
      matchedFlight,
      conflicts,
    }
  })
}
