import type { ReleaseOwner } from './types'

// 检查单号归属台账初始数据：检查单号与 seed.ts 里 line 的三条任务一一对应。
// 线上这份台账只能经放行服务的归属变更接口改写，任何页面都不能直接编辑。
export const RELEASE_OWNER_SEED: ReleaseOwner[] = [
  {
    checkNo: 'CHK-L0001',
    taskNo: 'LINE-0001',
    flightNo: 'CA1831',
    releasePerson: '王强',
    team: '机务一组',
    updatedAt: '2026-09-01T08:20:00.000Z',
  },
  {
    checkNo: 'CHK-L0002',
    taskNo: 'LINE-0002',
    flightNo: 'MU5102',
    releasePerson: '王强',
    team: '机务一组',
    updatedAt: '2026-09-02T08:20:00.000Z',
  },
  {
    checkNo: 'CHK-L0003',
    taskNo: 'LINE-0003',
    flightNo: 'CZ3108',
    releasePerson: '李娜',
    team: '机务二组',
    updatedAt: '2026-09-03T08:20:00.000Z',
  },
]

// 可切换的演示值班身份：覆盖同班组他人、归属人本人、跨班组他人、调度管理员。
export const ACTOR_ROSTER: { name: string; team: string; role: string }[] = [
  { name: '王强', team: '机务一组', role: 'CHK-L0001/0002 归属放行人员' },
  { name: '赵磊', team: '机务一组', role: '同班组其他放行人员' },
  { name: '李娜', team: '机务二组', role: 'CHK-L0003 归属放行人员' },
  { name: '孙敏', team: '机务二组', role: '跨班组放行人员' },
  { name: '调度管理员', team: '生产调度室', role: '归属变更（不得代为放行）' },
]
