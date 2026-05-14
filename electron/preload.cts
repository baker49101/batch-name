import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopPlatform, RenameExecutionResult, RenameJob, RenamePreview, UndoResult } from '../src/shared/types.js' with { 'resolution-mode': 'import' }

const api = {
  chooseFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:choose-files'),
  chooseFolders: (): Promise<string[]> => ipcRenderer.invoke('dialog:choose-folders'),
  chooseCsv: (): Promise<{ filePath: string; content: string } | null> => ipcRenderer.invoke('dialog:choose-csv'),
  scanPaths: (paths: string[], recursive: boolean) => ipcRenderer.invoke('files:scan-paths', paths, recursive),
  previewRename: (job: RenameJob): Promise<RenamePreview[]> => ipcRenderer.invoke('rename:preview', job),
  executeRename: (job: RenameJob): Promise<RenameExecutionResult> => ipcRenderer.invoke('rename:execute', job),
  undoLastRename: (): Promise<UndoResult | null> => ipcRenderer.invoke('rename:undo-last'),
  getPlatform: (): Promise<DesktopPlatform> => ipcRenderer.invoke('app:get-platform'),
  readRecentRules: () => ipcRenderer.invoke('settings:read-recent-rules'),
  saveRecentRules: (rules: RenameJob['rules']) => ipcRenderer.invoke('settings:save-recent-rules', rules),
}

contextBridge.exposeInMainWorld('renameTool', api)
