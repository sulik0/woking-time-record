import { useState, useEffect, useMemo, useRef, type ChangeEvent } from 'react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { 
  Clock, 
  Calendar, 
  Plus, 
  Trash2, 
  TrendingUp,
  Target,
  CheckCircle2,
  AlertCircle,
  Upload,
  Sparkles,
  FileImage,
  X,
  BarChart3
} from 'lucide-react'
import {
  TimeRecord,
  getWorkdaysInMonth,
  getRemainingWeekends,
  getRequiredOvertimeMinutes,
  calculateWorkedMinutes,
  calculateOvertimeMinutes,
  formatMinutesToHours,
  formatDate,
  isDateWeekend,
  getTodayString,
  generateId,
  saveRecords,
  loadRecords,
  filterCurrentMonthRecords
} from './utils/timeUtils'
import { parseDingTalkText, ParsedDingTalkRecord, parseDingTalkStatsText, ParsedDingTalkStats } from './utils/ocrUtils'

type OcrStatus = 'idle' | 'loading' | 'success' | 'error'

interface OcrItem {
  id: string
  file: File
  previewUrl: string
  status: OcrStatus
  message: string
  progress: number | null
  parsed: ParsedDingTalkRecord | null
  text: string
}

function App() {
  const [records, setRecords] = useState<TimeRecord[]>([])
  const [currentDate] = useState(new Date())
  const [formData, setFormData] = useState({
    date: getTodayString(),
    startTime: '09:00',
    endTime: '18:00'
  })
  const [ocrItems, setOcrItems] = useState<OcrItem[]>([])
  const ocrItemsRef = useRef<OcrItem[]>([])
  const [statsResult, setStatsResult] = useState<ParsedDingTalkStats | null>(null)
  const [statsOcrStatus, setStatsOcrStatus] = useState<OcrStatus>('idle')
  const [statsOcrMessage, setStatsOcrMessage] = useState('')
  const [statsPreviewUrl, setStatsPreviewUrl] = useState<string | null>(null)
  const [manualAvgHours, setManualAvgHours] = useState('')
  const [manualAttendanceDays, setManualAttendanceDays] = useState('')

  // 加载本地数据
  useEffect(() => {
    setRecords(loadRecords())
  }, [])

  // 保存数据
  useEffect(() => {
    saveRecords(records)
  }, [records])

  useEffect(() => {
    ocrItemsRef.current = ocrItems
  }, [ocrItems])

  // 释放预览 URL
  useEffect(() => {
    return () => {
      ocrItemsRef.current.forEach(item => URL.revokeObjectURL(item.previewUrl))
    }
  }, [])

  // 计算统计数据
  const stats = useMemo(() => {
    const workdays = getWorkdaysInMonth(currentDate)
    const requiredOvertime = getRequiredOvertimeMinutes(workdays)
    const remainingWeekends = getRemainingWeekends(currentDate)
    
    const monthRecords = filterCurrentMonthRecords(records, currentDate)
    const totalOvertime = monthRecords.reduce((sum, r) => sum + r.overtimeMinutes, 0)
    const totalWorked = monthRecords.reduce((sum, r) => sum + r.workedMinutes, 0)
    
    const progress = requiredOvertime > 0 ? Math.min(100, (totalOvertime / requiredOvertime) * 100) : 0
    const remainingOvertime = Math.max(0, requiredOvertime - totalOvertime)
    
    return {
      workdays,
      requiredOvertime,
      remainingWeekends,
      totalOvertime,
      totalWorked,
      progress,
      remainingOvertime,
      recordCount: monthRecords.length
    }
  }, [records, currentDate])

  // 当月记录
  const currentMonthRecords = useMemo(() => {
    return filterCurrentMonthRecords(records, currentDate).sort((a, b) => 
      b.date.localeCompare(a.date)
    )
  }, [records, currentDate])

  // 添加记录
  const addRecord = (date: string, startTime: string, endTime: string) => {
    const type = isDateWeekend(date) ? 'holiday' : 'workday'
    const workedMinutes = calculateWorkedMinutes(startTime, endTime)
    const overtimeMinutes = calculateOvertimeMinutes(workedMinutes, type)

    const newRecord: TimeRecord = {
      id: generateId(),
      date,
      startTime,
      endTime,
      type,
      workedMinutes,
      overtimeMinutes
    }

    setRecords(prev => [...prev, newRecord])
  }

  const handleAddRecord = () => {
    const { date, startTime, endTime } = formData
    addRecord(date, startTime, endTime)
    
    // 重置表单
    setFormData({
      date: getTodayString(),
      startTime: '09:00',
      endTime: '18:00'
    })
  }

  // 删除记录
  const handleDeleteRecord = (id: string) => {
    setRecords(prev => prev.filter(r => r.id !== id))
  }

  const handleOcrFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return
    const newItems: OcrItem[] = files.map(file => ({
      id: generateId(),
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'idle',
      message: '等待识别',
      progress: null,
      parsed: null,
      text: ''
    }))
    setOcrItems(prev => [...prev, ...newItems])
    event.target.value = ''
  }

  const updateOcrItem = (id: string, updates: Partial<OcrItem>) => {
    setOcrItems(prev =>
      prev.map(item => (item.id === id ? { ...item, ...updates } : item))
    )
  }

  const removeOcrItem = (id: string) => {
    setOcrItems(prev => {
      const target = prev.find(item => item.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter(item => item.id !== id)
    })
  }

  const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number) => {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
      promise
        .then(result => {
          clearTimeout(timer)
          resolve(result)
        })
        .catch(error => {
          clearTimeout(timer)
          reject(error)
        })
    })
  }

  const recognizeOcrItem = async (item: OcrItem) => {
    updateOcrItem(item.id, {
      status: 'loading',
      message: '正在加载 OCR 引擎...',
      progress: null,
      parsed: null,
      text: ''
    })

    let worker: any = null

    try {
      const { createWorker } = await import('tesseract.js')
      worker = await withTimeout(
        createWorker({
          logger: message => {
            if (typeof message.progress === 'number') {
              updateOcrItem(item.id, { progress: Math.round(message.progress * 100) })
            }
            if (message.status) {
              updateOcrItem(item.id, { message: `OCR：${message.status}` })
            }
          }
        }),
        15000
      )

      try {
        updateOcrItem(item.id, { message: '加载中文识别模型...' })
        await withTimeout(worker.loadLanguage('eng+chi_sim'), 20000)
        await withTimeout(worker.initialize('eng+chi_sim'), 15000)
      } catch (error) {
        updateOcrItem(item.id, { message: '切换英文识别模型...' })
        await withTimeout(worker.loadLanguage('eng'), 20000)
        await withTimeout(worker.initialize('eng'), 15000)
      }

      updateOcrItem(item.id, { message: '识别中...' })
      const { data } = await withTimeout(worker.recognize(item.file), 45000)

      const text = data?.text ?? ''
      const parsed = parseDingTalkText(text, new Date())

      updateOcrItem(item.id, {
        status: 'success',
        message: parsed.isValid ? '识别完成，可直接保存。' : '识别完成，请确认结果。',
        parsed,
        text
      })
    } catch (error) {
      const errorMessage = error instanceof Error && error.message === 'timeout'
        ? '识别超时，请换更清晰的截图或稍后重试。'
        : '识别失败，请更换清晰截图或手动录入。'
      updateOcrItem(item.id, { status: 'error', message: errorMessage })
    } finally {
      if (worker) {
        await worker.terminate()
      }
    }
  }

  const handleOcrRecognizeAll = async () => {
    for (const item of ocrItems) {
      if (item.status === 'loading') continue
      await recognizeOcrItem(item)
    }
  }

  const handleApplyParsed = (parsed: ParsedDingTalkRecord | null) => {
    if (!parsed) return
    setFormData({
      date: parsed.date,
      startTime: parsed.startTime || formData.startTime,
      endTime: parsed.endTime || formData.endTime
    })
  }

  const handleSaveParsed = (parsed: ParsedDingTalkRecord | null) => {
    if (!parsed || !parsed.isValid) return
    addRecord(parsed.date, parsed.startTime, parsed.endTime)
  }

  // 统计页面 OCR 识别
  const handleStatsFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    
    // 释放旧的预览 URL
    if (statsPreviewUrl) {
      URL.revokeObjectURL(statsPreviewUrl)
    }
    
    setStatsPreviewUrl(URL.createObjectURL(file))
    setStatsResult(null)
    setStatsOcrStatus('idle')
    setStatsOcrMessage('已选择图片，点击“识别统计”开始')
    event.target.value = ''
  }

  const handleStatsRecognize = async () => {
    if (!statsPreviewUrl) return
    
    setStatsOcrStatus('loading')
    setStatsOcrMessage('正在加载 OCR 引擎...')
    
    let worker: any = null
    
    try {
      const { createWorker } = await import('tesseract.js')
      
      // 创建 worker
      worker = await createWorker()
      
      setStatsOcrMessage('加载识别模型...')
      try {
        await worker.loadLanguage('chi_sim+eng')
        await worker.initialize('chi_sim+eng')
      } catch {
        await worker.loadLanguage('eng')
        await worker.initialize('eng')
      }
      
      setStatsOcrMessage('识别中...')
      const response = await fetch(statsPreviewUrl)
      const blob = await response.blob()
      const { data } = await worker.recognize(blob)
      
      const text = data?.text ?? ''
      console.log('OCR 识别结果:', text)
      const parsed = parseDingTalkStatsText(text, stats.workdays)
      
      setStatsResult(parsed)
      setStatsOcrStatus(parsed.isValid ? 'success' : 'error')
      setStatsOcrMessage(parsed.isValid ? '识别完成' : '识别失败，请手动输入')
    } catch (error) {
      console.error('OCR 错误:', error)
      setStatsOcrStatus('error')
      setStatsOcrMessage('识别失败，请手动输入数据')
    } finally {
      if (worker) {
        await worker.terminate()
      }
    }
  }

  // 手动输入统计数据
  const handleManualStatsInput = (avgHours: number, attendanceDays: number) => {
    const totalHours = avgHours * attendanceDays
    const weekendWorkDays = Math.max(0, attendanceDays - stats.workdays)
    const correctAvgHours = stats.workdays > 0 ? totalHours / stats.workdays : 0
    
    setStatsResult({
      year: currentDate.getFullYear(),
      month: currentDate.getMonth() + 1,
      avgHours,
      attendanceDays,
      restDays: 0,
      totalHours,
      workdays: stats.workdays,
      correctAvgHours,
      weekendWorkDays,
      isValid: true,
      warnings: []
    })
  }

  return (
    <div className="min-h-screen bg-background">
      {/* 头部 */}
      <header className="bg-gradient-primary text-primary-foreground py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <Clock className="w-8 h-8" />
            <h1 className="text-2xl font-bold">工时记录器</h1>
          </div>
          <p className="opacity-90">
            {format(currentDate, 'yyyy年M月', { locale: zhCN })} · 轻松管理你的加班时长
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* 统计卡片 */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="stat-card">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Calendar className="w-4 h-4" />
              <span className="text-sm">本月工作日</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{stats.workdays}</p>
            <p className="text-sm text-muted-foreground mt-1">天</p>
          </div>

          <div className="stat-card">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Target className="w-4 h-4" />
              <span className="text-sm">需加班时长</span>
            </div>
            <p className="text-3xl font-bold text-foreground">
              {Math.floor(stats.requiredOvertime / 60)}
            </p>
            <p className="text-sm text-muted-foreground mt-1">小时</p>
          </div>

          <div className="stat-card">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm">已加班时长</span>
            </div>
            <p className="text-3xl font-bold text-primary">
              {Math.floor(stats.totalOvertime / 60)}
            </p>
            <p className="text-sm text-muted-foreground mt-1">小时</p>
          </div>

          <div className="stat-card">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Calendar className="w-4 h-4" />
              <span className="text-sm">剩余周末</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{stats.remainingWeekends}</p>
            <p className="text-sm text-muted-foreground mt-1">天</p>
          </div>
        </section>

        {/* 进度条 */}
        <section className="card p-6 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-foreground">加班进度</h2>
            {stats.progress >= 100 ? (
              <span className="badge-success">
                <CheckCircle2 className="w-4 h-4 mr-1" />
                已完成
              </span>
            ) : (
              <span className="badge-warning">
                <AlertCircle className="w-4 h-4 mr-1" />
                进行中
              </span>
            )}
          </div>
          
          <div className="progress-bar mb-3">
            <div 
              className="progress-fill" 
              style={{ width: `${stats.progress}%` }}
            />
          </div>
          
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              已完成 {formatMinutesToHours(stats.totalOvertime)}
            </span>
            <span className="font-medium text-foreground">
              {stats.progress.toFixed(1)}%
            </span>
            <span className="text-muted-foreground">
              还需 {formatMinutesToHours(stats.remainingOvertime)}
            </span>
          </div>
        </section>

        {/* OCR 上传 */}
        <section className="card p-6 animate-slide-up">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <h2 className="font-semibold text-foreground">上传钉钉打卡截图识别</h2>
            </div>
            <span className="text-sm text-muted-foreground">本地识别，不上传服务器</span>
          </div>

          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <input
              id="ocr-upload"
              type="file"
              accept="image/*"
              multiple
              onChange={handleOcrFilesChange}
              className="sr-only"
            />
            <label htmlFor="ocr-upload" className="btn-secondary flex items-center justify-center gap-2">
              <Upload className="w-4 h-4" />
              选择截图
            </label>
            <button
              onClick={handleOcrRecognizeAll}
              className="btn-primary flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={ocrItems.length === 0 || ocrItems.some(item => item.status === 'loading')}
            >
              <Sparkles className="w-4 h-4" />
              识别全部
            </button>
            <p className="text-sm text-muted-foreground">支持多图批量识别</p>
          </div>

          {ocrItems.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              <FileImage className="w-8 h-8 mx-auto mb-2 opacity-50" />
              选择多张截图后开始识别
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {ocrItems.map(item => (
                <div key={item.id} className="rounded-lg border border-border p-4 bg-muted/20 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <FileImage className="w-4 h-4" />
                      <span className="truncate">{item.file.name}</span>
                    </div>
                    <button
                      onClick={() => removeOcrItem(item.id)}
                      className="p-1 rounded-md text-muted-foreground hover:text-danger hover:bg-danger/10"
                      aria-label="移除截图"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <img
                    src={item.previewUrl}
                    alt="钉钉打卡截图预览"
                    className="w-full rounded-lg object-cover aspect-video"
                  />

                  <div className="text-xs text-muted-foreground">
                    {item.message}
                    {item.progress !== null ? ` ${item.progress}%` : ''}
                  </div>

                  {item.parsed && (
                    <div className="text-sm">
                      <p className="text-foreground font-medium">
                        {item.parsed.date} {item.parsed.startTime} - {item.parsed.endTime || '待确认'}
                      </p>
                      {item.parsed.warnings.length > 0 && (
                        <p className="text-warning text-sm mt-1">{item.parsed.warnings.join(' ')}</p>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      onClick={() => recognizeOcrItem(item)}
                      className="btn-secondary w-full flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                      disabled={item.status === 'loading'}
                    >
                      识别
                    </button>
                    <button
                      onClick={() => handleApplyParsed(item.parsed)}
                      className="btn-secondary w-full"
                      disabled={!item.parsed}
                    >
                      填充表单
                    </button>
                    <button
                      onClick={() => handleSaveParsed(item.parsed)}
                      className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                      disabled={!item.parsed?.isValid}
                    >
                      保存记录
                    </button>
                  </div>

                  {item.text && (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer">查看 OCR 原文</summary>
                      <pre className="mt-2 whitespace-pre-wrap">{item.text}</pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 统计页面识别 */}
        <section className="card p-6 animate-slide-up">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              <h2 className="font-semibold text-foreground">钉钉统计页面识别</h2>
            </div>
            <span className="text-sm text-muted-foreground">计算正确的平均工时（按工作日计算）</span>
          </div>

          <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
            <input
              id="stats-upload"
              type="file"
              accept="image/*"
              onChange={handleStatsFileChange}
              className="sr-only"
            />
            <label htmlFor="stats-upload" className="btn-secondary flex items-center justify-center gap-2">
              <Upload className="w-4 h-4" />
              选择统计截图
            </label>
            <button
              onClick={handleStatsRecognize}
              className="btn-primary flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={!statsPreviewUrl || statsOcrStatus === 'loading'}
            >
              <Sparkles className="w-4 h-4" />
              识别统计
            </button>
            {statsOcrMessage && (
              <span className="text-sm text-muted-foreground">{statsOcrMessage}</span>
            )}
          </div>

          {/* 手动输入 */}
          <div className="mb-4 p-4 bg-muted/30 rounded-lg">
            <p className="text-sm text-muted-foreground mb-3">或手动输入钉钉显示的数据：</p>
            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground whitespace-nowrap">平均工时</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="9.43"
                  className="input-field w-24"
                  value={manualAvgHours}
                  onChange={(e) => setManualAvgHours(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">小时</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground whitespace-nowrap">出勤天数</label>
                <input
                  type="number"
                  placeholder="23"
                  className="input-field w-20"
                  value={manualAttendanceDays}
                  onChange={(e) => setManualAttendanceDays(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">天</span>
              </div>
              <button
                onClick={() => {
                  const avg = parseFloat(manualAvgHours || '0')
                  const days = parseInt(manualAttendanceDays || '0')
                  if (avg > 0 && days > 0) {
                    handleManualStatsInput(avg, days)
                  }
                }}
                className="btn-secondary"
              >
                计算
              </button>
            </div>
          </div>

          {/* 预览图片 */}
          {statsPreviewUrl && (
            <div className="mb-4">
              <img
                src={statsPreviewUrl}
                alt="钉钉统计页面截图"
                className="max-w-xs rounded-lg border border-border"
              />
            </div>
          )}

          {/* 结果显示 */}
          {statsResult && (
            <div className="rounded-lg border border-border p-4 bg-gradient-to-r from-primary/5 to-transparent">
              <h3 className="font-medium text-foreground mb-3">工时统计结果</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <p className="text-sm text-muted-foreground">钉钉平均工时</p>
                  <p className="text-xl font-bold text-foreground">{statsResult.avgHours.toFixed(2)}h</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">出勤天数</p>
                  <p className="text-xl font-bold text-foreground">{statsResult.attendanceDays}天</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">工作日天数</p>
                  <p className="text-xl font-bold text-foreground">{statsResult.workdays}天</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">周末加班</p>
                  <p className="text-xl font-bold text-primary">{statsResult.weekendWorkDays}天</p>
                </div>
              </div>
              
              <div className="p-4 bg-primary/10 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">总工时</span>
                  <span className="font-medium">{statsResult.totalHours.toFixed(2)} 小时</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">正确的平均工时（按{statsResult.workdays}工作日计算）</span>
                  <span className="text-2xl font-bold text-primary">{statsResult.correctAvgHours.toFixed(2)}h</span>
                </div>
              </div>
              
              {statsResult.avgHours !== statsResult.correctAvgHours && (
                <p className="mt-3 text-sm text-warning">
                  提示：钉钉按{statsResult.attendanceDays}天计算平均工时为 {statsResult.avgHours.toFixed(2)}h，
                  正确的应按{statsResult.workdays}工作日计算为 <strong>{statsResult.correctAvgHours.toFixed(2)}h</strong>
                </p>
              )}
            </div>
          )}
        </section>

        {/* 录入表单 */}
        <section className="card p-6 animate-slide-up">
          <h2 className="font-semibold text-foreground mb-4">录入打卡记录</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-2">日期</label>
              <input
                type="date"
                value={formData.date}
                onChange={e => setFormData(prev => ({ ...prev, date: e.target.value }))}
                className="input-field"
              />
            </div>
            
            <div>
              <label className="block text-sm text-muted-foreground mb-2">上班时间</label>
              <input
                type="time"
                value={formData.startTime}
                onChange={e => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
                className="input-field"
              />
            </div>
            
            <div>
              <label className="block text-sm text-muted-foreground mb-2">下班时间</label>
              <input
                type="time"
                value={formData.endTime}
                onChange={e => setFormData(prev => ({ ...prev, endTime: e.target.value }))}
                className="input-field"
              />
            </div>
            
            <div className="flex items-end">
              <button onClick={handleAddRecord} className="btn-primary w-full flex items-center justify-center gap-2">
                <Plus className="w-5 h-5" />
                添加记录
              </button>
            </div>
          </div>

          {/* 预览 */}
          {formData.date && (
            <div className="mt-4 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-4 text-sm">
                <span className={isDateWeekend(formData.date) ? 'badge-primary' : 'badge-success'}>
                  {isDateWeekend(formData.date) ? '休息日' : '工作日'}
                </span>
                <span className="text-muted-foreground">
                  工作时长：{formatMinutesToHours(calculateWorkedMinutes(formData.startTime, formData.endTime))}
                </span>
                <span className="text-primary font-medium">
                  加班时长：{formatMinutesToHours(
                    calculateOvertimeMinutes(
                      calculateWorkedMinutes(formData.startTime, formData.endTime),
                      isDateWeekend(formData.date) ? 'holiday' : 'workday'
                    )
                  )}
                </span>
              </div>
            </div>
          )}
        </section>

        {/* 记录列表 */}
        <section className="card overflow-hidden animate-fade-in">
          <div className="p-6 border-b border-border">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-foreground">本月打卡记录</h2>
              <span className="text-sm text-muted-foreground">{stats.recordCount} 条记录</span>
            </div>
          </div>
          
          {currentMonthRecords.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Clock className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>暂无打卡记录</p>
              <p className="text-sm mt-1">添加你的第一条打卡记录吧</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {currentMonthRecords.map(record => (
                <div 
                  key={record.id}
                  className="p-4 hover:bg-muted/30 transition-colors flex items-center justify-between"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-gradient-primary flex items-center justify-center text-primary-foreground font-bold">
                      {record.date.slice(8)}
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{formatDate(record.date)}</p>
                      <p className="text-sm text-muted-foreground">
                        {record.startTime} - {record.endTime}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className={record.type === 'holiday' ? 'badge-primary' : 'badge-success'}>
                        {record.type === 'holiday' ? '休息日' : '工作日'}
                      </span>
                      <p className="text-sm text-muted-foreground mt-1">
                        加班 <span className="text-primary font-medium">{formatMinutesToHours(record.overtimeMinutes)}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteRecord(record.id)}
                      className="p-2 text-muted-foreground hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* 页脚 */}
      <footer className="py-8 text-center text-sm text-muted-foreground">
        <p>工时记录器 · 数据保存在本地浏览器中</p>
      </footer>
    </div>
  )
}

export default App
