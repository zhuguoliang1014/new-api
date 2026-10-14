/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { parseTiersFromExpr, type ParsedTier } from './billing-expr'
import { flattenBinary, readTokenTierChain } from './billing-expression/display'
import { compileBillingExpression } from './billing-expression/parser'
import {
  evaluateBillingCondition,
  timeInBillingZone,
} from './billing-expression/runtime'
import {
  expressionDependencies,
  visitExpression,
  type CompiledBillingExpression,
} from './billing-expression/types'

export type WeeklyPricePeriod = {
  multiplier: number
  conditionText: string
}
type WeeklySchedule = {
  timezone: string
  tier: ParsedTier
  periods: WeeklyPricePeriod[]
  week: number[][]
}
const schedules = new Map<string, WeeklySchedule | null>()

/** Recognize hourly weekly factors only; other expressions retain the full breakdown. */
function readWeeklySchedule(source: string): WeeklySchedule | null {
  const compiled = compileBillingExpression(source)
  if (compiled.status !== 'ready') return null
  let tier: ParsedTier | undefined
  let timezone: string | undefined
  const rules: { compiled: CompiledBillingExpression; multiplier: number }[] =
    []
  for (const part of flattenBinary(compiled.ast, '*')) {
    const tiers = readTokenTierChain(part)
    if (tiers) {
      if (
        tier ||
        tiers.length !== 1 ||
        tiers[0].conditions.length ||
        tiers[0].billingUnit ||
        tiers[0].imageCount
      ) {
        return null
      }
      tier = parseTiersFromExpr(source.slice(part.start, part.end))[0]
      continue
    }
    if (
      part.kind !== 'conditional' ||
      part.yes.kind !== 'literal' ||
      typeof part.yes.value !== 'number' ||
      part.yes.value < 0 ||
      part.no.kind !== 'literal' ||
      part.no.value !== 1
    ) {
      return null
    }
    const dependencies = expressionDependencies(part.condition)
    if (
      dependencies.variables.size ||
      !dependencies.functions.size ||
      [...dependencies.functions].some(
        (name) => name !== 'hour' && name !== 'weekday'
      )
    ) {
      return null
    }
    const replacements: { start: number; end: number }[] = []
    let valid = true
    visitExpression(part.condition, (node) => {
      if (node.kind !== 'call') return
      const zone = node.args[0]
      if (
        zone?.kind !== 'literal' ||
        typeof zone.value !== 'string' ||
        zone.value === 'Local'
      ) {
        valid = false
        return
      }
      const normalized = zone.value.trim() || 'UTC'
      if (timezone && timezone !== normalized) valid = false
      timezone = normalized
      replacements.push({ start: zone.start, end: zone.end })
    })
    if (!valid) return null
    let condition = source.slice(part.condition.start, part.condition.end)
    // Evaluate a representative local week in UTC; no DST offset is inferred.
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
      condition = `${condition.slice(
        0,
        replacement.start - part.condition.start
      )}"UTC"${condition.slice(replacement.end - part.condition.start)}`
    }
    const weekly = compileBillingExpression(condition)
    if (weekly.status !== 'ready') return null
    rules.push({ compiled: weekly, multiplier: part.yes.value })
  }
  if (!tier || !timezone || !rules.length) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    return null
  }
  const week: number[][] = []
  for (let day = 0; day < 7; day++) {
    const hours: number[] = []
    for (let hour = 0; hour < 24; hour++) {
      let multiplier = 1
      for (const rule of rules) {
        const matched = evaluateBillingCondition(
          rule.compiled,
          rule.compiled.ast,
          new Date(Date.UTC(2026, 0, 4 + day, hour))
        )
        if (matched === null) return null
        if (matched) multiplier *= rule.multiplier
      }
      if (!Number.isFinite(multiplier)) return null
      hours.push(multiplier)
    }
    week.push(hours)
  }
  const periods: WeeklyPricePeriod[] = []
  const zone = JSON.stringify(timezone)
  for (const multiplier of [...new Set(week.flat())].sort((a, b) => a - b)) {
    const dayPatterns = week.map((hours) => {
      const intervals: string[] = []
      for (let start = 0; start < 24; ) {
        let end = start + 1
        while (end < 24 && hours[end] === hours[start]) end++
        if (hours[start] === multiplier) {
          intervals.push(
            `(hour(${zone}) >= ${start} && hour(${zone}) < ${end})`
          )
        }
        start = end
      }
      return intervals.join(' || ')
    })
    const conditions: string[] = []
    for (let start = 0; start < 7; ) {
      let end = start + 1
      while (end < 7 && dayPatterns[end] === dayPatterns[start]) end++
      if (dayPatterns[start]) {
        conditions.push(
          `(weekday(${zone}) >= ${start} && weekday(${zone}) < ${end} && (${dayPatterns[start]}))`
        )
      }
      start = end
    }
    periods.push({ multiplier, conditionText: conditions.join(' || ') })
  }
  return { timezone, tier, periods, week }
}

export function getWeeklyTimePricing(source: string, now = new Date()) {
  if (!schedules.has(source)) {
    if (schedules.size >= 64) schedules.clear()
    schedules.set(source, readWeeklySchedule(source))
  }
  const schedule = schedules.get(source)
  if (!schedule) return null
  try {
    const time = timeInBillingZone(now, schedule.timezone)
    return {
      ...schedule,
      currentMultiplier: schedule.week[time.weekday][time.hour],
    }
  } catch {
    return null
  }
}
