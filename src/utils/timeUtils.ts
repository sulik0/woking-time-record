import { 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  isWeekend, 
  format, 
  getDay,
  differenceInMinutes,
  parse,
  isSameMonth,
  isBefore,
  isAfter,
  startOfDay
} from 'date-fns'
import { zhCN } from 'date-fns/locale'

export interface TimeRecord {
  id: string
  date: string // YYYY-MM-DD
  startTime: string // HH:mm
  endTime: string // HH:mm
  type: 'workday' | 'weekend'
  workedMinutes: number
  overtimeMinutes: number
}

// 计算本月工作日数量
export function getWorkdaysInMonth(date: Date): number {
  const start = startOfMonth(date)
  const end = endOfMonth(date)
  const days = eachDayOfInterval({ start, end })
  return days.filter(day => !isWeekend(day)).length
}

// 计算本月剩余周末数
export function getRemainingWeekends(date: Date): number {
  const today = startOfDay(new Date())
  const end = endOfMonth(date)
  
  if (!isSameMonth(today, date)) {
    // 如果不是当月，返回整月周末数
    const start = startOfMonth(date)
    const days = eachDayOfInterval({ start, end })
    return days.filter(day => isWeekend(day)).length
  }
  
  const days = eachDayOfInterval({ start: today, end })
  return days.filter(day => isWeekend(day)).length
}

// 计算需要的总加班时长（分钟）
export function getRequiredOvertimeMinutes(workdays: number): number {
  return workdays * 2 * 60 // 每个工作日需要加班2小时
}

// 计算单条记录的工时
export function calculateWorkedMinutes(startTime: string, endTime: string): number {
  const start = parse(startTime, 'HH:mm', new Date())
  const end = parse(endTime, 'HH:mm', new Date())
  return differenceInMinutes(end, start)
}

// 计算加班时长（工作日：超过8小时的部分；周末：全部算加班）
export function calculateOvertimeMinutes(workedMinutes: number, type: 'workday' | 'weekend'): number {
  if (type === 'weekend') {
    return workedMinutes // 周末全算加班
  }
  const standardMinutes = 8 * 60 // 标准8小时
  return Math.max(0, workedMinutes - standardMinutes)
}

// 格式化分钟为小时和分钟
export function formatMinutesToHours(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}分钟`
  if (mins === 0) return `${hours}小时`
  return `${hours}小时${mins}分钟`
}

// 格式化日期显示
export function formatDate(dateStr: string): string {
  const date = parse(dateStr, 'yyyy-MM-dd', new Date())
  return format(date, 'M月d日 EEEE', { locale: zhCN })
}

// 判断日期是否为周末
export function isDateWeekend(dateStr: string): boolean {
  const date = parse(dateStr, 'yyyy-MM-dd', new Date())
  return isWeekend(date)
}

// 获取今天的日期字符串
export function getTodayString(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

// 生成唯一ID
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

// 本地存储
export function saveRecords(records: TimeRecord[]): void {
  localStorage.setItem('timeRecords', JSON.stringify(records))
}

export function loadRecords(): TimeRecord[] {
  const data = localStorage.getItem('timeRecords')
  return data ? JSON.parse(data) : []
}

// 过滤当月记录
export function filterCurrentMonthRecords(records: TimeRecord[], date: Date): TimeRecord[] {
  const monthStart = startOfMonth(date)
  const monthEnd = endOfMonth(date)
  
  return records.filter(record => {
    const recordDate = parse(record.date, 'yyyy-MM-dd', new Date())
    return !isBefore(recordDate, monthStart) && !isAfter(recordDate, monthEnd)
  })
}
