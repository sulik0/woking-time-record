import { useState, useEffect, useMemo } from 'react'
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

function App() {
  const [records, setRecords] = useState<TimeRecord[]>([])
  const [currentDate] = useState(new Date())
  const [formData, setFormData] = useState({
    date: getTodayString(),
    startTime: '09:00',
    endTime: '18:00'
  })

  // 加载本地数据
  useEffect(() => {
    setRecords(loadRecords())
  }, [])

  // 保存数据
  useEffect(() => {
    saveRecords(records)
  }, [records])

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
  const handleAddRecord = () => {
    const { date, startTime, endTime } = formData
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
