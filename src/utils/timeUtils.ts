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
  type: 'workday' | 'holiday' // workday=工作日, holiday=休息日(周末或节假日)
  workedMinutes: number
  overtimeMinutes: number
}

// 中国法定节假日（2024-2026年）
// 格式：'YYYY-MM-DD'
const HOLIDAYS: Set<string> = new Set([
  // 2024年
  '2024-01-01', // 元旦
  '2024-02-10', '2024-02-11', '2024-02-12', '2024-02-13', '2024-02-14', '2024-02-15', '2024-02-16', '2024-02-17', // 春节
  '2024-04-04', '2024-04-05', '2024-04-06', // 清明节
  '2024-05-01', '2024-05-02', '2024-05-03', '2024-05-04', '2024-05-05', // 劳动节
  '2024-06-08', '2024-06-09', '2024-06-10', // 端午节
  '2024-09-15', '2024-09-16', '2024-09-17', // 中秋节
  '2024-10-01', '2024-10-02', '2024-10-03', '2024-10-04', '2024-10-05', '2024-10-06', '2024-10-07', // 国庆节
  // 2025年
  '2025-01-01', // 元旦
  '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-01', '2025-02-02', '2025-02-03', '2025-02-04', // 春节
  '2025-04-04', '2025-04-05', '2025-04-06', // 清明节
  '2025-05-01', '2025-05-02', '2025-05-03', '2025-05-04', '2025-05-05', // 劳动节
  '2025-05-31', '2025-06-01', '2025-06-02', // 端午节
  '2025-10-01', '2025-10-02', '2025-10-03', '2025-10-04', '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08', // 国庆+中秋
  // 2026年
  '2026-01-01', '2026-01-02', '2026-01-03', // 元旦
  '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23', // 春节
  '2026-04-05', '2026-04-06', '2026-04-07', // 清明节
  '2026-05-01', '2026-05-02', '2026-05-03', // 劳动节
  '2026-06-19', '2026-06-20', '2026-06-21', // 端午节
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', // 国庆+中秋
])

// 调休上班日（周末需要上班的日子）
const WORKDAYS_OVERRIDE: Set<string> = new Set([
  // 2024年
  '2024-02-04', '2024-02-18', // 春节调休
  '2024-04-07', // 清明调休
  '2024-04-28', '2024-05-11', // 劳动节调休
  '2024-09-14', // 中秋调休
  '2024-09-29', '2024-10-12', // 国庆调休
  // 2025年
  '2025-01-26', '2025-02-08', // 春节调休
  '2025-04-27', // 劳动节调休
  '2025-09-28', '2025-10-11', // 国庆调休
  // 2026年
  '2026-01-04', // 元旦调休
  '2026-02-14', '2026-02-28', // 春节调休
  '2026-10-10', // 国庆调休
])

// 判断某天是否为节假日
export function isHoliday(dateStr: string): boolean {
  return HOLIDAYS.has(dateStr)
}

// 判断某天是否为调休工作日
export function isWorkdayOverride(dateStr: string): boolean {
  return WORKDAYS_OVERRIDE.has(dateStr)
}

// 判断日期是否为休息日（周末或节假日，但排除调休上班日）
export function isRestDay(dateStr: string): boolean {
  // 如果是节假日，则为休息日
  if (isHoliday(dateStr)) {
    return true
  }
  // 如果是调休上班日，则不是休息日
  if (isWorkdayOverride(dateStr)) {
    return false
  }
  // 否则判断是否为周末
  const date = parse(dateStr, 'yyyy-MM-dd', new Date())
  return isWeekend(date)
}

// 计算本月工作日数量（排除周末和节假日，加上调休上班日）
export function getWorkdaysInMonth(date: Date): number {
  const start = startOfMonth(date)
  const end = endOfMonth(date)
  const days = eachDayOfInterval({ start, end })
  return days.filter(day => {
    const dateStr = format(day, 'yyyy-MM-dd')
    return !isRestDay(dateStr)
  }).length
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

// 午休时长（分钟）
const LUNCH_BREAK_MINUTES = 60

// 计算单条记录的工时（扣除午休时间）
// 规则：9:00-18:00 实际9小时，扣除1小时午休 = 8小时工时
export function calculateWorkedMinutes(startTime: string, endTime: string): number {
  const start = parse(startTime, 'HH:mm', new Date())
  const end = parse(endTime, 'HH:mm', new Date())
  const totalMinutes = differenceInMinutes(end, start)
  
  // 如果工作时长超过4小时，扣除午休时间
  if (totalMinutes > 4 * 60) {
    return totalMinutes - LUNCH_BREAK_MINUTES
  }
  return totalMinutes
}

// 计算加班时长（工作日：超过8小时的部分；休息日：全部算加班）
export function calculateOvertimeMinutes(workedMinutes: number, type: 'workday' | 'holiday'): number {
  if (type === 'holiday') {
    return workedMinutes // 休息日全算加班
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

// 判断日期是否为周末（保留用于兼容）
export function isDateWeekend(dateStr: string): boolean {
  return isRestDay(dateStr)
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
