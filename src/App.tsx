import { useState, useEffect, useMemo, type ChangeEvent } from 'react'
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
  AlertCircle
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

function App() {
  const [records, setRecords] = useState<TimeRecord[]>([])
  const [currentDate] = useState(new Date())
  const [formData, setFormData] = useState({
    date: getTodayString(),
    startTime: '09:00',
    endTime: '18:00'
  })
  const [ocrFile, setOcrFile] = useState<File | null>(null)
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string | null>(null)
  const [ocrStatus, setOcrStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [ocrMessage, setOcrMessage] = useState('')
  const [ocrProgress, setOcrProgress] = useState<number | null>(null)
  const [ocrParsed, setOcrParsed] = useState<ParsedDingTalkRecord | null>(null)
  const [ocrText, setOcrText] = useState('')

  // 加载本地数据
  useEffect(() => {
    setRecords(loadRecords())
  }, [])

  // 保存数据
  useEffect(() => {
    saveRecords(records)
  }, [records])

  // 释放预览 URL
  useEffect(() => {
    return () => {
      if (ocrPreviewUrl) {
        URL.revokeObjectURL(ocrPreviewUrl)
      }
    }
  }, [ocrPreviewUrl])

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

  const handleOcrFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setOcrFile(file)
    setOcrParsed(null)
    setOcrText('')
    setOcrStatus('idle')
    setOcrMessage('')
    setOcrProgress(null)

    if (ocrPreviewUrl) {
      URL.revokeObjectURL(ocrPreviewUrl)
    }

    if (file) {
      setOcrPreviewUrl(URL.createObjectURL(file))
    } else {
      setOcrPreviewUrl(null)
    }
  }

  const handleOcrRecognize = async () => {
    if (!ocrFile) return

    setOcrStatus('loading')
    setOcrMessage('正在加载 OCR 引擎...')
    setOcrProgress(null)
    setOcrParsed(null)
    setOcrText('')

    try {
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker({
        logger: message => {
          if (typeof message.progress === 'number') {
            setOcrProgress(Math.round(message.progress * 100))
          }
          if (message.status) {
            setOcrMessage(`OCR：${message.status}`)
          }
        }
      })

      try {
        await worker.loadLanguage('eng+chi_sim')
        await worker.initialize('eng+chi_sim')
      } catch (error) {
        await worker.loadLanguage('eng')
        await worker.initialize('eng')
      }

      const { data } = await worker.recognize(ocrFile)
      await worker.terminate()

      const text = data.text ?? ''
      setOcrText(text)

      const parsed = parseDingTalkText(text, new Date())
      setOcrParsed(parsed)
      setOcrStatus('success')
      setOcrMessage(parsed.isValid ? '识别完成，可直接保存。' : '识别完成，请确认结果。')
    } catch (error) {
      setOcrStatus('error')
      setOcrMessage('识别失败，请更换清晰截图或手动录入。')
    }
  }

  const handleApplyParsed = () => {
    if (!ocrParsed) return
    setFormData({
      date: ocrParsed.date,
      startTime: ocrParsed.startTime || formData.startTime,
      endTime: ocrParsed.endTime || formData.endTime
    })
  }

  const handleSaveParsed = () => {
    if (!ocrParsed || !ocrParsed.isValid) return
    addRecord(ocrParsed.date, ocrParsed.startTime, ocrParsed.endTime)
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
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-foreground">上传钉钉打卡截图识别</h2>
            <span className="text-sm text-muted-foreground">本地识别，不上传服务器</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <label className="block text-sm text-muted-foreground mb-2">截图文件</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleOcrFileChange}
                className="input-field"
              />
            </div>
            <div className="md:col-span-2 flex flex-col gap-3">
              <button
                onClick={handleOcrRecognize}
                className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={!ocrFile || ocrStatus === 'loading'}
              >
                {ocrStatus === 'loading' ? '识别中...' : '开始识别'}
              </button>
              {ocrMessage && (
                <p className="text-sm text-muted-foreground">
                  {ocrMessage}{ocrProgress !== null ? ` ${ocrProgress}%` : ''}
                </p>
              )}
            </div>
          </div>

          {ocrPreviewUrl && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-border p-3 bg-muted/20">
                <p className="text-sm text-muted-foreground mb-2">截图预览</p>
                <img src={ocrPreviewUrl} alt="钉钉打卡截图预览" className="w-full rounded-lg" />
              </div>
              <div className="rounded-lg border border-border p-3 bg-muted/20">
                <p className="text-sm text-muted-foreground mb-2">识别结果</p>
                {ocrParsed ? (
                  <div className="space-y-3">
                    <div className="text-sm">
                      <p className="text-foreground font-medium">
                        {ocrParsed.date} {ocrParsed.startTime} - {ocrParsed.endTime || '待确认'}
                      </p>
                      {ocrParsed.warnings.length > 0 && (
                        <p className="text-warning text-sm mt-1">{ocrParsed.warnings.join(' ')}</p>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        onClick={handleApplyParsed}
                        className="btn-secondary w-full"
                      >
                        填充到手动表单
                      </button>
                      <button
                        onClick={handleSaveParsed}
                        className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={!ocrParsed.isValid}
                      >
                        直接保存记录
                      </button>
                    </div>
                    {ocrText && (
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">查看 OCR 原文</summary>
                        <pre className="mt-2 whitespace-pre-wrap">{ocrText}</pre>
                      </details>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">等待识别结果。</p>
                )}
              </div>
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
