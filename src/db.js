import Dexie from 'dexie'

export const db = new Dexie('cofia-log')

// v1/v2 existed in older builds (roastName/bean).
// v3: new schema (Origin/Variety/Process/Altitude) + lotKey index for compare.
// NOTE: old fields may remain in existing records; this app assumes you can reset logs if needed.

db.version(1).stores({
  roasts: '++id, createdAt, updatedAt, roastName, bean',
})

db.version(2).stores({
  roasts: '++id, createdAt, updatedAt, roastName, bean, lotKey, [lotKey+updatedAt]',
})

db.version(3).stores({
  roasts: '++id, createdAt, updatedAt, originCountry, variety, process, altitudeMeters, lotKey, [lotKey+updatedAt]',
})
