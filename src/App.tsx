import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { desktopApi, hasDesktopApi } from './desktopApi'
import { parseCsvMappings } from './shared/csv'
import { buildRenamePreviews, defaultFilters, getRefreshPathsAfterExecute, getRefreshPathsAfterUndo, makeRuleId } from './shared/renameEngine'
import { cloneRules, presetRules, suggestPreset } from './shared/presets'
import type {
  CleanupRule,
  DateRule,
  DesktopPlatform,
  ExtensionRule,
  FileItem,
  KeywordRule,
  NumberRule,
  PrefixSuffixRule,
  RenameExecutionResult,
  RenameFilters,
  RenameJob,
  RenamePreview,
  RenameRule,
  ReplaceRule,
  SortMode,
} from './shared/types'

type SelectionSource = 'files' | 'folders' | 'paths'

function App() {
  const [files, setFiles] = useState<FileItem[]>([])
  const [selection, setSelection] = useState<{ source: SelectionSource; paths: string[] }>({ source: 'paths', paths: [] })
  const [rules, setRules] = useState<RenameRule[]>(() => cloneRules(presetRules[0].rules))
  const [keepOriginalName, setKeepOriginalName] = useState(false)
  const [filters, setFilters] = useState<RenameFilters>(defaultFilters)
  const [sortMode, setSortMode] = useState<SortMode>('nameAsc')
  const [selectedPreset, setSelectedPreset] = useState(presetRules[0].id)
  const [pathText, setPathText] = useState('')
  const [previews, setPreviews] = useState<RenamePreview[]>([])
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [notice, setNotice] = useState('拖入文件或选择文件夹，先预览再改名。')
  const [lastResult, setLastResult] = useState<RenameExecutionResult | null>(null)
  const [platform, setPlatform] = useState<DesktopPlatform>('windows')

  const job = useMemo<RenameJob>(
    () => ({
      files,
      rules,
      filters,
      sortMode,
      platform,
      keepOriginalName,
    }),
    [files, filters, keepOriginalName, platform, rules, sortMode],
  )

  useEffect(() => {
    let cancelled = false
    async function refreshPreview() {
      if (files.length === 0) {
        setPreviews([])
        return
      }

      setIsPreviewing(true)
      const nextPreviews = hasDesktopApi ? await desktopApi!.previewRename(job) : buildRenamePreviews(job)
      if (!cancelled) {
        setPreviews(nextPreviews)
        setIsPreviewing(false)
      }
    }

    void refreshPreview()
    return () => {
      cancelled = true
    }
  }, [files.length, job])

  useEffect(() => {
    async function loadPlatform() {
      const detectedPlatform = await desktopApi?.getPlatform()
      if (detectedPlatform) setPlatform(detectedPlatform)
    }

    void loadPlatform()
  }, [])

  useEffect(() => {
    async function loadRecentRules() {
      const recentRules = await desktopApi?.readRecentRules()
      if (recentRules && recentRules.length > 0) {
        setRules(recentRules)
        setSelectedPreset('recent')
        setNotice('已恢复上次使用的规则。')
      }
    }

    void loadRecentRules()
  }, [])

  const stats = useMemo(() => {
    const ready = previews.filter((preview) => preview.willRename && (preview.status === 'ready' || preview.status === 'warning')).length
    const errors = previews.filter((preview) => preview.status === 'error').length
    const skipped = previews.filter((preview) => preview.status === 'skipped').length
    const unchanged = previews.filter((preview) => preview.status === 'unchanged').length
    return { ready, errors, skipped, unchanged, total: previews.length }
  }, [previews])

  const recommendedPreset = useMemo(() => suggestPreset(files), [files])

  const scanSelectedPaths = useCallback(
    async (paths: string[], source: SelectionSource = 'paths') => {
      if (paths.length === 0) return

      if (!hasDesktopApi) {
        const sampleFiles = createSampleFiles()
        setFiles(sampleFiles)
        setSelection({ source, paths })
        setNotice('当前在浏览器预览模式，已载入示例文件。桌面版会读取真实路径。')
        return
      }

      try {
        const scanned = await desktopApi!.scanPaths(paths, filters.recursive)
        const effectiveSource = source === 'paths' && selectedPathsAreScannedFiles(paths, scanned) ? 'files' : source
        setFiles(scanned)
        setSelection({ source: effectiveSource, paths })
        const suggested = suggestPreset(scanned)
        setSelectedPreset(suggested)
        setNotice(scanned.length > 0 ? `已导入 ${scanned.length} 个项目，推荐使用“${presetRules.find((preset) => preset.id === suggested)?.name}”。` : '没有扫描到可处理项目。')
      } catch (error) {
        setNotice(`导入失败：${getErrorMessage(error)}`)
      }
    },
    [filters.recursive],
  )

  useEffect(() => {
    if (!desktopApi?.onPathsDropped) return

    let unlisten: (() => void) | undefined
    void desktopApi.onPathsDropped((paths) => {
      void scanSelectedPaths(paths, 'paths')
    }).then((cleanup) => {
      unlisten = cleanup
    })

    return () => {
      unlisten?.()
    }
  }, [scanSelectedPaths])

  async function chooseFiles() {
    if (!hasDesktopApi) {
      await scanSelectedPaths(['sample'])
      return
    }
    const paths = await desktopApi!.chooseFiles()
    await scanSelectedPaths(paths, 'files')
  }

  async function chooseFolders() {
    if (!hasDesktopApi) {
      await scanSelectedPaths(['sample'])
      return
    }
    const paths = await desktopApi!.chooseFolders()
    await scanSelectedPaths(paths, 'folders')
  }

  async function importTypedPaths() {
    const paths = pathText
      .split(/\r?\n|;/)
      .map((value) => value.trim().replace(/^"|"$/g, ''))
      .filter(Boolean)
    await scanSelectedPaths(paths, 'paths')
  }

  async function importCsv() {
    if (!hasDesktopApi) {
      setNotice('CSV 映射需要在桌面版中使用。')
      return
    }

    const picked = await desktopApi!.chooseCsv()
    if (!picked) return

    const parsed = parseCsvMappings(picked.content)
    const csvRule: RenameRule = {
      id: makeRuleId('csv'),
      type: 'csvMap',
      enabled: true,
      mappings: parsed.mappings,
      matchBy: 'name',
    }
    setRules((current) => [csvRule, ...current])
    setNotice(
      parsed.errors.length > 0
        ? `已导入 ${Object.keys(parsed.mappings).length} 条映射，发现 ${parsed.errors.length} 个问题。`
        : `已导入 ${Object.keys(parsed.mappings).length} 条 CSV 映射。`,
    )
  }

  async function executeRename() {
    if (!hasDesktopApi) {
      setNotice('浏览器预览模式不会改动真实文件，请在桌面窗口中执行。')
      return
    }

    setIsExecuting(true)
    try {
      const result = await desktopApi!.executeRename(job)
      await desktopApi!.saveRecentRules(rules)
      setLastResult(result)
      const success = result.items.filter((item) => item.success).length
      const failed = result.items.length - success
      setNotice(`执行完成：成功 ${success} 项，跳过或失败 ${failed} 项。`)
      const rescanned = await desktopApi!.scanPaths(getRefreshPathsAfterExecute(files, result, selection.source, selection.paths), filters.recursive)
      setFiles(rescanned)
    } catch (error) {
      setNotice(`执行失败：${getErrorMessage(error)}`)
    } finally {
      setIsExecuting(false)
    }
  }

  async function undoLastRename() {
    if (!hasDesktopApi) {
      setNotice('撤销需要在桌面版中使用。')
      return
    }

    const result = await desktopApi!.undoLastRename()
    if (!result) {
      setNotice('没有可撤销的最近记录。')
      return
    }

    const restored = result.items.filter((item) => item.restored).length
    const failed = result.items.length - restored
    setNotice(`撤销完成：恢复 ${restored} 项，失败 ${failed} 项。`)
    const rescanned = await desktopApi!.scanPaths(getRefreshPathsAfterUndo(files, result, selection.source, selection.paths), filters.recursive)
    setFiles(rescanned)
  }

  function applyRecoveryMode() {
    setRules([
      {
        id: makeRuleId('recover'),
        type: 'misoperationCleanup',
        enabled: true,
      },
    ])
    setSelectedPreset('recovery')
    setKeepOriginalName(false)
    setNotice('已启用误操作恢复。请检查右侧预览，确认后再执行。')
  }

  function applyPreset(presetId: string) {
    const preset = presetRules.find((item) => item.id === presetId)
    if (!preset) return
    setRules(cloneRules(preset.rules))
    setSelectedPreset(presetId)
    setNotice(`已套用“${preset.name}”，右侧预览会立即更新。`)
  }

  function addRule(type: RenameRule['type']) {
    setRules((current) => [...current, createRule(type)])
    setSelectedPreset('custom')
  }

  function updateRule<T extends RenameRule>(id: string, patch: Partial<T>) {
    setRules((current) => current.map((rule) => (rule.id === id ? ({ ...rule, ...patch } as RenameRule) : rule)))
    setSelectedPreset('custom')
  }

  function moveRule(id: string, direction: -1 | 1) {
    setRules((current) => {
      const index = current.findIndex((rule) => rule.id === id)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      const [rule] = next.splice(index, 1)
      next.splice(nextIndex, 0, rule)
      return next
    })
    setSelectedPreset('custom')
  }

  function removeRule(id: string) {
    setRules((current) => current.filter((rule) => rule.id !== id))
    setSelectedPreset('custom')
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{getPlatformLabel(platform)} 本地工具</p>
          <h1>快捷批量重命名</h1>
        </div>
        <div className="topbar-actions">
          <button onClick={undoLastRename} className="button button-muted">撤销最近一次</button>
          <button onClick={executeRename} disabled={stats.ready === 0 || isExecuting} className="button button-primary">
            {isExecuting ? '执行中...' : `执行 ${stats.ready} 项`}
          </button>
        </div>
      </header>

      <section className="notice" aria-live="polite">
        <span>{notice}</span>
        {recommendedPreset !== selectedPreset && files.length > 0 ? (
          <button onClick={() => applyPreset(recommendedPreset)}>使用推荐预设</button>
        ) : null}
      </section>

      <div className="workspace">
        <aside className="left-rail">
          <section className="pane import-pane">
            <div className="pane-heading">
              <div>
                <h2>文件</h2>
                <p>{files.length > 0 ? `已载入 ${files.length} 个项目` : '拖进来，或者选择文件夹'}</p>
              </div>
              <button
                className="text-button"
                onClick={() => {
                  setFiles([])
                  setSelection({ source: 'paths', paths: [] })
                }}
              >
                清空
              </button>
            </div>

            <div
              className="drop-zone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const paths = Array.from(event.dataTransfer.files).map((file) => (file as File & { path?: string }).path).filter(Boolean) as string[]
                void scanSelectedPaths(paths)
              }}
            >
              <strong>拖入文件或文件夹</strong>
              <span>先预览，不会直接改名</span>
            </div>

            <div className="button-row">
              <button className="button button-secondary" onClick={chooseFiles}>选择文件</button>
              <button className="button button-secondary" onClick={chooseFolders}>选择文件夹</button>
            </div>

            <label className="path-input">
              粘贴路径
              <textarea
                value={pathText}
                placeholder="一行一个文件或文件夹路径"
                onChange={(event) => setPathText(event.target.value)}
              />
            </label>
            <button className="button button-secondary wide" onClick={importTypedPaths}>导入这些路径</button>

            <label className="check-row">
              <input
                type="checkbox"
                checked={filters.recursive}
                onChange={(event) => setFilters((current) => ({ ...current, recursive: event.target.checked }))}
              />
              包含子文件夹
            </label>

            <div className="split-fields">
              <label>
                扩展名筛选
                <input
                  value={filters.extensions.join(', ')}
                  placeholder="jpg, png, pdf"
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      extensions: event.target.value.split(',').map((value) => value.trim()).filter(Boolean),
                    }))
                  }
                />
              </label>
              <label>
                关键词筛选
                <input
                  value={filters.keyword}
                  placeholder="合同、SKU、截图"
                  onChange={(event) => setFilters((current) => ({ ...current, keyword: event.target.value }))}
                />
              </label>
            </div>
          </section>

          <section className="pane recovery-pane">
            <div className="pane-heading">
              <div>
                <h2>误操作恢复</h2>
                <p>保守清理开头关键词、编号、日期和分隔符</p>
              </div>
            </div>
            <button className="button button-secondary wide" onClick={applyRecoveryMode}>启用保守清理</button>
          </section>

          <section className="pane">
            <div className="pane-heading">
              <div>
                <h2>快捷场景</h2>
                <p>不从空白开始</p>
              </div>
            </div>
            <div className="preset-list">
              {presetRules.map((preset) => (
                <button
                  key={preset.id}
                  className={`preset-item ${selectedPreset === preset.id ? 'active' : ''}`}
                  onClick={() => applyPreset(preset.id)}
                >
                  <span>{preset.name}</span>
                  <small>{preset.description}</small>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="center-pane">
          <div className="pane-heading sticky-heading">
            <div>
              <h2>规则流水线</h2>
              <p>从上到下执行，每一步都能关掉或调整顺序</p>
            </div>
            <div className="rule-heading-tools">
              <div className="rule-actions">
                <button onClick={() => addRule('number')}>编号</button>
                <button onClick={() => addRule('date')}>日期</button>
                <button onClick={() => addRule('keyword')}>关键词</button>
                <button onClick={() => addRule('replace')}>替换</button>
                <button onClick={() => addRule('cleanup')}>清理</button>
                <button onClick={() => addRule('misoperationCleanup')}>误操作恢复</button>
              </div>
              <label className="check-row global-rule-option">
                <input
                  type="checkbox"
                  checked={keepOriginalName}
                  onChange={(event) => setKeepOriginalName(event.target.checked)}
                />
                保留原文件名字
              </label>
            </div>
          </div>

          <div className="rule-stack">
            {rules.map((rule, index) => (
              <RuleEditor
                key={rule.id}
                rule={rule}
                index={index}
                canMoveUp={index > 0}
                canMoveDown={index < rules.length - 1}
                onToggle={() => updateRule(rule.id, { enabled: !rule.enabled })}
                onMove={(direction) => moveRule(rule.id, direction)}
                onRemove={() => removeRule(rule.id)}
                onChange={(patch) => updateRule(rule.id, patch)}
              />
            ))}
          </div>

          <div className="advanced-actions">
            <button onClick={() => addRule('prefixSuffix')}>添加前后缀</button>
            <button onClick={() => addRule('case')}>大小写</button>
            <button onClick={() => addRule('extension')}>扩展名</button>
            <button onClick={importCsv}>导入 CSV 映射</button>
          </div>
        </section>

        <section className="right-pane">
          <div className="preview-toolbar">
            <div>
              <h2>预览</h2>
              <p>{isPreviewing ? '正在计算...' : `${stats.total} 项，${stats.ready} 项可执行，${stats.errors} 项需处理`}</p>
            </div>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              <option value="nameAsc">名称 A-Z</option>
              <option value="nameDesc">名称 Z-A</option>
              <option value="modifiedDesc">最近修改优先</option>
              <option value="modifiedAsc">最早修改优先</option>
            </select>
          </div>

          <div className="stat-strip">
            <Metric label="可执行" value={stats.ready} tone="green" />
            <Metric label="需处理" value={stats.errors} tone="red" />
            <Metric label="跳过" value={stats.skipped} tone="gray" />
            <Metric label="不变" value={stats.unchanged} tone="gray" />
          </div>

          <PreviewTable previews={previews} />

          {lastResult ? (
            <div className="result-bar">
              最近执行：成功 {lastResult.items.filter((item) => item.success).length} 项，失败或跳过 {lastResult.items.filter((item) => !item.success).length} 项
            </div>
          ) : null}
        </section>
      </div>
    </main>
  )
}

interface RuleEditorProps {
  rule: RenameRule
  index: number
  canMoveUp: boolean
  canMoveDown: boolean
  onToggle: () => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
  onChange: (patch: Partial<RenameRule>) => void
}

function RuleEditor({ rule, index, canMoveUp, canMoveDown, onToggle, onMove, onRemove, onChange }: RuleEditorProps) {
  return (
    <article className={`rule-item ${rule.enabled ? '' : 'disabled'}`}>
      <div className="rule-meta">
        <span className="rule-index">{String(index + 1).padStart(2, '0')}</span>
        <div>
          <h3>{getRuleTitle(rule)}</h3>
          <p>{getRuleDescription(rule)}</p>
        </div>
      </div>

      <div className="rule-controls">
        {renderRuleFields(rule, onChange)}
      </div>

      <div className="rule-buttons">
        <button onClick={onToggle}>{rule.enabled ? '关闭' : '开启'}</button>
        <button onClick={() => onMove(-1)} disabled={!canMoveUp}>上移</button>
        <button onClick={() => onMove(1)} disabled={!canMoveDown}>下移</button>
        <button onClick={onRemove}>删除</button>
      </div>
    </article>
  )
}

function renderRuleFields(rule: RenameRule, onChange: (patch: Partial<RenameRule>) => void) {
  if (rule.type === 'number') {
    const current = rule as NumberRule
    return (
      <>
        <NumberField label="起始" value={current.start} onChange={(start) => onChange({ start } as Partial<NumberRule>)} />
        <NumberField label="步长" value={current.step} onChange={(step) => onChange({ step } as Partial<NumberRule>)} />
        <NumberField label="补零" value={current.pad} onChange={(pad) => onChange({ pad } as Partial<NumberRule>)} />
        <SelectField label="位置" value={current.position} onChange={(position) => onChange({ position } as Partial<NumberRule>)} options={[['prefix', '前面'], ['suffix', '后面']]} />
      </>
    )
  }

  if (rule.type === 'date') {
    const current = rule as DateRule
    return (
      <>
        <SelectField label="日期来源" value={current.source} onChange={(source) => onChange({ source } as Partial<DateRule>)} options={[['now', '今天'], ['createdAt', '创建时间'], ['modifiedAt', '修改时间']]} />
        <SelectField label="格式" value={current.format} onChange={(format) => onChange({ format } as Partial<DateRule>)} options={[['YYYY-MM-DD', '2026-04-20'], ['YYYYMMDD', '20260420'], ['YYYY_MM_DD', '2026_04_20']]} />
        <SelectField label="位置" value={current.position} onChange={(position) => onChange({ position } as Partial<DateRule>)} options={[['prefix', '前面'], ['suffix', '后面']]} />
      </>
    )
  }

  if (rule.type === 'keyword') {
    const current = rule as KeywordRule
    return (
      <>
        <SelectField label="动作" value={current.mode} onChange={(mode) => onChange({ mode } as Partial<KeywordRule>)} options={[['insert', '插入'], ['replace', '替换'], ['remove', '删除'], ['filter', '筛选']]} />
        <TextField label="关键词" value={current.keyword} onChange={(keyword) => onChange({ keyword } as Partial<KeywordRule>)} />
        {current.mode === 'replace' ? <TextField label="替换为" value={current.replacement} onChange={(replacement) => onChange({ replacement } as Partial<KeywordRule>)} /> : null}
        {current.mode === 'insert' ? <SelectField label="位置" value={current.position} onChange={(position) => onChange({ position } as Partial<KeywordRule>)} options={[['prefix', '前面'], ['suffix', '后面']]} /> : null}
      </>
    )
  }

  if (rule.type === 'replace') {
    const current = rule as ReplaceRule
    return (
      <>
        <TextField label="查找" value={current.search} onChange={(search) => onChange({ search } as Partial<ReplaceRule>)} />
        <TextField label="替换为" value={current.replacement} onChange={(replacement) => onChange({ replacement } as Partial<ReplaceRule>)} />
        <CheckField label="正则" checked={current.useRegex} onChange={(useRegex) => onChange({ useRegex } as Partial<ReplaceRule>)} />
        <CheckField label="区分大小写" checked={current.caseSensitive} onChange={(caseSensitive) => onChange({ caseSensitive } as Partial<ReplaceRule>)} />
      </>
    )
  }

  if (rule.type === 'cleanup') {
    const current = rule as CleanupRule
    return (
      <>
        <CheckField label="去首尾空格" checked={current.trim} onChange={(trim) => onChange({ trim } as Partial<CleanupRule>)} />
        <CheckField label="合并空格" checked={current.collapseSpaces} onChange={(collapseSpaces) => onChange({ collapseSpaces } as Partial<CleanupRule>)} />
        <CheckField label="去非法字符" checked={current.removeIllegal} onChange={(removeIllegal) => onChange({ removeIllegal } as Partial<CleanupRule>)} />
        <CheckField label="统一括号" checked={current.normalizeBrackets} onChange={(normalizeBrackets) => onChange({ normalizeBrackets } as Partial<CleanupRule>)} />
      </>
    )
  }

  if (rule.type === 'prefixSuffix') {
    const current = rule as PrefixSuffixRule
    return (
      <>
        <TextField label="前缀" value={current.prefix} onChange={(prefix) => onChange({ prefix } as Partial<PrefixSuffixRule>)} />
        <TextField label="后缀" value={current.suffix} onChange={(suffix) => onChange({ suffix } as Partial<PrefixSuffixRule>)} />
      </>
    )
  }

  if (rule.type === 'case') {
    return <SelectField label="模式" value={rule.mode} onChange={(mode) => onChange({ mode } as Partial<ExtensionRule>)} options={[['lower', '小写'], ['upper', '大写'], ['title', '标题式']]} />
  }

  if (rule.type === 'extension') {
    const current = rule as ExtensionRule
    return (
      <>
        <SelectField label="扩展名" value={current.mode} onChange={(mode) => onChange({ mode } as Partial<ExtensionRule>)} options={[['preserve', '保留'], ['lower', '小写'], ['upper', '大写'], ['replace', '替换']]} />
        {current.mode === 'replace' ? <TextField label="新扩展名" value={current.value} onChange={(value) => onChange({ value } as Partial<ExtensionRule>)} /> : null}
      </>
    )
  }

  if (rule.type === 'misoperationCleanup') {
    return <span className="mapping-count">只处理文件名开头的关键词、编号、日期和分隔符</span>
  }

  return <span className="mapping-count">CSV 映射 {Object.keys(rule.mappings).length} 条</span>
}

function PreviewTable({ previews }: { previews: RenamePreview[] }) {
  if (previews.length === 0) {
    return (
      <div className="empty-preview">
        <strong>等待文件</strong>
        <span>导入后会在这里看到改名前后对照。</span>
      </div>
    )
  }

  return (
    <div className="preview-table">
      <div className="preview-table-grid">
        <span className="preview-cell preview-heading">状态</span>
        <span className="preview-cell preview-heading">原文件名</span>
        <span className="preview-cell preview-heading">新文件名</span>
        {previews.map((preview) => (
          <Fragment key={preview.id}>
            <span className={`preview-cell preview-status-cell ${preview.status}`}>
              <span className="status-pill">{getStatusLabel(preview.status)}</span>
            </span>
            <span className={`preview-cell file-name ${preview.status}`} title={preview.originalPath}>{preview.originalName}</span>
            <span className={`preview-cell file-name target ${preview.status}`} title={preview.message}>{preview.targetName}</span>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'green' | 'red' | 'gray' }) {
  return (
    <div className={`metric ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      {label}
      <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<[T, string]>
  onChange: (value: T) => void
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  )
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="check-field">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

function createRule(type: RenameRule['type']): RenameRule {
  if (type === 'number') return { id: makeRuleId('number'), type, enabled: true, start: 1, step: 1, pad: 3, position: 'prefix', separator: '_' }
  if (type === 'date') return { id: makeRuleId('date'), type, enabled: true, source: 'now', format: 'YYYY-MM-DD', position: 'prefix', separator: '_' }
  if (type === 'keyword') return { id: makeRuleId('keyword'), type, enabled: true, mode: 'insert', keyword: '关键词', replacement: '', position: 'prefix', separator: '_' }
  if (type === 'replace') return { id: makeRuleId('replace'), type, enabled: true, search: '', replacement: '', useRegex: false, caseSensitive: false }
  if (type === 'cleanup') return { id: makeRuleId('cleanup'), type, enabled: true, trim: true, collapseSpaces: true, removeIllegal: true, normalizeBrackets: true }
  if (type === 'prefixSuffix') return { id: makeRuleId('prefix'), type, enabled: true, prefix: '', suffix: '' }
  if (type === 'case') return { id: makeRuleId('case'), type, enabled: true, mode: 'lower' }
  if (type === 'extension') return { id: makeRuleId('extension'), type, enabled: true, mode: 'lower', value: '' }
  if (type === 'misoperationCleanup') return { id: makeRuleId('recover'), type, enabled: true }
  return { id: makeRuleId('csv'), type: 'csvMap', enabled: true, mappings: {}, matchBy: 'name' }
}

function getRuleTitle(rule: RenameRule): string {
  const titles: Record<RenameRule['type'], string> = {
    number: '自动编号',
    date: '日期标记',
    keyword: '关键词',
    replace: '查找替换',
    cleanup: '清理文件名',
    prefixSuffix: '前后缀',
    case: '大小写',
    extension: '扩展名',
    csvMap: 'CSV 映射',
    misoperationCleanup: '误操作恢复',
  }
  return titles[rule.type]
}

function getRuleDescription(rule: RenameRule): string {
  if (rule.type === 'number') return `按当前排序生成 ${String(rule.start).padStart(rule.pad, '0')}、${String(rule.start + rule.step).padStart(rule.pad, '0')}`
  if (rule.type === 'date') return `使用${rule.source === 'now' ? '今天' : rule.source === 'createdAt' ? '创建时间' : '修改时间'}，格式 ${rule.format}`
  if (rule.type === 'keyword') return rule.mode === 'insert' ? `插入“${rule.keyword}”` : `${rule.mode === 'replace' ? '替换' : rule.mode === 'remove' ? '删除' : '筛选'}“${rule.keyword}”`
  if (rule.type === 'replace') return rule.useRegex ? '高级正则替换' : '普通文本替换'
  if (rule.type === 'cleanup') return '清掉多余空格、非法字符和混用括号'
  if (rule.type === 'prefixSuffix') return '固定文字加在文件名前后'
  if (rule.type === 'case') return '统一英文大小写'
  if (rule.type === 'extension') return '只处理文件扩展名'
  if (rule.type === 'misoperationCleanup') return '保守移除开头关键词、编号、日期和分隔符'
  return '按表格中的原文件名和新文件名一一对应'
}

function selectedPathsAreScannedFiles(paths: string[], scanned: FileItem[]): boolean {
  if (paths.length === 0 || paths.length !== scanned.length) return false
  const pathKeys = new Set(paths.map(normalizeUiPathKey))
  return scanned.every((item) => item.kind === 'file' && pathKeys.has(normalizeUiPathKey(item.path)))
}

function normalizeUiPathKey(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
}

function getStatusLabel(status: RenamePreview['status']): string {
  if (status === 'ready') return '可执行'
  if (status === 'warning') return '注意'
  if (status === 'error') return '需处理'
  if (status === 'skipped') return '跳过'
  return '不变'
}

function getPlatformLabel(platform: DesktopPlatform): string {
  if (platform === 'macos') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return 'Windows'
}

function createSampleFiles(): FileItem[] {
  const now = new Date().toISOString()
  return ['截图 2026-04-20 (1).png', '截图 2026-04-20 (2).png', '合同 草稿 .pdf', 'SKU 主图 01.JPG'].map((name, index) => {
    const dot = name.lastIndexOf('.')
    return {
      id: `sample-${index}`,
      path: `E:\\示例\\${name}`,
      parentDir: 'E:\\示例',
      name,
      baseName: dot > 0 ? name.slice(0, dot) : name,
      extension: dot > 0 ? name.slice(dot) : '',
      kind: 'file',
      size: 1024 + index,
      createdAt: now,
      modifiedAt: now,
    }
  })
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default App
