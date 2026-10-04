// 内层数据读写的验证脚本：模拟两个毛病场景，确认归属校验、留痕、幂等、同源都生效。
// 运行：npx tsx scripts/verify-release.ts
import { listEntries, listReleaseAudit, reassignReleaser, runAction } from '../src/api/local-service'
import { listRows } from '../src/data/local-store'

// localStorage 不在 Node 里，数据层对无 window 的环境会退化为内存态，直接可用。
let failures = 0
function check(label: string, cond: boolean, extra = '') {
  if (cond) {
    console.log(`  PASS ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label} ${extra}`)
  }
}

const zhang = { name: '张建国', team: '机务一班' } // LINE-0001 归属
const li = { name: '李卫东', team: '机务一班' } // 与张建国同班组，LINE-0002 归属
const wang = { name: '王海涛', team: '机务二班' } // 跨班组
const admin = { name: '值班管理员', team: '值班室' }

console.log('场景一：同班组非归属人放行 LINE-0001（毛病一）')
let r = runAction('line', 1, '开始勤务', zhang)
check('归属人开始勤务', r.ok)
r = runAction('line', 1, '提交放行', zhang)
check('归属人提交放行', r.ok)
r = runAction('line', 1, '确认放行', li)
check('同班组非归属人被拒绝', !r.ok, r.message)
check('拒绝提示点名归属人', r.message.includes('张建国'), r.message)
check('状态未被推动', String(listRows('line')[0].status) === '待放行')
let audit = listReleaseAudit('LINE-0001')
check('越权尝试已留痕', audit.some((e) => e.result === '已拒绝' && e.operator === '李卫东'))

console.log('场景二：跨班组放行 LINE-0001（毛病一）')
r = runAction('line', 1, '确认放行', wang)
check('跨班组被拒绝', !r.ok, r.message)
check('提示跨班组口径', r.message.includes('跨班组'), r.message)

console.log('场景三：归属人放行 + 幂等')
r = runAction('line', 1, '确认放行', zhang)
check('归属人放行成功', r.ok, r.message)
check('状态为已放行', String(listRows('line')[0].status) === '已放行')
const auditAfterRelease = listReleaseAudit('LINE-0001').length
r = runAction('line', 1, '确认放行', zhang)
check('重复放行幂等返回成功', r.ok, r.message)
check('重复放行提示未重复生效', r.message.includes('未重复生效'), r.message)
check('重复放行不新增留痕', listReleaseAudit('LINE-0001').length === auditAfterRelease)

console.log('场景四：归属变更留痕可溯（毛病二）')
r = reassignReleaser('LINE-0002', '张建国', admin)
check('归属变更成功', r.ok, r.message)
audit = listReleaseAudit('LINE-0002')
const change = audit.find((e) => e.result === '归属变更')
check('变更留痕存在', Boolean(change))
check('留痕保留原归属人', change?.fromReleaser === '李卫东' && change?.toReleaser === '张建国')
check('任务行展示副本同步', String(listRows('line')[1]['放行人员']) === '张建国')
r = runAction('line', 2, '确认放行', li)
check('原归属人变更后无权放行', !r.ok, r.message)

console.log('场景五：放行结论驱动航班保障放行待办（同源）')
let flight = listEntries('flight').items
check('CA1801 已放行', String(flight[0]['放行待办']) === '已放行', String(flight[0]['放行待办']))
check('CA1802 待放行', String(flight[1]['放行待办']) === '待放行', String(flight[1]['放行待办']))
runAction('line', 2, '确认放行', zhang) // LINE-0002 现归属张建国
flight = listEntries('flight').items
check('勤务放行后航班待办联动', String(flight[1]['放行待办']) === '已放行', String(flight[1]['放行待办']))

console.log('场景六：未识别操作人拒绝')
r = runAction('line', 3, '确认放行', { name: '', team: '' })
check('空操作人被拒绝', !r.ok, r.message)

console.log(failures === 0 ? '全部通过' : `失败 ${failures} 项`)
process.exit(failures === 0 ? 0 : 1)
