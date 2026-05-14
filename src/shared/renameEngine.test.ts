import { describe, expect, it } from 'vitest'
import { buildRenamePreviews } from './renameEngine'
import type { FileItem, RenameJob, RenameRule } from './types'

const now = '2026-04-20T03:00:00.000Z'

function file(name: string, index = 0): FileItem {
  const dot = name.lastIndexOf('.')
  return {
    id: `file-${index}`,
    path: `E:\\测试\\${name}`,
    parentDir: 'E:\\测试',
    name,
    baseName: dot > 0 ? name.slice(0, dot) : name,
    extension: dot > 0 ? name.slice(dot) : '',
    kind: 'file',
    size: 100,
    createdAt: now,
    modifiedAt: now,
  }
}

function job(files: FileItem[], rules: RenameRule[]): RenameJob {
  return {
    files,
    rules,
    filters: {
      includeFiles: true,
      includeDirectories: false,
      recursive: true,
      extensions: [],
      keyword: '',
    },
    sortMode: 'nameAsc',
  }
}

describe('buildRenamePreviews', () => {
  it('按排序添加补零编号并保留扩展名', () => {
    const previews = buildRenamePreviews(
      job([file('b.txt', 1), file('a.txt', 2)], [
        {
          id: 'number',
          type: 'number',
          enabled: true,
          start: 1,
          step: 1,
          pad: 3,
          position: 'prefix',
          separator: '_',
        },
      ]),
    )

    expect(previews.map((preview) => preview.targetName)).toEqual(['001_a.txt', '002_b.txt'])
    expect(previews.every((preview) => preview.willRename)).toBe(true)
  })

  it('组合日期、关键词和清理规则', () => {
    const previews = buildRenamePreviews(
      job([file(' 合同（草稿）?.pdf ')], [
        {
          id: 'date',
          type: 'date',
          enabled: true,
          source: 'modifiedAt',
          format: 'YYYY_MM_DD',
          position: 'prefix',
          separator: '_',
        },
        {
          id: 'keyword',
          type: 'keyword',
          enabled: true,
          mode: 'insert',
          keyword: '发票',
          replacement: '',
          position: 'prefix',
          separator: '_',
        },
        {
          id: 'cleanup',
          type: 'cleanup',
          enabled: true,
          trim: true,
          collapseSpaces: true,
          removeIllegal: true,
          normalizeBrackets: true,
        },
      ]),
    )

    expect(previews[0].targetName).toBe('发票_2026_04_20_合同(草稿).pdf')
    expect(previews[0].status).toBe('ready')
  })

  it('检测重复目标名并阻止执行', () => {
    const previews = buildRenamePreviews(
      job([file('a.txt', 1), file('b.txt', 2)], [
        {
          id: 'replace',
          type: 'replace',
          enabled: true,
          search: '[ab]',
          replacement: 'same',
          useRegex: true,
          caseSensitive: false,
        },
      ]),
    )

    expect(previews.every((preview) => preview.status === 'error')).toBe(true)
    expect(previews.every((preview) => !preview.willRename)).toBe(true)
  })

  it('CSV 映射可以直接指定新文件名', () => {
    const previews = buildRenamePreviews(
      job([file('old-name.jpg')], [
        {
          id: 'csv',
          type: 'csvMap',
          enabled: true,
          mappings: {
            'old-name.jpg': 'new-name.png',
          },
          matchBy: 'name',
        },
      ]),
    )

    expect(previews[0].targetName).toBe('new-name.png')
  })

  it('默认仍按 Windows 规则阻止不合法文件名', () => {
    const previews = buildRenamePreviews(
      job([file('old-name.txt')], [
        {
          id: 'csv',
          type: 'csvMap',
          enabled: true,
          mappings: {
            'old-name.txt': 'CON?.txt',
          },
          matchBy: 'name',
        },
      ]),
    )

    expect(previews[0].status).toBe('error')
    expect(previews[0].willRename).toBe(false)
  })

  it('macOS 规则允许 Windows 特有保留名但阻止路径分隔符', () => {
    const macFile: FileItem = {
      ...file('old-name.txt'),
      path: '/Users/me/Desktop/old-name.txt',
      parentDir: '/Users/me/Desktop',
    }
    const macJob = job([macFile], [
      {
        id: 'csv',
        type: 'csvMap',
        enabled: true,
        mappings: {
          'old-name.txt': 'CON?.txt',
        },
        matchBy: 'name',
      },
    ])

    const previews = buildRenamePreviews({ ...macJob, platform: 'macos' })
    expect(previews[0].status).toBe('ready')
    expect(previews[0].targetPath).toBe('/Users/me/Desktop/CON?.txt')

    const blocked = buildRenamePreviews({
      ...macJob,
      platform: 'macos',
      rules: [
        {
          id: 'prefix',
          type: 'prefixSuffix',
          enabled: true,
          prefix: 'bad/',
          suffix: '',
        },
      ],
    })
    expect(blocked[0].status).toBe('error')
    expect(blocked[0].message).toContain('macOS')
  })
})
