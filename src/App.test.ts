import { describe, expect, it } from 'vitest'
import { getRefreshPathsAfterExecute, getRefreshPathsAfterUndo } from './shared/renameEngine'
import type { FileItem, RenameExecutionResult, UndoResult } from './shared/types'

const now = '2026-05-16T00:00:00.000Z'

function file(path: string, name: string): FileItem {
  const dot = name.lastIndexOf('.')
  return {
    id: path,
    path,
    parentDir: 'E:\\测试',
    name,
    baseName: dot > 0 ? name.slice(0, dot) : name,
    extension: dot > 0 ? name.slice(dot) : '',
    kind: 'file',
    size: 1,
    createdAt: now,
    modifiedAt: now,
  }
}

describe('selection refresh paths', () => {
  it('文件来源执行后只刷新执行结果对应文件', () => {
    const files = [file('E:\\测试\\新建文档1.txt', '新建文档1.txt')]
    const result: RenameExecutionResult = {
      batchId: 'batch-1',
      executedAt: now,
      items: [
        {
          id: 'file-1',
          originalPath: 'E:\\测试\\新建文档1.txt',
          targetPath: 'E:\\测试\\001.txt',
          originalName: '新建文档1.txt',
          targetName: '001.txt',
          status: 'ready',
          willRename: true,
          message: '可以安全改名。',
          warnings: [],
          item: files[0],
          success: true,
        },
      ],
    }

    expect(getRefreshPathsAfterExecute(files, result, 'files', ['E:\\测试\\新建文档1.txt'])).toEqual(['E:\\测试\\001.txt'])
  })

  it('文件夹来源执行后继续刷新原文件夹', () => {
    const files = [file('E:\\测试\\新建文档1.txt', '新建文档1.txt')]
    const result: RenameExecutionResult = {
      batchId: 'batch-1',
      executedAt: now,
      items: [],
    }

    expect(getRefreshPathsAfterExecute(files, result, 'folders', ['E:\\测试'])).toEqual(['E:\\测试'])
  })

  it('拖入单个文件执行后只刷新执行结果对应文件', () => {
    const files = [file('E:\\测试\\新建文档1.txt', '新建文档1.txt')]
    const result: RenameExecutionResult = {
      batchId: 'batch-1',
      executedAt: now,
      items: [
        {
          id: 'file-1',
          originalPath: 'E:\\测试\\新建文档1.txt',
          targetPath: 'E:\\测试\\001.txt',
          originalName: '新建文档1.txt',
          targetName: '001.txt',
          status: 'ready',
          willRename: true,
          message: '可以安全改名。',
          warnings: [],
          item: files[0],
          success: true,
        },
      ],
    }

    expect(getRefreshPathsAfterExecute(files, result, 'paths', ['E:\\测试\\新建文档1.txt'])).toEqual(['E:\\测试\\001.txt'])
  })

  it('文件来源撤销后只刷新恢复后的原文件', () => {
    const files = [file('E:\\测试\\001.txt', '001.txt')]
    const result: UndoResult = {
      batchId: 'batch-1',
      items: [
        {
          id: 'file-1',
          originalPath: 'E:\\测试\\新建文档1.txt',
          targetPath: 'E:\\测试\\001.txt',
          originalName: '新建文档1.txt',
          targetName: '001.txt',
          success: true,
          restored: true,
        },
      ],
    }

    expect(getRefreshPathsAfterUndo(files, result, 'files', ['E:\\测试\\新建文档1.txt'])).toEqual(['E:\\测试\\新建文档1.txt'])
  })
})
