/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
/** Reviewed built-in poses suitable for the public character workspace. */
const availablePoseIds = new Set([
  'full_single_P001',
  'full_single_P002',
  'full_single_P004',
  'full_single_P005',
  'full_single_P006',
  'full_single_P007',
  'full_single_P008',
  'full_single_P009',
  'full_single_P010',
  'full_single_P012',
  'full_single_P015',
  'full_single_P016',
  'full_single_P017',
  'full_single_P018',
  'full_single_P019',
  'full_single_P020',
  'full_single_P021',
  'full_single_P024',
  'full_single_P025',
  'full_single_P027',
  'full_single_P029',
  'full_single_P030',
  'full_single_P031',
  'full_single_P032',
  'full_single_P033',
  'full_single_P035',
  'full_single_P036',
  'full_single_P037',
  'full_single_P038',
  'full_single_P041',
  'full_single_P042',
  'full_single_P044',
  'full_single_P045',
  'full_single_P046',
  'full_single_P047',
  'full_single_P048',
  'full_single_P061',
  'full_single_P062',
  'full_single_P063',
  'full_single_P064',
  'full_single_P066',
  'full_single_P067',
  'full_single_P068',
  'full_single_P069',
  'full_single_P071',
  'full_single_P073',
  'full_single_P075',
  'full_single_P077',
  'full_single_P078',
  'full_single_P079',
  'upper80v2_P001',
  'upper80v2_P002',
  'upper80v2_P003',
  'upper80v2_P004',
  'upper80v2_P005',
  'upper80v2_P006',
  'upper80v2_P007',
  'upper80v2_P008',
  'upper80v2_P009',
  'upper80v2_P010',
  'upper80v2_P011',
  'upper80v2_P013',
  'upper80v2_P014',
  'upper80v2_P015',
  'upper80v2_P016',
  'upper80v2_P018',
  'upper80v2_P019',
  'upper80v2_P020',
  'upper80v2_P021',
  'upper80v2_P022',
  'upper80v2_P023',
  'upper80v2_P025',
])

export function isRetiredPoseId(id?: string): boolean {
  return Boolean(
    id &&
    /^(?:full_sexy_|full_single_|upper80v2_|pair60_)/.test(id) &&
    !availablePoseIds.has(id)
  )
}

export function withoutRetiredPoses<T extends { assetId?: string }>(
  references: T[]
): T[] {
  return references.filter((reference) => !isRetiredPoseId(reference.assetId))
}
