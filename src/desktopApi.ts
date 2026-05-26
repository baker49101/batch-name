import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open } from '@tauri-apps/plugin-dialog'
import { buildRenamePreviews, normalizePathKey } from './shared/renameEngine'
import type { RenameToolApi } from './electron-api'
import type { DesktopPlatform, RenameExecutionResult, RenameJob, RenamePreview, RenameRule, UndoResult } from './shared/types'

function normalizeSelection(selection: string | string[] | null): string[] {
  if (!selection) return []
  return Array.isArray(selection) ? selection : [selection]
}

async function readCsvWithTauri(): Promise<{ filePath: string; content: string } | null> {
  const selected = await open({
    title: '选择 CSV 映射表',
    multiple: false,
    directory: false,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  const [filePath] = normalizeSelection(selected)
  if (!filePath) return null
  const content = await invoke<string>('read_text_file', { path: filePath })
  return { filePath, content }
}

async function previewWithTauri(job: RenameJob): Promise<RenamePreview[]> {
  const previews = buildRenamePreviews({
    ...job,
    existingPaths: job.existingPaths ?? job.files.map((file) => file.path),
  })

  return Promise.all(
    previews.map(async (preview) => {
      if (!preview.willRename || preview.status === 'error') return preview

      const originalKey = normalizePathKey(preview.originalPath)
      const targetKey = normalizePathKey(preview.targetPath)
      if (originalKey !== targetKey && (await invoke<boolean>('path_exists', { path: preview.targetPath }))) {
        return {
          ...preview,
          status: 'error',
          willRename: false,
          message: '磁盘上已经存在同名文件，已阻止覆盖。',
        } satisfies RenamePreview
      }

      return preview
    }),
  )
}

const tauriApi: RenameToolApi = {
  chooseFiles: async () =>
    normalizeSelection(
      await open({
        title: '选择要重命名的文件',
        multiple: true,
        directory: false,
      }),
    ),
  chooseFolders: async () =>
    normalizeSelection(
      await open({
        title: '选择要扫描的文件夹',
        multiple: true,
        directory: true,
      }),
    ),
  chooseCsv: readCsvWithTauri,
  scanPaths: (paths: string[], recursive: boolean) => invoke('scan_paths', { paths, recursive }),
  previewRename: previewWithTauri,
  executeRename: async (job: RenameJob): Promise<RenameExecutionResult> => {
    const previews = await previewWithTauri(job)
    return invoke('execute_rename_previews', { previews })
  },
  undoLastRename: (): Promise<UndoResult | null> => invoke('undo_last_rename'),
  getPlatform: (): Promise<DesktopPlatform> => invoke('get_platform'),
  readRecentRules: (): Promise<RenameRule[]> => invoke('read_recent_rules'),
  saveRecentRules: (rules: RenameRule[]): Promise<boolean> => invoke('save_recent_rules', { rules }),
  onPathsDropped: async (handler: (paths: string[]) => void) => {
    const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') handler(event.payload.paths)
    })
    return unlisten
  },
}

const browserRenameTool = typeof window === 'undefined' ? undefined : window.renameTool

export const desktopApi: RenameToolApi | undefined = browserRenameTool ?? (isTauri() ? tauriApi : undefined)
export const hasDesktopApi = Boolean(desktopApi)
