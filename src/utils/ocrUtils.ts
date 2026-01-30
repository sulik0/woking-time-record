export interface ParsedDingTalkRecord {
  date: string
  startTime: string
  endTime: string
  times: string[]
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
