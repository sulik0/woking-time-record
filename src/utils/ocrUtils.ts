export interface ParsedDingTalkRecord {
  date: string
  startTime: string
  endTime: string
  times: string[]
  isValid: boolean
  warnings: string[]
}

// 钉钉统计页面识别结果
export interface ParsedDingTalkStats {
  year: number
  month: number
  avgHours: number        // 钉钉显示的平均工时
  attendanceDays: number  // 出勤天数
  restDays: number        // 休息天数
  totalHours: number      // 计算出的总工时
  workdays: number        // 工作日天数（计算得出）
  correctAvgHours: number // 正确的平均工时（按工作日计算）
  weekendWorkDays: number // 周末加班天数
  isValid: boolean
  warnings: string[]
}

const REPLACEMENTS: Record<string, string> = {
  O: '0',
  o: '0',
  Q: '0',
  D: '0',
  I: '1',
  l: '1',
  '|': '1',
  '!': '1',
  S: '5',
  s: '5',
  B: '8',
  Z: '2'
}

function normalizeDigits(value: string): string {
  return value
    .split('')
    .map(char => REPLACEMENTS[char] ?? char)
    .join('')
}

function padTwo(value: number): string {
  return value.toString().padStart(2, '0')
}

function formatDateYMD(year: number, month: number, day: number): string {
  return `${year}-${padTwo(month)}-${padTwo(day)}`
}

function extractDate(text: string, fallback: Date): { date: string; warning?: string } {
  const normalized = text.replace(/\s+/g, '')
  const ymdMatch = normalized.match(/(\d{4})[年\/\-\.](\d{1,2})[月\/\-\.](\d{1,2})/)
  if (ymdMatch) {
    const year = Number(ymdMatch[1])
    const month = Number(ymdMatch[2])
    const day = Number(ymdMatch[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { date: formatDateYMD(year, month, day) }
    }
  }

  const mdMatch = normalized.match(/(\d{1,2})月(\d{1,2})日/)
  if (mdMatch) {
    const year = fallback.getFullYear()
    const month = Number(mdMatch[1])
    const day = Number(mdMatch[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { date: formatDateYMD(year, month, day) }
    }
  }

  return { date: formatDateYMD(fallback.getFullYear(), fallback.getMonth() + 1, fallback.getDate()), warning: '未识别到日期，已使用今天日期。' }
}

function extractTimes(text: string): string[] {
  const results: string[] = []
  const timeRegex = /([0-2OQDoIl!|SBZ]{1,2})\s*[:：.\-]\s*([0-5OQDoIl!|SBZ]{1,2})/g
  let match: RegExpExecArray | null

  while ((match = timeRegex.exec(text)) !== null) {
    const hoursRaw = normalizeDigits(match[1])
    const minutesRaw = normalizeDigits(match[2])
    const hours = Number(hoursRaw)
    const minutes = Number(minutesRaw)
    if (!Number.isNaN(hours) && !Number.isNaN(minutes) && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      results.push(`${padTwo(hours)}:${padTwo(minutes)}`)
    }
  }

  return results
}

export function parseDingTalkText(text: string, referenceDate = new Date()): ParsedDingTalkRecord {
  const warnings: string[] = []
  const { date, warning } = extractDate(text, referenceDate)
  if (warning) warnings.push(warning)

  const times = extractTimes(text)
  const uniqueTimes = Array.from(new Set(times))
  uniqueTimes.sort((a, b) => {
    const [aH, aM] = a.split(':').map(Number)
    const [bH, bM] = b.split(':').map(Number)
    return aH * 60 + aM - (bH * 60 + bM)
  })

  if (uniqueTimes.length === 0) {
    warnings.push('未识别到有效打卡时间，请手动输入。')
  } else if (uniqueTimes.length === 1) {
    warnings.push('只识别到一个时间点，请确认上下班时间。')
  }

  const startTime = uniqueTimes[0] ?? ''
  const endTime = uniqueTimes.length > 1 ? uniqueTimes[uniqueTimes.length - 1] : ''

  return {
    date,
    startTime,
    endTime,
    times: uniqueTimes,
    isValid: Boolean(startTime && endTime),
    warnings
  }
}

/**
 * 解析钉钉统计页面的 OCR 文本
 * 提取平均工时、出勤天数、休息天数等信息
 * 并计算正确的平均工时（按工作日计算）
 */
export function parseDingTalkStatsText(text: string, workdaysInMonth: number): ParsedDingTalkStats {
  const warnings: string[] = []
  const normalized = text.replace(/\s+/g, ' ')
  
  // 提取年份和月份
  let year = new Date().getFullYear()
  let month = new Date().getMonth() + 1
  
  const yearMonthMatch = normalized.match(/(\d{4})\s*[\u5e74]?\s*(\d{1,2})\s*月/)
  if (yearMonthMatch) {
    year = Number(yearMonthMatch[1])
    month = Number(yearMonthMatch[2])
  } else {
    const monthMatch = normalized.match(/(\d{1,2})\s*月/)
    if (monthMatch) {
      month = Number(monthMatch[1])
    }
  }
  
  // 提取平均工时（支持小数）
  let avgHours = 0
  const avgHoursMatch = normalized.match(/(\d+\.?\d*)\s*平均工时/)
  if (avgHoursMatch) {
    avgHours = parseFloat(avgHoursMatch[1])
  } else {
    // 尝试另一种格式：平均工时 后面跟数字
    const avgMatch2 = normalized.match(/平均工时\s*(\d+\.?\d*)/)
    if (avgMatch2) {
      avgHours = parseFloat(avgMatch2[1])
    }
  }
  
  // 提取出勤天数
  let attendanceDays = 0
  const attendanceMatch = normalized.match(/(\d+)\s*出勤天数/)
  if (attendanceMatch) {
    attendanceDays = Number(attendanceMatch[1])
  } else {
    const attendMatch2 = normalized.match(/出勤天数\s*(\d+)/)
    if (attendMatch2) {
      attendanceDays = Number(attendMatch2[1])
    }
  }
  
  // 提取休息天数
  let restDays = 0
  const restMatch = normalized.match(/(\d+)\s*休息天数/)
  if (restMatch) {
    restDays = Number(restMatch[1])
  } else {
    const restMatch2 = normalized.match(/休息天数\s*(\d+)/)
    if (restMatch2) {
      restDays = Number(restMatch2[1])
    }
  }
  
  // 计算总工时（钉钉显示的平均工时 × 出勤天数）
  const totalHours = avgHours * attendanceDays
  
  // 使用传入的工作日天数
  const workdays = workdaysInMonth
  
  // 计算周末加班天数
  const weekendWorkDays = Math.max(0, attendanceDays - workdays)
  
  // 计算正确的平均工时（总工时 / 工作日天数）
  const correctAvgHours = workdays > 0 ? totalHours / workdays : 0
  
  // 验证数据
  if (avgHours === 0) {
    warnings.push('未识别到平均工时')
  }
  if (attendanceDays === 0) {
    warnings.push('未识别到出勤天数')
  }
  
  const isValid = avgHours > 0 && attendanceDays > 0
  
  return {
    year,
    month,
    avgHours,
    attendanceDays,
    restDays,
    totalHours,
    workdays,
    correctAvgHours,
    weekendWorkDays,
    isValid,
    warnings
  }
}
