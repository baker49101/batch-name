export type FileKind = 'file' | 'directory'
export type DesktopPlatform = 'windows' | 'macos' | 'linux' | 'unknown'

export interface FileItem {
  id: string
  path: string
  parentDir: string
  name: string
  baseName: string
  extension: string
  kind: FileKind
  size: number
  createdAt: string
  modifiedAt: string
}

export type SortMode = 'nameAsc' | 'nameDesc' | 'modifiedAsc' | 'modifiedDesc'

export interface RenameFilters {
  includeFiles: boolean
  includeDirectories: boolean
  recursive: boolean
  extensions: string[]
  keyword: string
}

export interface NumberRule {
  id: string
  type: 'number'
  enabled: boolean
  start: number
  step: number
  pad: number
  position: 'prefix' | 'suffix'
  separator: string
}

export interface DateRule {
  id: string
  type: 'date'
  enabled: boolean
  source: 'now' | 'createdAt' | 'modifiedAt'
  format: 'YYYY-MM-DD' | 'YYYYMMDD' | 'YYYY_MM_DD'
  position: 'prefix' | 'suffix'
  separator: string
}

export interface KeywordRule {
  id: string
  type: 'keyword'
  enabled: boolean
  mode: 'insert' | 'replace' | 'remove' | 'filter'
  keyword: string
  replacement: string
  position: 'prefix' | 'suffix'
  separator: string
}

export interface ReplaceRule {
  id: string
  type: 'replace'
  enabled: boolean
  search: string
  replacement: string
  useRegex: boolean
  caseSensitive: boolean
}

export interface CleanupRule {
  id: string
  type: 'cleanup'
  enabled: boolean
  trim: boolean
  collapseSpaces: boolean
  removeIllegal: boolean
  normalizeBrackets: boolean
}

export interface PrefixSuffixRule {
  id: string
  type: 'prefixSuffix'
  enabled: boolean
  prefix: string
  suffix: string
}

export interface CaseRule {
  id: string
  type: 'case'
  enabled: boolean
  mode: 'lower' | 'upper' | 'title'
}

export interface ExtensionRule {
  id: string
  type: 'extension'
  enabled: boolean
  mode: 'preserve' | 'lower' | 'upper' | 'replace'
  value: string
}

export interface CsvMapRule {
  id: string
  type: 'csvMap'
  enabled: boolean
  mappings: Record<string, string>
  matchBy: 'name' | 'baseName'
}

export type RenameRule =
  | NumberRule
  | DateRule
  | KeywordRule
  | ReplaceRule
  | CleanupRule
  | PrefixSuffixRule
  | CaseRule
  | ExtensionRule
  | CsvMapRule

export interface RenameJob {
  files: FileItem[]
  rules: RenameRule[]
  filters: RenameFilters
  sortMode: SortMode
  existingPaths?: string[]
  platform?: DesktopPlatform
}

export type PreviewStatus = 'ready' | 'unchanged' | 'skipped' | 'warning' | 'error'

export interface RenamePreview {
  id: string
  originalPath: string
  targetPath: string
  originalName: string
  targetName: string
  status: PreviewStatus
  willRename: boolean
  message: string
  warnings: string[]
  item: FileItem
}

export interface RenameResultItem extends RenamePreview {
  success: boolean
  error?: string
}

export interface RenameExecutionResult {
  batchId: string
  executedAt: string
  items: RenameResultItem[]
}

export interface UndoEntry {
  id: string
  originalPath: string
  targetPath: string
  originalName: string
  targetName: string
  success: boolean
}

export interface UndoRecord {
  batchId: string
  executedAt: string
  entries: UndoEntry[]
}

export interface UndoResult {
  batchId: string
  items: Array<UndoEntry & { restored: boolean; error?: string }>
}

export interface RenamePreset {
  id: string
  name: string
  audience: string
  description: string
  rules: RenameRule[]
}
