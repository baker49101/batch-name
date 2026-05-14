import type { DesktopPlatform, FileItem, RenameExecutionResult, RenameJob, RenamePreview, RenameRule, UndoResult } from './shared/types'

export interface RenameToolApi {
  chooseFiles: () => Promise<string[]>
  chooseFolders: () => Promise<string[]>
  chooseCsv: () => Promise<{ filePath: string; content: string } | null>
  scanPaths: (paths: string[], recursive: boolean) => Promise<FileItem[]>
  previewRename: (job: RenameJob) => Promise<RenamePreview[]>
  executeRename: (job: RenameJob) => Promise<RenameExecutionResult>
  undoLastRename: () => Promise<UndoResult | null>
  getPlatform: () => Promise<DesktopPlatform>
  readRecentRules: () => Promise<RenameRule[]>
  saveRecentRules: (rules: RenameRule[]) => Promise<boolean>
  onPathsDropped?: (handler: (paths: string[]) => void) => Promise<() => void>
}

declare global {
  interface Window {
    renameTool?: RenameToolApi
  }
}

export {}
