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
  X
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
import { parseDingTalkText, ParsedDingTalkRecord } from './utils/ocrUtils'

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
    const type = isDateWeekend(date) ? 'weekend' : 'workday'
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
                  {isDateWeekend(formData.date) ? '周末' : '工作日'}
                </span>
                <span className="text-muted-foreground">
                  工作时长：{formatMinutesToHours(calculateWorkedMinutes(formData.startTime, formData.endTime))}
                </span>
                <span className="text-primary font-medium">
                  加班时长：{formatMinutesToHours(
                    calculateOvertimeMinutes(
                      calculateWorkedMinutes(formData.startTime, formData.endTime),
                      isDateWeekend(formData.date) ? 'weekend' : 'workday'
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
                      <span className={record.type === 'weekend' ? 'badge-primary' : 'badge-success'}>
                        {record.type === 'weekend' ? '周末' : '工作日'}
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
