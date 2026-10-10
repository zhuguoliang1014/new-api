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
import type { ImageRecord } from '../types'

const HISTORY_LIMIT = 30

async function openHistory(ownerId: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`new-api-image-studio-${ownerId}`, 1)
    let blocked = false
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore('works', { keyPath: 'id' })
    })
    request.addEventListener('success', () => {
      if (blocked) {
        request.result.close()
        return
      }
      resolve(request.result)
    })
    request.addEventListener('error', () => reject(request.error))
    request.addEventListener('blocked', () => {
      blocked = true
      reject(new Error('Image history is unavailable'))
    })
  })
}

export async function readImageHistory(
  ownerId: number
): Promise<ImageRecord[]> {
  const db = await openHistory(ownerId)
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('works', 'readonly')
      const request = transaction.objectStore('works').getAll()
      transaction.addEventListener('complete', () => {
        const records = request.result as ImageRecord[]
        resolve(
          records
            .filter((record) => record.ownerId === ownerId)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, HISTORY_LIMIT)
        )
      })
      transaction.addEventListener('error', () => reject(transaction.error))
      transaction.addEventListener('abort', () => reject(transaction.error))
    })
  } finally {
    db.close()
  }
}

export async function saveImageRecord(record: ImageRecord): Promise<void> {
  const db = await openHistory(record.ownerId)
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('works', 'readwrite')
      const store = transaction.objectStore('works')
      store.put(record)
      // Bound disk use atomically, including records from other open tabs.
      const request = store.getAll()
      request.addEventListener('success', () => {
        const records = (request.result as ImageRecord[]).sort(
          (a, b) => b.createdAt - a.createdAt
        )
        for (const old of records.slice(HISTORY_LIMIT)) store.delete(old.id)
      })
      transaction.addEventListener('complete', () => resolve())
      transaction.addEventListener('error', () => reject(transaction.error))
      transaction.addEventListener('abort', () => reject(transaction.error))
    })
  } finally {
    db.close()
  }
}

export async function deleteImageRecord(
  ownerId: number,
  id: string
): Promise<void> {
  const db = await openHistory(ownerId)
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('works', 'readwrite')
      transaction.objectStore('works').delete(id)
      transaction.addEventListener('complete', () => resolve())
      transaction.addEventListener('error', () => reject(transaction.error))
      transaction.addEventListener('abort', () => reject(transaction.error))
    })
  } finally {
    db.close()
  }
}
