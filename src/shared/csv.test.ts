import { describe, expect, it } from 'vitest'
import { parseCsvMappings } from './csv'

describe('parseCsvMappings', () => {
  it('解析中文表头和带逗号的引号字段', () => {
    const result = parseCsvMappings('原文件名,新文件名\n"旧,文件.txt","新,文件.txt"\n合同.pdf,归档合同.pdf')

    expect(result.mappings['旧,文件.txt']).toBe('新,文件.txt')
    expect(result.mappings['合同.pdf']).toBe('归档合同.pdf')
    expect(result.errors).toEqual([])
  })

  it('报告缺少字段和重复映射', () => {
    const result = parseCsvMappings('原文件名,新文件名\na.txt,\na.txt,b.txt\na.txt,c.txt')

    expect(result.mappings['a.txt']).toBe('b.txt')
    expect(result.errors).toHaveLength(2)
  })
})
