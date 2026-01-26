import { useEffect, useMemo, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import './LotCompareModal.css'

// App.jsx と同じキー（ここだけは一致させる）
const RADAR_AXES = [
  { key: 'sweet', label: 'Sweetness' },
  { key: 'juicy', label: 'Juiciness' },
  { key: 'floral', label: 'Floral' },
  { key: 'funk', label: 'Funk' },
  { key: 'clarity', label: 'Clarity' },
  { key: 'body', label: 'Body' },
]

function clamp0(n) {
  const v = Number(n)
  return Number.isFinite(v) ? Math.max(0, v) : 0
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function isoToHuman(iso) {
  if (!iso) return ''
  return String(iso).slice(0, 16).replace('T', ' ')
}

function formatDuration(ms) {
  const totalSec = Math.floor(clamp0(ms) / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`
  return `${m}:${pad2(s)}`
}

function findLastLapElapsedMs(laps, type) {
  if (!Array.isArray(laps)) return null
  for (let i = laps.length - 1; i >= 0; i--) {
    if (laps[i]?.type === type && Number.isFinite(laps[i]?.elapsedMs)) return laps[i].elapsedMs
  }
  return null
}

function pct(ratio) {
  if (!Number.isFinite(ratio)) return '—'
  return `${(ratio * 100).toFixed(1)}%`
}

function clampRadar(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(10, Math.max(0, Math.round(n)))
}

function buildProfile(item) {
  const timer = item?.timer && typeof item.timer === 'object' ? item.timer : null
  const laps = timer?.laps

  const oneC = findLastLapElapsedMs(laps, 'firstCrack')
  const dryEnd = findLastLapElapsedMs(laps, 'dryEnd')
  const drop = findLastLapElapsedMs(laps, 'drop')

  const totalMs = drop != null ? drop : clamp0(timer?.totalMs ?? 0)

  const devMs = oneC != null ? clamp0(totalMs - oneC) : null
  const dtr = oneC != null && totalMs > 0 ? devMs / totalMs : null

  // phases（存在しない場合は 0 扱いで崩れないように）
  const dryMs = dryEnd != null ? clamp0(dryEnd) : 0
  const maillardMs = dryEnd != null && oneC != null ? clamp0(oneC - dryEnd) : 0
  const devPhaseMs = oneC != null ? clamp0(totalMs - oneC) : 0

  const flavor = item?.flavor && typeof item.flavor === 'object' ? item.flavor : {}
  const flavorVals = RADAR_AXES.reduce((acc, ax) => {
    acc[ax.key] = clampRadar(flavor[ax.key])
    return acc
  }, {})

  const o = (item?.originCountry ?? '').trim()
  const p = (item?.process ?? '').trim()
  const v = (item?.variety ?? '').trim()
  const t = isoToHuman(item?.updatedAt)
  const labelParts = [t || `id:${item?.id}`, o, p, v].filter(Boolean)
  const label = labelParts.join(' • ')

  return {
    id: String(item?.id ?? ''),
    label,
    updatedAt: item?.updatedAt ?? '',
    originCountry: item?.originCountry ?? '',
    variety: item?.variety ?? '',
    process: item?.process ?? '',
    altitudeMeters: item?.altitudeMeters ?? '',
    lotKey: item?.lotKey ?? '',
    totalMs,
    oneC,
    dryEnd,
    devMs,
    dtr,
    phases: { dryMs, maillardMs, devPhaseMs },
    flavorVals,
    raw: item,
  }
}

function diffNumber(a, b) {
  const A = Number(a)
  const B = Number(b)
  if (!Number.isFinite(A) || !Number.isFinite(B)) return null
  return A - B
}

function DiffRow({ label, value, fmt = (v) => String(v) }) {
  const v = value
  const isNum = typeof v === 'number' && Number.isFinite(v)
  const cls = !isNum
    ? 'cofia compareDiff'
    : v > 0
      ? 'cofia compareDiff plus'
      : v < 0
        ? 'cofia compareDiff minus'
        : 'cofia compareDiff'
  const sign = isNum && v > 0 ? '+' : ''
  return (
    <div className="cofia compareRow">
      <div className="cofia compareLabel">{label}</div>
      <div className={cls}>{isNum ? `${sign}${fmt(v)}` : '—'}</div>
    </div>
  )
}

function PhaseBars({ left, right }) {
  const L = left.phases
  const R = right.phases
  const max = Math.max(L.dryMs + L.maillardMs + L.devPhaseMs, R.dryMs + R.maillardMs + R.devPhaseMs, 1)

  const w = (ms) => `${Math.max(0, Math.min(100, (clamp0(ms) / max) * 100))}%`

  const Row = ({ name, p }) => (
    <div className="cofia phaseRow">
      <div className="cofia phaseName">{name}</div>
      <div className="cofia phaseBar">
        <div className="cofia seg dry" style={{ width: w(p.dryMs) }} />
        <div className="cofia seg maillard" style={{ width: w(p.maillardMs) }} />
        <div className="cofia seg dev" style={{ width: w(p.devPhaseMs) }} />
      </div>
      <div className="cofia phaseTime">{formatDuration(p.dryMs + p.maillardMs + p.devPhaseMs)}</div>
    </div>
  )

  const diffDry = diffNumber(R.dryMs, L.dryMs)
  const diffMai = diffNumber(R.maillardMs, L.maillardMs)
  const diffDev = diffNumber(R.devPhaseMs, L.devPhaseMs)

  return (
    <div className="cofia phaseWrap">
      <Row name="L" p={L} />
      <Row name="R" p={R} />
      <div className="cofia phaseDiff">
        <div className="cofia phaseDiffTitle">差分（R - L）</div>
        <div className="cofia phaseDiffGrid">
          <DiffRow label="Dry" value={diffDry} fmt={(v) => `${Math.round(v / 1000)}s`} />
          <DiffRow label="Maillard" value={diffMai} fmt={(v) => `${Math.round(v / 1000)}s`} />
          <DiffRow label="Dev" value={diffDev} fmt={(v) => `${Math.round(v / 1000)}s`} />
        </div>
      </div>
    </div>
  )
}

function RadarCompare({ leftVals, rightVals }) {
  const size = 240
  const cx = size / 2
  const cy = size / 2
  const R = 92
  const levels = [2, 4, 6, 8, 10]
  const N = RADAR_AXES.length
  const angle0 = -Math.PI / 2

  const point = (i, v) => {
    const a = angle0 + (2 * Math.PI * i) / N
    const r = (R * clampRadar(v)) / 10
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  }

  const polygon = (vals) =>
    RADAR_AXES.map((ax, i) => point(i, vals?.[ax.key] ?? 0))
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ')

  const labelPos = (i) => {
    const a = angle0 + (2 * Math.PI * i) / N
    const r = R + 22
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  }

  return (
    <svg className="cofia compareRadarSvg" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {levels.map((lv) => {
        const pts = RADAR_AXES.map((_, i) => point(i, lv))
          .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
          .join(' ')
        return <polygon key={lv} points={pts} className="cofia compareRadarGrid" />
      })}

      {RADAR_AXES.map((ax, i) => {
        const [x, y] = point(i, 10)
        return <line key={ax.key} x1={cx} y1={cy} x2={x} y2={y} className="cofia compareRadarAxis" />
      })}

      <polygon points={polygon(leftVals)} className="cofia compareRadarPoly left" />
      <polygon points={polygon(rightVals)} className="cofia compareRadarPoly right" />

      {RADAR_AXES.map((ax, i) => {
        const [lx, ly] = labelPos(i)
        return (
          <text key={ax.key} x={lx} y={ly} className="cofia compareRadarLabel">
            {ax.label}
          </text>
        )
      })}
    </svg>
  )
}

export default function LotCompareModal({ open, lotKey, items, loading = false, onClose, onLoad }) {
  const sorted = useMemo(() => {
    const arr = Array.isArray(items) ? items.slice() : []
    arr.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
    return arr
  }, [items])

  const profiles = useMemo(() => sorted.map(buildProfile), [sorted])

  const [leftId, setLeftId] = useState('')
  const [rightId, setRightId] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const exportRef = useRef(null)

  // open 時に初期選択（最新2件）
  useEffect(() => {
    if (!open) return
    const a = profiles[1]?.id ?? profiles[0]?.id ?? ''
    const b = profiles[0]?.id ?? ''
    setLeftId(a)
    setRightId(b)
  }, [open, profiles])

  const left = useMemo(() => profiles.find((p) => p.id === leftId) ?? null, [profiles, leftId])
  const right = useMemo(() => profiles.find((p) => p.id === rightId) ?? null, [profiles, rightId])

  const diff = useMemo(() => {
    if (!left || !right) return null
    return {
      totalMs: diffNumber(right.totalMs, left.totalMs),
      oneC: diffNumber(right.oneC, left.oneC),
      devMs: diffNumber(right.devMs, left.devMs),
      dtr: diffNumber(right.dtr, left.dtr),
    }
  }, [left, right])

  if (!open) return null

  const safeFileName = (name) => {
    const base = String(name || 'cofia-compare').trim() || 'cofia-compare'
    return base.replace(/[\\/:*?"<>|]/g, '-').slice(0, 90)
  }

  const onExport = async () => {
    if (!exportRef.current || !left || !right || isExporting) return
    setIsExporting(true)
    try {
      const filename = safeFileName(`cofia-compare_${lotKey || 'lot'}_${left.label}_vs_${right.label}`)
      const dataUrl = await toPng(exportRef.current, {
        cacheBust: true,
        pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `${filename}.png`
      a.click()
    } catch (e) {
      console.error(e)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="cofia compareBackdrop" role="dialog" aria-modal="true" aria-label="lot compare">
      <div className="cofia compareSheet">
        <div className="cofia compareTop">
          <div>
            <div className="cofia compareTitle">Lot Compare</div>
            <div className="cofia compareSub">
              {lotKey ? `Lot: ${lotKey}` : 'Lot: —'} • {loading ? 'loading…' : `${profiles.length} items`}
            </div>
          </div>

          <button className="cofia compareClose" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="cofia compareSelectors">
          <select className="cofia compareSelect" value={leftId} onChange={(e) => setLeftId(e.target.value)} aria-label="left">
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>

          <span className="cofia compareVs">vs</span>

          <select className="cofia compareSelect" value={rightId} onChange={(e) => setRightId(e.target.value)} aria-label="right">
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="cofia compareActions">
          <button
            className="cofia compareBtn"
            onClick={() => {
              setLeftId(rightId)
              setRightId(leftId)
            }}
          >
            Swap
          </button>

          {left?.raw && (
            <button className="cofia compareBtn ghost" onClick={() => onLoad?.(left.raw)}>
              Load L
            </button>
          )}
          {right?.raw && (
            <button className="cofia compareBtn ghost" onClick={() => onLoad?.(right.raw)}>
              Load R
            </button>
          )}

          <button
            className="cofia compareBtn"
            onClick={onExport}
            disabled={loading || !left || !right || isExporting}
            title="Export current comparison as PNG"
          >
            {isExporting ? 'Exporting…' : 'Export PNG'}
          </button>
        </div>

        <div ref={exportRef} className="cofia compareExportArea">
        {!left || !right || !diff ? (
          <div className="cofia compareEmpty">比較対象を選んで。</div>
        ) : (
          <>
            <section className="cofia compareCard">
              <div className="cofia compareCardTitle">差分サマリー（R - L）</div>
              <div className="cofia compareGrid">
                <DiffRow label="Total" value={diff.totalMs} fmt={(v) => `${Math.round(v / 1000)}s`} />
                <DiffRow label="1C start" value={diff.oneC} fmt={(v) => `${Math.round(v / 1000)}s`} />
                <DiffRow label="Dev" value={diff.devMs} fmt={(v) => `${Math.round(v / 1000)}s`} />
                <DiffRow label="DTR" value={diff.dtr} fmt={(v) => `${(v * 100).toFixed(1)}%`} />
              </div>

              <div className="cofia compareMini">
                <div className="cofia compareMiniCol">
                  <div className="cofia compareMiniTitle">Left</div>
                  <div className="cofia compareMiniLine">{[left.originCountry, left.process, left.variety].filter(Boolean).join(' • ') || '—'}</div>
                  <div className="cofia compareMiniLine">{formatDuration(left.totalMs)} • DTR {left.dtr != null ? pct(left.dtr) : '—'}</div>
                </div>
                <div className="cofia compareMiniCol">
                  <div className="cofia compareMiniTitle">Right</div>
                  <div className="cofia compareMiniLine">{[right.originCountry, right.process, right.variety].filter(Boolean).join(' • ') || '—'}</div>
                  <div className="cofia compareMiniLine">{formatDuration(right.totalMs)} • DTR {right.dtr != null ? pct(right.dtr) : '—'}</div>
                </div>
              </div>
            </section>

            <section className="cofia compareCard">
              <div className="cofia compareCardTitle">フェーズ</div>
              <PhaseBars left={left} right={right} />
            </section>

            <section className="cofia compareCard">
              <div className="cofia compareCardTitle">Flavor radar</div>
              <div className="cofia compareRadarWrap">
                <RadarCompare leftVals={left.flavorVals} rightVals={right.flavorVals} />
                <div className="cofia compareLegend">
                  <div className="cofia legItem"><span className="cofia legDot left" />Left</div>
                  <div className="cofia legItem"><span className="cofia legDot right" />Right</div>
                </div>
              </div>
            </section>
          </>
        )}
        </div>
      </div>
    </div>
  )
}
