import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenameJob, RenameRule } from '../src/shared/types'

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'quick-batch-renamer-test-user-data'),
    isPackaged: true,
    whenReady: () => new Promise(() => undefined),
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
  },
}))

const { executeRename, scanPaths, undoLastRename } = await import('./main')

let tempDir = ''

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rename-tool-'))
})

afterEach(async () => {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true })
})

describe('electron file operations', () => {
  it('扫描临时目录、执行改名并撤销', async () => {
    const first = path.join(tempDir, '合同 A.txt')
    const second = path.join(tempDir, '合同 B.txt')
    await fs.writeFile(first, 'a', 'utf8')
    await fs.writeFile(second, 'b', 'utf8')

    const files = await scanPaths([tempDir], false)
    const rules: RenameRule[] = [
      {
        id: 'number',
        type: 'number',
        enabled: true,
        start: 1,
        step: 1,
        pad: 2,
        position: 'prefix',
        separator: '_',
      },
    ]

    const job: RenameJob = {
      files,
      rules,
      filters: {
        includeFiles: true,
        includeDirectories: false,
        recursive: false,
        extensions: [],
        keyword: '',
      },
      sortMode: 'nameAsc',
    }

    const result = await executeRename(job)
    expect(result.items.filter((item) => item.success)).toHaveLength(2)
    await expect(fs.stat(path.join(tempDir, '01_合同 A.txt'))).resolves.toBeTruthy()
    await expect(fs.stat(path.join(tempDir, '02_合同 B.txt'))).resolves.toBeTruthy()

    const undo = await undoLastRename()
    expect(undo?.items.filter((item) => item.restored)).toHaveLength(2)
    await expect(fs.stat(first)).resolves.toBeTruthy()
    await expect(fs.stat(second)).resolves.toBeTruthy()
  })
})
