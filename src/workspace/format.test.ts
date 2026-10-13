import { describe, expect, it } from 'vitest'
import { calendarDaysUntil, caseInitials, greeting, inDays, initials, timeAgo } from './format'

const now = new Date('2026-10-10T09:00:00')

describe('workspace formatting', () => {
  it('greets by time of day', () => {
    expect(greeting(new Date('2026-10-10T08:00:00'))).toBe('Good morning')
    expect(greeting(new Date('2026-10-10T13:00:00'))).toBe('Good afternoon')
    expect(greeting(new Date('2026-10-10T20:00:00'))).toBe('Good evening')
  })

  it('counts calendar days, not 24-hour periods', () => {
    expect(calendarDaysUntil(new Date('2026-10-10T23:59:00'), now)).toBe(0)
    expect(calendarDaysUntil(new Date('2026-10-11T00:01:00'), now)).toBe(1)
    expect(calendarDaysUntil(new Date('2026-10-13T23:59:00'), now)).toBe(3)
    expect([0, 1, 3].map(inDays)).toEqual(['today', 'tomorrow', 'in 3 days'])
  })

  it('describes how long ago something happened', () => {
    expect(timeAgo('2026-10-10T08:59:40', now)).toBe('Just now')
    expect(timeAgo('2026-10-10T08:18:00', now)).toBe('42 minutes ago')
    expect(timeAgo('2026-10-10T07:00:00', now)).toBe('2 hours ago')
    expect(timeAgo('2026-10-09T07:00:00', now)).toBe('Yesterday')
    expect(timeAgo('2026-10-03T07:00:00', now)).toMatch(/Oct 3/)
  })

  it('makes initials for people and cases', () => {
    expect(initials('Alex Morgan')).toBe('AM')
    expect(initials('Ana María de la Cruz')).toBe('AC')
    expect(initials('Cher')).toBe('C')
    expect(caseInitials('Anderson v. Caldwell')).toBe('AC')
    expect(caseInitials('State v Hale')).toBe('SH')
    expect(caseInitials('In re Marriage of Lopez')).toBe('IL')
  })
})
