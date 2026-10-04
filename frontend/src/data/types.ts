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

/** 当前操作人：放行动作按「人」校验归属，班组只用于区分拒绝口径与留痕。 */
export type OperatorRef = {
  name: string
  team: string
}

/** 检查单号归属登记：放行权限的唯一权威来源，任务行上的「放行人员」字段只是它的展示副本。 */
export type Assignment = {
  checkNo: string
  releaser: string
  team: string
}

/** 留痕条目：放行、拒绝、归属变更都落一条，归属变更必须带变更前后归属人。 */
export type AuditEntry = {
  seq: number
  time: string
  module: string
  action: string
  operator: string
  operatorTeam: string
  taskId: string
  checkNo: string
  fromStatus: string
  toStatus: string
  fromReleaser: string
  toReleaser: string
  result: string
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
