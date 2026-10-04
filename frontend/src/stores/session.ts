import { defineStore } from 'pinia'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    operatorTeam: '值班室',
    shiftLabel: '白班 08:00-20:00',
    scope: '机场地面保障作业管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setOperator(name: string, team: string) {
      this.operator = name
      this.operatorTeam = team
    },
  },
})
