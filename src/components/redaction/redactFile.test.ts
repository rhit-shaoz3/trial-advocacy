import { describe, expect, it } from 'vitest'
import { planPages, redactParts } from './redactFile'

const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }

describe('planPages', () => {
  it('marking what’s redacted: blacks out pages with boxes, drops pages left out, and copies the rest', () => {
    const marks = {
      mode: 'redact' as const,
      pages: [
        { page: 2, removed: false, boxes: [box] },
        { page: 3, removed: true, boxes: [] },
      ],
    }
    expect(planPages(marks, 4)).toEqual(['copy', 'black', 'drop', 'copy'])
  })

  it('marking what’s admitted: keeps only pages with a box, blacked out around it', () => {
    const marks = {
      mode: 'admit' as const,
      pages: [
        { page: 1, removed: false, boxes: [box] },
        { page: 3, removed: true, boxes: [box] },
      ],
    }
    expect(planPages(marks, 3)).toEqual(['black', 'drop', 'drop'])
  })
})

describe('redactParts', () => {
  const parts = [
    { n: 0, question: 'What did you see?', objection: null, text: 'The light was red.' },
    { n: 1, question: 'Then?', objection: null, text: 'I sent it anyway.' },
  ]

  it('blacks out what’s marked redacted, keeping the spaces around it', () => {
    const out = redactParts(parts, { mode: 'redact', parts: [{ n: 0, removed: false, ranges: [{ field: 'text', start: 4, end: 9 }] }] })
    expect(out.map((p) => p.text)).toEqual(['The █████ was red.', 'I sent it anyway.'])
  })

  it('keeps only what’s marked admitted, and drops parts with nothing marked', () => {
    const out = redactParts(parts, { mode: 'admit', parts: [{ n: 1, removed: false, ranges: [{ field: 'text', start: 0, end: 6 }] }] })
    expect(out).toEqual([{ n: 1, question: '█████', objection: null, text: 'I sent ██████████' }])
  })
})
