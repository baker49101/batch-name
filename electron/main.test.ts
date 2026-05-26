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
const userDataDir = path.join(os.tmpdir(), 'quick-batch-renamer-test-user-data')

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rename-tool-'))
  await fs.rm(userDataDir, { recursive: true, force: true })
})

afterEach(async () => {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true })
  await fs.rm(userDataDir, { recursive: true, force: true })
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
      keepOriginalName: true,
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

  it('默认执行编号改名时替换原文件基础名', async () => {
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

    const result = await executeRename({
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
    })

    expect(result.items.filter((item) => item.success)).toHaveLength(2)
    await expect(fs.stat(path.join(tempDir, '01.txt'))).resolves.toBeTruthy()
    await expect(fs.stat(path.join(tempDir, '02.txt'))).resolves.toBeTruthy()
  })

  it('可以按批次连续撤销到上一次改名前状态', async () => {
    const original = path.join(tempDir, '原文件.txt')
    await fs.writeFile(original, 'content', 'utf8')

    const firstFiles = await scanPaths([original], false)
    await executeRename({
      files: firstFiles,
      rules: [
        {
          id: 'number-1',
          type: 'number',
          enabled: true,
          start: 1,
          step: 1,
          pad: 2,
          position: 'prefix',
          separator: '_',
        },
      ],
      filters: {
        includeFiles: true,
        includeDirectories: false,
        recursive: false,
        extensions: [],
        keyword: '',
      },
      sortMode: 'nameAsc',
    })

    const firstTarget = path.join(tempDir, '01.txt')
    await expect(fs.stat(firstTarget)).resolves.toBeTruthy()

    const secondFiles = await scanPaths([firstTarget], false)
    await executeRename({
      files: secondFiles,
      rules: [
        {
          id: 'number-2',
          type: 'number',
          enabled: true,
          start: 2,
          step: 1,
          pad: 2,
          position: 'prefix',
          separator: '_',
        },
      ],
      filters: {
        includeFiles: true,
        includeDirectories: false,
        recursive: false,
        extensions: [],
        keyword: '',
      },
      sortMode: 'nameAsc',
    })

    const secondTarget = path.join(tempDir, '02.txt')
    await expect(fs.stat(secondTarget)).resolves.toBeTruthy()

    const undoSecond = await undoLastRename()
    expect(undoSecond?.items.filter((item) => item.restored)).toHaveLength(1)
    await expect(fs.stat(firstTarget)).resolves.toBeTruthy()

    const undoFirst = await undoLastRename()
    expect(undoFirst?.items.filter((item) => item.restored)).toHaveLength(1)
    await expect(fs.stat(original)).resolves.toBeTruthy()

    await expect(undoLastRename()).resolves.toBeNull()
  })

})
