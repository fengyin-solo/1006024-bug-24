/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

// 当前操作人：放行授权按「姓名 + 班组」双要素匹配，同名不同班组不算同一人。
export type Actor = {
  name: string
  team: string
}

// 检查单号归属台账：一张检查单号对应一个勤务任务、一名归属放行人员及其班组。
// 台账只能通过带校验的放行服务变更，是放行授权的唯一依据。
export type ReleaseOwner = {
  checkNo: string
  taskNo: string
  flightNo: string
  releasePerson: string
  team: string
  updatedAt: string
}

// 放行留痕：只增不改。放行被拒绝也要记，事后才能查出是谁尝试越权。
export type ReleaseAuditEntry = {
  id: number
  time: string
  checkNo: string
  taskNo: string
  flightNo: string
  action: '确认放行' | '重复放行' | '拒绝放行' | '归属变更' | '归属校正' | '状态校正'
  result: '成功' | '拒绝' | '校正'
  actor: string
  actorTeam: string
  fromPerson?: string
  fromTeam?: string
  toPerson?: string
  toTeam?: string
  reason: string
  releasedAfter: boolean
}

// 单条勤务任务经放行服务校正后的有效视图。
export type ReleaseContext = {
  row: EntryRow
  owner?: ReleaseOwner
  released: boolean
  releaseRecord?: ReleaseAuditEntry
  canRelease: boolean
  denyReason?: string
  conflicts: string[]
}

// 航班保障侧的放行待办：与勤务任务列表由同一推导函数产出，保证两边同源。
export type ReleaseTodo = {
  taskId: number
  taskNo: string
  checkNo: string
  flightNo: string
  ownerPerson: string
  ownerTeam: string
  status: string
  released: boolean
  pendingRelease: boolean
  matchedFlight: boolean
  conflicts: string[]
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
