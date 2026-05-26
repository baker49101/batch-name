import type { RenamePreset, RenameRule } from './types.js'

export function createRuleId(prefix: string, index: number): string {
  return `${prefix}-${index}`
}

export const presetRules: RenamePreset[] = [
  {
    id: 'office',
    name: '行政资料整理',
    audience: '行政、办公室',
    description: '日期在前，自动编号，清理空格和非法字符。',
    rules: [
      {
        id: createRuleId('office-date', 1),
        type: 'date',
        enabled: true,
        source: 'modifiedAt',
        format: 'YYYY-MM-DD',
        position: 'prefix',
        separator: '_',
      },
      {
        id: createRuleId('office-number', 2),
        type: 'number',
        enabled: true,
        start: 1,
        step: 1,
        pad: 3,
        position: 'suffix',
        separator: '_',
      },
      {
        id: createRuleId('office-cleanup', 3),
        type: 'cleanup',
        enabled: true,
        trim: true,
        collapseSpaces: true,
        removeIllegal: true,
        normalizeBrackets: true,
      },
    ],
  },
  {
    id: 'ecommerce',
    name: '电商 SKU 整理',
    audience: '淘宝、拼多多、抖店商家',
    description: '添加 SKU 前缀，编号补齐，统一扩展名大小写。',
    rules: [
      {
        id: createRuleId('sku-keyword', 1),
        type: 'keyword',
        enabled: true,
        mode: 'insert',
        keyword: 'SKU',
        replacement: '',
        position: 'prefix',
        separator: '-',
      },
      {
        id: createRuleId('sku-number', 2),
        type: 'number',
        enabled: true,
        start: 1,
        step: 1,
        pad: 4,
        position: 'suffix',
        separator: '-',
      },
      {
        id: createRuleId('sku-ext', 3),
        type: 'extension',
        enabled: true,
        mode: 'lower',
        value: '',
      },
    ],
  },
  {
    id: 'media',
    name: '自媒体素材整理',
    audience: '小红书、抖音、视频运营',
    description: '按今天日期和素材关键词归档，截图素材也能快速统一。',
    rules: [
      {
        id: createRuleId('media-keyword', 1),
        type: 'keyword',
        enabled: true,
        mode: 'insert',
        keyword: '素材',
        replacement: '',
        position: 'prefix',
        separator: '_',
      },
      {
        id: createRuleId('media-date', 2),
        type: 'date',
        enabled: true,
        source: 'now',
        format: 'YYYYMMDD',
        position: 'prefix',
        separator: '_',
      },
      {
        id: createRuleId('media-cleanup', 3),
        type: 'cleanup',
        enabled: true,
        trim: true,
        collapseSpaces: true,
        removeIllegal: true,
        normalizeBrackets: false,
      },
    ],
  },
  {
    id: 'invoice',
    name: '发票合同归档',
    audience: '财务、中小企业',
    description: '关键词在前，日期在后，便于按类型和时间检索。',
    rules: [
      {
        id: createRuleId('invoice-keyword', 1),
        type: 'keyword',
        enabled: true,
        mode: 'insert',
        keyword: '发票',
        replacement: '',
        position: 'prefix',
        separator: '_',
      },
      {
        id: createRuleId('invoice-date', 2),
        type: 'date',
        enabled: true,
        source: 'modifiedAt',
        format: 'YYYY_MM_DD',
        position: 'suffix',
        separator: '_',
      },
      {
        id: createRuleId('invoice-cleanup', 3),
        type: 'cleanup',
        enabled: true,
        trim: true,
        collapseSpaces: true,
        removeIllegal: true,
        normalizeBrackets: true,
      },
    ],
  },
]

export function cloneRules(rules: RenameRule[]): RenameRule[] {
  return structuredClone(rules)
}

export function suggestPreset(files: Array<{ name: string; extension: string }>): string {
  if (files.length === 0) return 'office'

  const names = files.map((file) => file.name.toLowerCase())
  const extensions = files.map((file) => file.extension.toLowerCase())

  if (names.some((name) => /截图|screenshot|img_|dsc|素材|剪映/.test(name))) return 'media'
  if (names.some((name) => /sku|商品|宝贝|主图|详情/.test(name)) || extensions.some((ext) => ['.jpg', '.jpeg', '.png', '.webp'].includes(ext))) {
    return 'ecommerce'
  }
  if (names.some((name) => /发票|合同|invoice|contract/.test(name))) return 'invoice'
  return 'office'
}
