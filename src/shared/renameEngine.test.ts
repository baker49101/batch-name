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

function job(files: FileItem[], rules: RenameRule[], overrides: Partial<RenameJob> = {}): RenameJob {
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
    ...overrides,
  }
}

describe('buildRenamePreviews', () => {
  it('自动编号会替换原文件基础名并保留扩展名', () => {
    const previews = buildRenamePreviews(
      job([file('新建文档1.txt')], [
        {
          id: 'number',
          type: 'number',
          enabled: true,
          start: 1,
          step: 1,
          pad: 3,
          position: 'prefix',
          separator: '',
        },
      ]),
    )

    expect(previews[0].targetName).toBe('001.txt')
    expect(previews[0].willRename).toBe(true)
  })

  it('全局保留原文件名时自动编号会添加到原文件基础名', () => {
    const previews = buildRenamePreviews(
      job([file('新建文档1.txt')], [
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
      ], { keepOriginalName: true }),
    )

    expect(previews[0].targetName).toBe('001_新建文档1.txt')
    expect(previews[0].willRename).toBe(true)
  })

  it('日期规则默认生成新文件基础名而不是添加到原名', () => {
    const previews = buildRenamePreviews(
      job([file('新建文档1.txt')], [
        {
          id: 'date',
          type: 'date',
          enabled: true,
          source: 'modifiedAt',
          format: 'YYYY_MM_DD',
          position: 'prefix',
          separator: '_',
        },
      ]),
    )

    expect(previews[0].targetName).toBe('2026_04_20.txt')
  })

  it('全局保留原文件名时日期和关键词会添加到原文件基础名', () => {
    const previews = buildRenamePreviews(
      job([file('合同（草稿）.pdf')], [
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
      ], { keepOriginalName: true }),
    )

    expect(previews[0].targetName).toBe('2026_04_20_发票_合同（草稿）.pdf')
  })

  it('按排序生成补零编号并保留扩展名', () => {
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

    expect(previews.map((preview) => preview.targetName)).toEqual(['001.txt', '002.txt'])
    expect(previews.every((preview) => preview.willRename)).toBe(true)
  })

  it('多个前置生成型规则会按规则顺序从左到右组合成新文件基础名', () => {
    const previews = buildRenamePreviews(
      job([file('新建文档1.txt')], [
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

    expect(previews[0].targetName).toBe('2026_04_20_001.txt')
  })

  it('保留原名时前置编号、关键词会按规则顺序排在原文件名前面', () => {
    const previews = buildRenamePreviews(
      job([file('样本1.xlsx')], [
        {
          id: 'number',
          type: 'number',
          enabled: true,
          start: 1,
          step: 1,
          pad: 3,
          position: 'prefix',
          separator: '-',
        },
        {
          id: 'sku',
          type: 'keyword',
          enabled: true,
          mode: 'insert',
          keyword: 'SKU',
          replacement: '',
          position: 'prefix',
          separator: '_',
        },
        {
          id: 'material',
          type: 'keyword',
          enabled: true,
          mode: 'insert',
          keyword: '素材',
          replacement: '',
          position: 'prefix',
          separator: '_',
        },
      ], { keepOriginalName: true }),
    )

    expect(previews[0].targetName).toBe('001-SKU_素材_样本1.xlsx')
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
      ], { keepOriginalName: true }),
    )

    expect(previews[0].targetName).toBe('2026_04_20_发票_合同(草稿).pdf')
    expect(previews[0].status).toBe('ready')
  })

  it('误操作恢复会保守移除开头连续编号日期并保留后面的可读名称', () => {
    const previews = buildRenamePreviews(
      job([file('001_2026-05-16_002_2026-05-16_合同.pdf')], [
        {
          id: 'recover',
          type: 'misoperationCleanup',
          enabled: true,
        },
      ]),
    )

    expect(previews[0].targetName).toBe('合同.pdf')
    expect(previews[0].willRename).toBe(true)
  })

  it('误操作恢复会移除重复叠加的关键词和编号前缀', () => {
    const previews = buildRenamePreviews(
      job([file('素材_SKU-001-素材_SKU-001-素材_SKU-001-素材_SKU-001-样本1.xlsx')], [
        {
          id: 'recover',
          type: 'misoperationCleanup',
          enabled: true,
        },
      ]),
    )

    expect(previews[0].targetName).toBe('样本1.xlsx')
    expect(previews[0].willRename).toBe(true)
  })

  it('误操作恢复会识别手动添加的关键词编号日期前缀', () => {
    const previews = buildRenamePreviews(
      job([file('SKU_001_20010101_样本1.xlsx')], [
        {
          id: 'recover',
          type: 'misoperationCleanup',
          enabled: true,
        },
      ]),
    )

    expect(previews[0].targetName).toBe('样本1.xlsx')
    expect(previews[0].willRename).toBe(true)
  })

  it('误操作恢复只清理开头污染片段，不删除中间和结尾的日期', () => {
    const previews = buildRenamePreviews(
      job([file('001_2026_04_20_合同_2026-05-16.pdf')], [
        {
          id: 'recover',
          type: 'misoperationCleanup',
          enabled: true,
        },
      ]),
    )

    expect(previews[0].targetName).toBe('合同_2026-05-16.pdf')
  })

  it('误操作恢复在没有可读剩余名称时不会改名', () => {
    const previews = buildRenamePreviews(
      job([file('001_2026-05-16.pdf')], [
        {
          id: 'recover',
          type: 'misoperationCleanup',
          enabled: true,
        },
      ]),
    )

    expect(previews[0].targetName).toBe('001_2026-05-16.pdf')
    expect(previews[0].status).toBe('unchanged')
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
