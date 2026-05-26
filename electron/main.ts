import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildRenamePreviews, normalizePathKey, splitFileName } from '../src/shared/renameEngine.js'
import type {
  FileItem,
  DesktopPlatform,
  RenameExecutionResult,
  RenameJob,
  RenamePreview,
  RenameResultItem,
  RenameRule,
  UndoRecord,
  UndoResult,
} from '../src/shared/types.js'

const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? getArgValue('--renderer-url')
let mainWindow: BrowserWindow | null = null
const mainDir = typeof __dirname === 'string' ? __dirname : process.cwd()

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1060,
    minHeight: 720,
    title: '快捷批量重命名',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(mainDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl)
  } else {
    await mainWindow.loadFile(path.join(mainDir, '../dist/index.html'))
  }
}

app.whenReady().then(async () => {
  registerIpcHandlers()
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerIpcHandlers(): void {
  ipcMain.handle('dialog:choose-files', async () => {
    const result = await showOpenDialog({
      title: '选择要重命名的文件',
      properties: ['openFile', 'multiSelections'],
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('dialog:choose-folders', async () => {
    const result = await showOpenDialog({
      title: '选择要扫描的文件夹',
      properties: ['openDirectory', 'multiSelections'],
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('dialog:choose-csv', async () => {
    const result = await showOpenDialog({
      title: '选择 CSV 映射表',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      properties: ['openFile'],
    })

    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const content = await fs.readFile(filePath, 'utf8')
    return { filePath, content }
  })

  ipcMain.handle('files:scan-paths', async (_event, paths: string[], recursive: boolean) => scanPaths(paths, recursive))
  ipcMain.handle('rename:preview', async (_event, job: RenameJob) => withFilesystemConflicts(job))
  ipcMain.handle('rename:execute', async (_event, job: RenameJob) => executeRename(job))
  ipcMain.handle('rename:undo-last', async () => undoLastRename())
  ipcMain.handle('app:get-platform', async () => getDesktopPlatform())
  ipcMain.handle('settings:read-recent-rules', async () => readJson<RenameRule[]>(recentRulesPath(), []))
  ipcMain.handle('settings:save-recent-rules', async (_event, rules: RenameRule[]) => {
    await ensureUserDataDir()
    await fs.writeFile(recentRulesPath(), JSON.stringify(rules, null, 2), 'utf8')
    return true
  })
}

export async function scanPaths(inputPaths: string[], recursive: boolean): Promise<FileItem[]> {
  const results: FileItem[] = []
  const seen = new Set<string>()

  for (const inputPath of inputPaths) {
    await collectPath(inputPath, recursive, results, seen)
  }

  return results
}

export async function executeRename(job: RenameJob): Promise<RenameExecutionResult> {
  const previews = await withFilesystemConflicts(job)
  const batchId = `batch-${Date.now()}`
  const executedAt = new Date().toISOString()
  const items: RenameResultItem[] = []

  for (const preview of previews) {
    if (!preview.willRename || (preview.status !== 'ready' && preview.status !== 'warning')) {
      items.push({ ...preview, success: false, error: preview.message })
      continue
    }

    try {
      await renameSafely(preview.originalPath, preview.targetPath)
      items.push({ ...preview, success: true })
    } catch (error) {
      items.push({ ...preview, success: false, error: getErrorMessage(error) })
    }
  }

  const record: UndoRecord = {
    batchId,
    executedAt,
    entries: items.map((item) => ({
      id: item.id,
      originalPath: item.originalPath,
      targetPath: item.targetPath,
      originalName: item.originalName,
      targetName: item.targetName,
      success: item.success,
    })),
  }

  if (record.entries.some((entry) => entry.success)) {
    await appendUndoRecord(record)
  }
  return { batchId, executedAt, items }
}

export async function undoLastRename(): Promise<UndoResult | null> {
  const history = await readUndoHistory()
  const record = history.pop()
  if (!record) return null

  const items: UndoResult['items'] = []
  const successfulEntries = record.entries.filter((entry) => entry.success).reverse()

  for (const entry of successfulEntries) {
    try {
      await renameSafely(entry.targetPath, entry.originalPath)
      items.push({ ...entry, restored: true })
    } catch (error) {
      items.push({ ...entry, restored: false, error: getErrorMessage(error) })
    }
  }

  await writeUndoHistory(history)
  return { batchId: record.batchId, items }
}

async function collectPath(inputPath: string, recursive: boolean, results: FileItem[], seen: Set<string>): Promise<void> {
  const stat = await fs.stat(inputPath)
  const normalized = normalizePathKey(inputPath)
  if (seen.has(normalized)) return
  seen.add(normalized)

  if (stat.isDirectory()) {
    const children = await fs.readdir(inputPath)
    if (children.length === 0) {
      results.push(createFileItem(inputPath, stat, 'directory'))
      return
    }

    for (const child of children) {
      const childPath = path.join(inputPath, child)
      const childStat = await fs.stat(childPath)
      if (childStat.isDirectory()) {
        results.push(createFileItem(childPath, childStat, 'directory'))
        if (recursive) await collectPath(childPath, recursive, results, seen)
      } else {
        results.push(createFileItem(childPath, childStat, 'file'))
      }
    }
    return
  }

  results.push(createFileItem(inputPath, stat, 'file'))
}

function createFileItem(filePath: string, stat: Awaited<ReturnType<typeof fs.stat>>, kind: FileItem['kind']): FileItem {
  const name = path.basename(filePath)
  const split = splitFileName(name)

  return {
    id: pathToFileURL(filePath).href,
    path: filePath,
    parentDir: path.dirname(filePath),
    name,
    baseName: kind === 'directory' ? name : split.baseName,
    extension: kind === 'directory' ? '' : split.extension,
    kind,
    size: Number(stat.size),
    createdAt: stat.birthtime.toISOString(),
    modifiedAt: stat.mtime.toISOString(),
  }
}

async function withFilesystemConflicts(job: RenameJob): Promise<RenamePreview[]> {
  const previews = buildRenamePreviews({
    ...job,
    existingPaths: job.existingPaths ?? job.files.map((file) => file.path),
  })

  const checked: RenamePreview[] = []
  for (const preview of previews) {
    if (!preview.willRename || preview.status === 'error') {
      checked.push(preview)
      continue
    }

    const originalKey = normalizePathKey(preview.originalPath)
    const targetKey = normalizePathKey(preview.targetPath)
    if (originalKey !== targetKey && (await exists(preview.targetPath))) {
      checked.push({
        ...preview,
        status: 'error',
        willRename: false,
        message: '磁盘上已经存在同名文件，已阻止覆盖。',
      })
      continue
    }

    checked.push(preview)
  }

  return checked
}

async function renameSafely(originalPath: string, targetPath: string): Promise<void> {
  const originalKey = normalizePathKey(originalPath)
  const targetKey = normalizePathKey(targetPath)
  if (originalPath === targetPath) return

  if (originalKey === targetKey) {
    const tempPath = path.join(path.dirname(originalPath), `.__rename_tmp_${Date.now()}_${path.basename(originalPath)}`)
    await fs.rename(originalPath, tempPath)
    await fs.rename(tempPath, targetPath)
    return
  }

  await fs.rename(originalPath, targetPath)
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function ensureUserDataDir(): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, 'utf8')
    return JSON.parse(content) as T
  } catch {
    return fallback
  }
}

async function appendUndoRecord(record: UndoRecord): Promise<void> {
  const history = await readUndoHistory()
  history.push(record)
  await writeUndoHistory(history)
}

async function readUndoHistory(): Promise<UndoRecord[]> {
  const value = await readJson<unknown>(undoRecordPath(), [])
  if (Array.isArray(value)) return value.filter(isUndoRecord)
  return isUndoRecord(value) ? [value] : []
}

async function writeUndoHistory(history: UndoRecord[]): Promise<void> {
  await ensureUserDataDir()
  await fs.writeFile(undoRecordPath(), JSON.stringify(history.slice(-100), null, 2), 'utf8')
}

function isUndoRecord(value: unknown): value is UndoRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<UndoRecord>
  return typeof record.batchId === 'string' && typeof record.executedAt === 'string' && Array.isArray(record.entries)
}

function undoRecordPath(): string {
  return path.join(app.getPath('userData'), 'last-undo.json')
}

function recentRulesPath(): string {
  return path.join(app.getPath('userData'), 'recent-rules.json')
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function showOpenDialog(options: OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  if (mainWindow) return dialog.showOpenDialog(mainWindow, options)
  return dialog.showOpenDialog(options)
}

function getArgValue(name: string): string | undefined {
  const prefix = `${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function getDesktopPlatform(): DesktopPlatform {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'linux') return 'linux'
  return 'unknown'
}
