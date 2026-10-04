import { defineStore } from 'pinia'

import { ACTOR_ROSTER } from '@/data/release-seed'
import type { Actor } from '@/data/types'

// 当前值班身份：放行授权按姓名 + 班组双要素判定，可在页面切换以验证越权拦截。
export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: ACTOR_ROSTER[0].name,
    team: ACTOR_ROSTER[0].team,
    shiftLabel: '白班 08:00-20:00',
    scope: '机场地面保障作业管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    actor: (state): Actor => ({ name: state.operator, team: state.team }),
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setIdentity(actor: Actor) {
      this.operator = actor.name
      this.team = actor.team
    },
  },
})
