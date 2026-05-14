export interface CsvMappingResult {
  mappings: Record<string, string>
  errors: string[]
  totalRows: number
}

export function parseCsvMappings(content: string): CsvMappingResult {
  const rows = parseCsv(content)
  const mappings: Record<string, string> = {}
  const errors: string[] = []

  if (rows.length === 0) {
    return { mappings, errors: ['CSV 内容为空。'], totalRows: 0 }
  }

  const header = rows[0].map((cell) => cell.trim().toLowerCase())
  const originalIndex = findColumn(header, ['原文件名', 'original', 'old', 'oldname', 'source'])
  const targetIndex = findColumn(header, ['新文件名', 'new', 'newname', 'target'])

  if (originalIndex === -1 || targetIndex === -1) {
    return {
      mappings,
      errors: ['CSV 需要包含“原文件名”和“新文件名”两列。'],
      totalRows: Math.max(0, rows.length - 1),
    }
  }

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]
    const original = (row[originalIndex] ?? '').trim()
    const target = (row[targetIndex] ?? '').trim()

    if (!original && !target) continue
    if (!original || !target) {
      errors.push(`第 ${rowIndex + 1} 行缺少原文件名或新文件名。`)
      continue
    }
    if (mappings[original]) {
      errors.push(`第 ${rowIndex + 1} 行重复映射：${original}`)
      continue
    }

    mappings[original] = target
  }

  return { mappings, errors, totalRows: Math.max(0, rows.length - 1) }
}

export function parseCsv(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const next = content[index + 1]

    if (char === '"' && inQuotes && next === '"') {
      cell += '"'
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  row.push(cell)
  if (row.some((value) => value.length > 0)) rows.push(row)
  return rows
}

function findColumn(header: string[], candidates: string[]): number {
  return header.findIndex((cell) => candidates.includes(cell.replace(/\s+/g, '')))
}
