import type {
  CaseRule,
  CleanupRule,
  CsvMapRule,
  DateRule,
  DesktopPlatform,
  ExtensionRule,
  FileItem,
  KeywordRule,
  NumberRule,
  PrefixSuffixRule,
  RenameJob,
  RenamePreview,
  RenameRule,
  ReplaceRule,
  SortMode,
} from './types.js'

const WINDOWS_ILLEGAL_CHARS = /[<>:"/\\|?*]/g
const MACOS_ILLEGAL_CHARS = /[/:]/g
const POSIX_ILLEGAL_CHARS = /\//g
const WINDOWS_RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
])
const EMPTY_RESERVED_NAMES = new Set<string>()

interface FileSystemProfile {
  illegalChars: RegExp
  illegalMessage: string
  reservedNames: Set<string>
  reservedMessage: string
  trimTrailingDots: boolean
  blockTrailingSpaceOrDot: boolean
  pathLengthLimit?: number
  pathLengthMessage?: string
}

const FILE_SYSTEM_PROFILES: Record<DesktopPlatform, FileSystemProfile> = {
  windows: {
    illegalChars: WINDOWS_ILLEGAL_CHARS,
    illegalMessage: '目标文件名包含 Windows 不允许的字符。',
    reservedNames: WINDOWS_RESERVED_NAMES,
    reservedMessage: '目标文件名使用了 Windows 保留名称。',
    trimTrailingDots: true,
    blockTrailingSpaceOrDot: true,
    pathLengthLimit: 240,
    pathLengthMessage: '目标路径超过 240 个字符，Windows 下容易失败。',
  },
  macos: {
    illegalChars: MACOS_ILLEGAL_CHARS,
    illegalMessage: '目标文件名包含 macOS 不允许的字符。',
    reservedNames: EMPTY_RESERVED_NAMES,
    reservedMessage: '',
    trimTrailingDots: false,
    blockTrailingSpaceOrDot: false,
  },
  linux: {
    illegalChars: POSIX_ILLEGAL_CHARS,
    illegalMessage: '目标文件名包含 Linux 不允许的字符。',
    reservedNames: EMPTY_RESERVED_NAMES,
    reservedMessage: '',
    trimTrailingDots: false,
    blockTrailingSpaceOrDot: false,
  },
  unknown: {
    illegalChars: WINDOWS_ILLEGAL_CHARS,
    illegalMessage: '目标文件名包含 Windows 不允许的字符。',
    reservedNames: WINDOWS_RESERVED_NAMES,
    reservedMessage: '目标文件名使用了 Windows 保留名称。',
    trimTrailingDots: true,
    blockTrailingSpaceOrDot: true,
    pathLengthLimit: 240,
    pathLengthMessage: '目标路径超过 240 个字符，Windows 下容易失败。',
  },
}

interface RenameDraft {
  baseName: string
  extension: string
  skipped: boolean
  skipMessage: string
}

export const defaultFilters = {
  includeFiles: true,
  includeDirectories: false,
  recursive: true,
  extensions: [],
  keyword: '',
}

export function buildRenamePreviews(job: RenameJob): RenamePreview[] {
  const platform = job.platform ?? 'windows'
  const profile = getFileSystemProfile(platform)
  const sortedFiles = sortFiles(job.files, job.sortMode)
  const existingPathKeys = new Set((job.existingPaths ?? job.files.map((file) => file.path)).map(normalizePathKey))

  const previews = sortedFiles.map((item, index) => {
    const filterMessage = getFilterSkipReason(item, job)
    if (filterMessage) {
      return makePreview(item, item.name, item.path, 'skipped', filterMessage, [], false)
    }

    const draft = applyRules(item, job.rules, index, platform)
    const targetName = composeName(draft.baseName, draft.extension, item.kind)
    const targetPath = joinPath(item.parentDir, targetName)
    const warnings: string[] = []

    if (draft.skipped) {
      return makePreview(item, targetName, targetPath, 'skipped', draft.skipMessage, warnings, false)
    }

    const validationMessage = validateTargetName(targetName, platform)
    if (validationMessage) {
      return makePreview(item, targetName, targetPath, 'error', validationMessage, warnings, false)
    }

    if (profile.pathLengthLimit && targetPath.length > profile.pathLengthLimit) {
      return makePreview(item, targetName, targetPath, 'error', profile.pathLengthMessage ?? '目标路径过长。', warnings, false)
    }

    const originalKey = normalizePathKey(item.path)
    const targetKey = normalizePathKey(targetPath)
    const exactSamePath = item.path === targetPath
    const caseOnlyChange = originalKey === targetKey && !exactSamePath

    if (existingPathKeys.has(targetKey) && originalKey !== targetKey) {
      return makePreview(item, targetName, targetPath, 'error', '目标文件名已经存在，已阻止覆盖。', warnings, false)
    }

    if (caseOnlyChange) {
      warnings.push('仅大小写变化，执行时会使用临时名称安全过渡。')
    }

    if (exactSamePath) {
      return makePreview(item, targetName, targetPath, 'unchanged', '文件名没有变化。', warnings, false)
    }

    return makePreview(
      item,
      targetName,
      targetPath,
      caseOnlyChange ? 'warning' : 'ready',
      caseOnlyChange ? '可以执行，但需要大小写安全过渡。' : '可以安全改名。',
      warnings,
      true,
    )
  })

  return markDuplicateTargets(previews)
}

export function sortFiles(files: FileItem[], sortMode: SortMode): FileItem[] {
  return [...files].sort((left, right) => {
    if (sortMode === 'nameDesc') return right.name.localeCompare(left.name, 'zh-Hans-CN')
    if (sortMode === 'modifiedAsc') return left.modifiedAt.localeCompare(right.modifiedAt)
    if (sortMode === 'modifiedDesc') return right.modifiedAt.localeCompare(left.modifiedAt)
    return left.name.localeCompare(right.name, 'zh-Hans-CN')
  })
}

export function applyRules(
  item: FileItem,
  rules: RenameRule[],
  index: number,
  platform: DesktopPlatform = 'windows',
): RenameDraft {
  const draft: RenameDraft = {
    baseName: item.baseName,
    extension: item.extension,
    skipped: false,
    skipMessage: '',
  }

  for (const rule of rules) {
    if (!rule.enabled || draft.skipped) continue

    switch (rule.type) {
      case 'number':
        applyNumberRule(draft, rule, index)
        break
      case 'date':
        applyDateRule(draft, rule, item)
        break
      case 'keyword':
        applyKeywordRule(draft, rule)
        break
      case 'replace':
        applyReplaceRule(draft, rule)
        break
      case 'cleanup':
        applyCleanupRule(draft, rule, platform)
        break
      case 'prefixSuffix':
        applyPrefixSuffixRule(draft, rule)
        break
      case 'case':
        applyCaseRule(draft, rule)
        break
      case 'extension':
        applyExtensionRule(draft, rule, item.kind)
        break
      case 'csvMap':
        applyCsvMapRule(draft, rule, item)
        break
      default:
        break
    }
  }

  return draft
}

export function sanitizeWindowsName(value: string): string {
  return sanitizeFileName(value, 'windows')
}

export function sanitizeFileName(value: string, platform: DesktopPlatform = 'windows'): string {
  const profile = getFileSystemProfile(platform)
  profile.illegalChars.lastIndex = 0
  const sanitized = Array.from(value.replace(profile.illegalChars, ''))
    .filter((char) => char.charCodeAt(0) >= 32)
    .join('')
    .trim()
  return profile.blockTrailingSpaceOrDot ? sanitized.replace(/[. ]+$/g, '') : sanitized
}

export function validateTargetName(name: string, platform: DesktopPlatform = 'windows'): string {
  const profile = getFileSystemProfile(platform)
  if (!name.trim()) return '目标文件名不能为空。'
  profile.illegalChars.lastIndex = 0
  if (profile.illegalChars.test(name) || hasControlCharacters(name)) {
    profile.illegalChars.lastIndex = 0
    return profile.illegalMessage
  }

  const normalized = (profile.trimTrailingDots ? name.replace(/\.+$/g, '') : name).toLowerCase()
  const base = normalized.includes('.') ? normalized.slice(0, normalized.indexOf('.')) : normalized
  if (profile.reservedNames.has(base)) return profile.reservedMessage
  if (profile.blockTrailingSpaceOrDot && /[. ]$/.test(name)) return '目标文件名不能以空格或句点结尾。'
  return ''
}

export function composeName(baseName: string, extension: string, kind: FileItem['kind']): string {
  if (kind === 'directory') return baseName
  return `${baseName}${extension.trim()}`
}

export function splitFileName(name: string): { baseName: string; extension: string } {
  const normalized = name.trim().replace(/\\/g, '/')
  const lastPart = normalized.slice(normalized.lastIndexOf('/') + 1)
  const dotIndex = lastPart.lastIndexOf('.')
  const hasUsableExtension = dotIndex > 0 && dotIndex < lastPart.length - 1

  return {
    baseName: hasUsableExtension ? lastPart.slice(0, dotIndex) : lastPart,
    extension: hasUsableExtension ? lastPart.slice(dotIndex) : '',
  }
}

export function makeRuleId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

export function normalizePathKey(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
}

function joinPath(parentDir: string, name: string): string {
  const separator = parentDir.includes('\\') ? '\\' : '/'
  const trimmedParent = parentDir.replace(/[\\/]+$/g, '')
  return `${trimmedParent}${separator}${name}`
}

function getFilterSkipReason(item: FileItem, job: RenameJob): string {
  if (item.kind === 'file' && !job.filters.includeFiles) return '当前筛选设置跳过文件。'
  if (item.kind === 'directory' && !job.filters.includeDirectories) return '当前筛选设置跳过文件夹。'

  const extensions = job.filters.extensions.map((ext) => normalizeExtension(ext)).filter(Boolean)
  if (item.kind === 'file' && extensions.length > 0 && !extensions.includes(normalizeExtension(item.extension))) {
    return '扩展名不在当前筛选范围内。'
  }

  const keyword = job.filters.keyword.trim().toLowerCase()
  if (keyword && !item.name.toLowerCase().includes(keyword)) {
    return '文件名不包含筛选关键词。'
  }

  return ''
}

function makePreview(
  item: FileItem,
  targetName: string,
  targetPath: string,
  status: RenamePreview['status'],
  message: string,
  warnings: string[],
  willRename: boolean,
): RenamePreview {
  return {
    id: item.id,
    originalPath: item.path,
    targetPath,
    originalName: item.name,
    targetName,
    status,
    willRename,
    message,
    warnings,
    item,
  }
}

function markDuplicateTargets(previews: RenamePreview[]): RenamePreview[] {
  const targetCounts = new Map<string, number>()
  for (const preview of previews) {
    if (!preview.willRename) continue
    const key = normalizePathKey(preview.targetPath)
    targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1)
  }

  return previews.map((preview) => {
    if (!preview.willRename) return preview
    const key = normalizePathKey(preview.targetPath)
    if ((targetCounts.get(key) ?? 0) <= 1) return preview
    return {
      ...preview,
      status: 'error',
      willRename: false,
      message: '多个文件会改成同一个名称，已阻止执行。',
    }
  })
}

function applyNumberRule(draft: RenameDraft, rule: NumberRule, index: number): void {
  const value = String(rule.start + index * rule.step).padStart(Math.max(1, rule.pad), '0')
  const token = joinToken(value, rule.separator, rule.position)
  draft.baseName = rule.position === 'prefix' ? `${token}${draft.baseName}` : `${draft.baseName}${token}`
}

function applyDateRule(draft: RenameDraft, rule: DateRule, item: FileItem): void {
  const source = rule.source === 'createdAt' ? item.createdAt : rule.source === 'modifiedAt' ? item.modifiedAt : new Date().toISOString()
  const value = formatDate(new Date(source), rule.format)
  const token = joinToken(value, rule.separator, rule.position)
  draft.baseName = rule.position === 'prefix' ? `${token}${draft.baseName}` : `${draft.baseName}${token}`
}

function applyKeywordRule(draft: RenameDraft, rule: KeywordRule): void {
  const keyword = rule.keyword.trim()
  if (!keyword) return

  if (rule.mode === 'filter') {
    if (!draft.baseName.toLowerCase().includes(keyword.toLowerCase())) {
      draft.skipped = true
      draft.skipMessage = '不包含关键词，已按规则跳过。'
    }
    return
  }

  if (rule.mode === 'remove') {
    draft.baseName = draft.baseName.split(keyword).join('')
    return
  }

  if (rule.mode === 'replace') {
    draft.baseName = draft.baseName.split(keyword).join(rule.replacement)
    return
  }

  const token = joinToken(keyword, rule.separator, rule.position)
  draft.baseName = rule.position === 'prefix' ? `${token}${draft.baseName}` : `${draft.baseName}${token}`
}

function applyReplaceRule(draft: RenameDraft, rule: ReplaceRule): void {
  if (!rule.search) return
  if (!rule.useRegex) {
    const source = rule.caseSensitive ? draft.baseName : draft.baseName.toLowerCase()
    const needle = rule.caseSensitive ? rule.search : rule.search.toLowerCase()
    let cursor = 0
    let result = ''
    while (true) {
      const found = source.indexOf(needle, cursor)
      if (found === -1) break
      result += draft.baseName.slice(cursor, found) + rule.replacement
      cursor = found + rule.search.length
    }
    draft.baseName = result + draft.baseName.slice(cursor)
    return
  }

  try {
    const flags = rule.caseSensitive ? 'g' : 'gi'
    draft.baseName = draft.baseName.replace(new RegExp(rule.search, flags), rule.replacement)
  } catch {
    draft.skipped = true
    draft.skipMessage = '正则表达式无效，已跳过。'
  }
}

function applyCleanupRule(draft: RenameDraft, rule: CleanupRule, platform: DesktopPlatform): void {
  if (rule.normalizeBrackets) {
    draft.baseName = draft.baseName.replace(/[（]/g, '(').replace(/[）]/g, ')')
  }
  if (rule.removeIllegal) {
    draft.baseName = sanitizeFileName(draft.baseName, platform)
  }
  if (rule.collapseSpaces) {
    draft.baseName = draft.baseName.replace(/\s+/g, ' ')
  }
  draft.baseName = draft.baseName.replace(/([_-])\s+/g, '$1').replace(/\s+([_-])/g, '$1')
  if (rule.trim) {
    draft.baseName = draft.baseName.trim()
  }
}

function applyPrefixSuffixRule(draft: RenameDraft, rule: PrefixSuffixRule): void {
  draft.baseName = `${rule.prefix}${draft.baseName}${rule.suffix}`
}

function applyCaseRule(draft: RenameDraft, rule: CaseRule): void {
  if (rule.mode === 'lower') draft.baseName = draft.baseName.toLowerCase()
  if (rule.mode === 'upper') draft.baseName = draft.baseName.toUpperCase()
  if (rule.mode === 'title') {
    draft.baseName = draft.baseName.replace(/(^|[\s_-])(\S)/g, (match) => match.toUpperCase())
  }
}

function applyExtensionRule(draft: RenameDraft, rule: ExtensionRule, kind: FileItem['kind']): void {
  if (kind === 'directory' || rule.mode === 'preserve') return
  if (rule.mode === 'lower') draft.extension = draft.extension.toLowerCase()
  if (rule.mode === 'upper') draft.extension = draft.extension.toUpperCase()
  if (rule.mode === 'replace') draft.extension = normalizeExtension(rule.value)
}

function applyCsvMapRule(draft: RenameDraft, rule: CsvMapRule, item: FileItem): void {
  const key = rule.matchBy === 'baseName' ? item.baseName : item.name
  const mapped = rule.mappings[key] ?? rule.mappings[key.trim()]
  if (!mapped) return

  const next = splitFileName(mapped.trim())
  draft.baseName = next.baseName
  if (next.extension) draft.extension = next.extension
}

function joinToken(value: string, separator: string, position: 'prefix' | 'suffix'): string {
  if (!separator) return value
  return position === 'prefix' ? `${value}${separator}` : `${separator}${value}`
}

function normalizeExtension(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.startsWith('.') ? trimmed.toLowerCase() : `.${trimmed.toLowerCase()}`
}

function formatDate(date: Date, format: DateRule['format']): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  if (format === 'YYYYMMDD') return `${year}${month}${day}`
  if (format === 'YYYY_MM_DD') return `${year}_${month}_${day}`
  return `${year}-${month}-${day}`
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((char) => char.charCodeAt(0) < 32)
}

function getFileSystemProfile(platform: DesktopPlatform): FileSystemProfile {
  return FILE_SYSTEM_PROFILES[platform] ?? FILE_SYSTEM_PROFILES.windows
}
