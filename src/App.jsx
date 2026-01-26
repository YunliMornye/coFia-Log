import { useEffect, useMemo, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { db } from './db'
import LotCompareModal from './features/LotCompareModal'
import fiaAvatar from './assets/fia-avatar.png'
import './App.css'

// -------------------- Fia voice pack (casual) --------------------
const FIA = {
  status: {
    ready: '準備できてるよ。',
    saving: '保存してる。ちょっと待って。',
    exporting: '書き出してる。今いい感じ。',
    saved: (t) => `保存したよ。${t}`,
  },
  hint: {
    preview: 'ここ見て。今の状態、そのまま出る。',
    input: '気づいたことだけでいいよ。判断はあなた。',
    history: '過去ログ。タップで呼び戻せる。',
    timer: '焙煎中はこれだけ触ればいい。後で計算できる形で残す。',
    dtr: '計算は私がやる。あなたは記録に集中して。',
    radar: '味は“言葉”にすると、再現できる。6軸だけでいい。',
    lot: 'ロットは“比較の鍵”。タグとして持たせる。',
    newFromLot: '同一ロットで新規作成。2回目、迷わず始めよ。',
    fiaManual: 'Fia分析は手動。コピペで最短。',
    next: '次は「運用」と「見た目」を詰めるだけ。',
  },
  toast: {
    bootEmpty: '起動した。今日はどんな焙煎？',
    bootRestore: (t) => `前の続き、戻しておいた。${t ? `(${t})` : ''}`,
    saved: '保存した。次どうする？',
    reset: '一回まっさらにした。新しくいこ。',
    exportOk: '書き出せた。これ、そのまま使える。',
    exportFailed: 'うまくいかなかった。Console見て。',
    loaded: (t) => `これ開いた。${t ? `(${t})` : ''}`,
    newDraft: '新規でいこ。まだ何も決めなくていい。',
    newFromLot: (lotKey) => `同一ロットで新規作成した。${lotKey ? `Lot: ${lotKey}` : ''}`,
    timerStart: '開始。落ち着いて。',
    timerLap: (label) => `記録した。${label}`,
    timerStop: '停止。あとで整えられる。',
    timerReset: 'タイマー、リセットした。',
    lotHint: 'ロット入れた。これで比較できる。',
    copied: 'コピーしたよ。フィアに投げて。',
    copyFailed: 'コピーできなかった。権限を確認して。',
    deleted: '消した。必要ならまた作ろ。',
    nuked: 'ログ全消し。初期化した。',
  },
}

// -------------------- utilities --------------------
function pad2(n) {
  return String(n).padStart(2, '0')
}
function formatNow() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
function nowISO() {
  return new Date().toISOString()
}
function safeFileName(name) {
  const base = (name || 'cofia-card').trim()
  return base.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'cofia-card'
}
function isoToHuman(iso) {
  if (!iso) return ''
  return String(iso).slice(0, 16).replace('T', ' ')
}
function clamp0(n) {
  return Math.max(0, Number.isFinite(n) ? n : 0)
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
function pct(n) {
  if (!Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}
function normKey(s) {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80)
}
function shortLotLabel(lotKey) {
  const t = normKey(lotKey)
  return t ? `Lot: ${t}` : 'Lot: —'
}
function cleanNumOrEmpty(v) {
  const t = String(v ?? '').trim()
  if (!t) return ''
  const n = Number(t)
  if (!Number.isFinite(n)) return ''
  return String(Math.round(n))
}

// -------------------- Flavor Radar (6 axes / 0-10) --------------------
const RADAR_AXES = [
  { key: 'sweet', label: 'Sweetness' },
  { key: 'juicy', label: 'Juiciness' },
  { key: 'floral', label: 'Floral' },
  { key: 'funk', label: 'Funk' },
  { key: 'clarity', label: 'Clarity' },
  { key: 'body', label: 'Body' },
]
const RADAR_DEFAULT = {
  sweet: 5,
  juicy: 5,
  floral: 5,
  funk: 3,
  clarity: 6,
  body: 5,
}
function clampRadar(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(10, Math.max(0, Math.round(n)))
}

function RadarChart({ values }) {
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

  const polygonPoints = RADAR_AXES.map((ax, i) => point(i, values?.[ax.key] ?? 0))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')

  const labelPos = (i) => {
    const a = angle0 + (2 * Math.PI * i) / N
    const r = R + 22
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  }

  return (
  <svg
    className="cofia radarSvg"
    width={size}
    height={size}
    viewBox={`0 0 ${size} ${size}`}
    shapeRendering="geometricPrecision"
  >
    {levels.map((lv) => {
      const pts = RADAR_AXES.map((_, i) => point(i, lv))
        .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
        .join(' ')
      return (
        <polygon
          key={lv}
          points={pts}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
        />
      )
    })}

    {RADAR_AXES.map((ax, i) => {
      const [x, y] = point(i, 10)
      return (
        <line
          key={ax.key}
          x1={cx}
          y1={cy}
          x2={x}
          y2={y}
          stroke="rgba(255,255,255,0.10)"
          strokeWidth="1"
        />
      )
    })}

    <polygon
      points={polygonPoints}
      fill="white"
      fillOpacity="0.14"
      stroke="rgba(255,255,255,0.30)"
      strokeWidth="1.2"
    />

    <circle cx={cx} cy={cy} r="2.4" fill="rgba(255,255,255,0.70)" />

    {RADAR_AXES.map((ax, i) => {
      const [lx, ly] = labelPos(i)
      return (
        <text
          key={ax.key}
          x={lx}
          y={ly}
          fill="rgba(255,255,255,0.72)"
          fontSize="10"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {ax.label}
        </text>
      )
    })}
  </svg>
)

}

// -------------------- Fia manual integration (copy text) --------------------
function fmtTimeOrDash(ms) {
  if (!Number.isFinite(ms)) return '—'
  return formatDuration(ms)
}
function secOrDash(ms) {
  if (!Number.isFinite(ms)) return '—'
  return `${Math.round(ms / 1000)}`
}
function ratioPctOrDash(r) {
  if (!Number.isFinite(r)) return '—'
  return `${(r * 100).toFixed(1)}`
}
function buildFiaCopyTextFromLog({ originCountry, variety, process, altitudeMeters, lotKey, notes, timer, flavor }) {
  const laps = Array.isArray(timer?.laps) ? timer.laps : []
  const oneC = findLastLapElapsedMs(laps, 'firstCrack')
  const drop = findLastLapElapsedMs(laps, 'drop')
  const totalMs = drop != null ? drop : clamp0(timer?.totalMs ?? 0)
  const devMs = oneC != null && totalMs > 0 ? clamp0(totalMs - oneC) : null
  const dtrRatio = oneC != null && totalMs > 0 ? devMs / totalMs : null

  const cupComment = (notes ?? '').trim() || '（なし）'

  const alt = cleanNumOrEmpty(altitudeMeters)
  const altLine = alt ? `${alt} m` : '—'

  const k = normKey(lotKey)
  const lotLine = k ? k : '—'

  const f = (key) => clampRadar(flavor?.[key])
  const flavorLine = `Sweetness ${f('sweet')} / Juiciness ${f('juicy')} / Floral ${f('floral')} / Funk ${f('funk')} / Clarity ${f('clarity')} / Body ${f('body')}`

  return `【Roast Log】

Origin: ${normKey(originCountry) || '—'}
Variety: ${normKey(variety) || '—'}
Process: ${normKey(process) || '—'}
Altitude: ${altLine}

Lot: ${lotLine}

First Crack: ${fmtTimeOrDash(oneC)}
Drop: ${fmtTimeOrDash(drop)}
Development Time: ${devMs != null ? `${secOrDash(devMs)} s` : '—'}
DTR: ${dtrRatio != null ? `${ratioPctOrDash(dtrRatio)} %` : '—'}

Flavor Profile (0–10):
${flavorLine}

Notes:
${cupComment}

---

【Request to Fia】

この焙煎ログを分析してください。
これは同一ロット（Lot: ${lotLine}）での焙煎記録です。

1) 次回の焙煎に向けた改善点を、箇条書きで最大3つまで（日本語）
   - 同一ロットでの再現性・微調整を前提にしてください

2) 「Fiaのひとこと」を日本語で出してください
   - 天才だけど面倒見のいい後輩ヒロインの口調
   - 1〜2行
   - やさしいが、言うことは言う
   - 数値やバランスが変な場合も、責めずに指摘する`
}

// -------------------- App --------------------
export default function App() {
  // form (new schema)
  const [originCountry, setOriginCountry] = useState('')
  const [variety, setVariety] = useState('')
  const [process, setProcess] = useState('')
  const [altitudeMeters, setAltitudeMeters] = useState('')
  const [lotKey, setLotKey] = useState('')
  const [notes, setNotes] = useState('')
  const [fiaNote, setFiaNote] = useState('')

  // flavor radar
  const [flavor, setFlavor] = useState({ ...RADAR_DEFAULT })

  // ui
  const [savedAt, setSavedAt] = useState(null)
  const [toast, setToast] = useState('')

  // settings
  const [showFiaOnCard, setShowFiaOnCard] = useState(() => {
    try {
      const v = localStorage.getItem('cofia.showFiaOnCard')
      return v === '1'
    } catch {
      return false
    }
  })

  // db
  const [isSaving, setIsSaving] = useState(false)
  const [lastId, setLastId] = useState(null)
  const [history, setHistory] = useState([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)

  // lot compare
  const [isCompareOpen, setIsCompareOpen] = useState(false)
  const [compareLotKey, setCompareLotKey] = useState('')
  const [compareItems, setCompareItems] = useState([])
  const [isCompareLoading, setIsCompareLoading] = useState(false)

  // export
  const [isExporting, setIsExporting] = useState(false)
  const cardRef = useRef(null)

  // timer
  const [timerStartedAtMs, setTimerStartedAtMs] = useState(null)
  const [timerStoppedAtMs, setTimerStoppedAtMs] = useState(null)
  const [timerTotalMs, setTimerTotalMs] = useState(0)
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerLaps, setTimerLaps] = useState([])
  const [tick, setTick] = useState(0)

  const runStartRef = useRef(null)
  const intervalRef = useRef(null)

  const disableAll = isSaving || isExporting

  useEffect(() => {
    try {
      localStorage.setItem('cofia.showFiaOnCard', showFiaOnCard ? '1' : '0')
    } catch {
      // ignore
    }
  }, [showFiaOnCard])

  const headerText = useMemo(() => {
    if (isExporting) return FIA.status.exporting
    if (isSaving) return FIA.status.saving
    if (savedAt) return FIA.status.saved(savedAt)
    return FIA.status.ready
  }, [isExporting, isSaving, savedAt])

  const refreshHistory = async () => {
    setIsLoadingHistory(true)
    try {
      const items = await db.roasts.orderBy('updatedAt').reverse().limit(60).toArray()
      setHistory(items)
    } finally {
      setIsLoadingHistory(false)
    }
  }

  // ticker
  useEffect(() => {
    if (!timerRunning) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
      return
    }
    intervalRef.current = setInterval(() => setTick((v) => v + 1), 250)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [timerRunning])

  const currentElapsedMs = useMemo(() => {
    if (!timerRunning || runStartRef.current == null) return timerTotalMs
    return timerTotalMs + (Date.now() - runStartRef.current)
  }, [timerRunning, timerTotalMs, tick])

  const timerSnapshot = useMemo(() => {
    const totalMs = clamp0(currentElapsedMs)
    return {
      startedAtMs: timerStartedAtMs,
      stoppedAtMs: timerStoppedAtMs,
      totalMs,
      laps: timerLaps,
    }
  }, [currentElapsedMs, timerStartedAtMs, timerStoppedAtMs, timerLaps])

  const hasDrop = useMemo(() => findLastLapElapsedMs(timerLaps, 'drop') != null, [timerLaps])

  // DTR
  const dtr = useMemo(() => {
    const oneC = findLastLapElapsedMs(timerLaps, 'firstCrack')
    const drop = findLastLapElapsedMs(timerLaps, 'drop')
    const totalMs = drop != null ? drop : clamp0(currentElapsedMs)

    if (totalMs <= 0) {
      return { totalMs: 0, oneC: null, drop: null, devMs: null, dtr: null, ready: false, msg: 'まだ計算しない。' }
    }
    if (oneC == null || totalMs == null) {
      return { totalMs, oneC, drop, devMs: null, dtr: null, ready: false, msg: '1C start を押すとDTR出せる。' }
    }

    const devMs = clamp0(totalMs - oneC)
    const ratio = totalMs > 0 ? devMs / totalMs : null
    return {
      totalMs,
      oneC,
      drop,
      devMs,
      dtr: ratio,
      ready: drop != null,
      msg: drop != null ? '出た。見て、判断して。' : '途中経過。Dropで確定。',
    }
  }, [timerLaps, currentElapsedMs])

  // timer actions
  const timerStart = () => {
    if (timerRunning || hasDrop) return
    const now = Date.now()
    if (timerStartedAtMs == null) setTimerStartedAtMs(now)
    setTimerStoppedAtMs(null)
    runStartRef.current = now
    setTimerRunning(true)
    setToast(`Fia: ${FIA.toast.timerStart}`)
  }

  const timerStop = () => {
    if (timerRunning && runStartRef.current != null) {
      const now = Date.now()
      const add = now - runStartRef.current
      setTimerTotalMs((prev) => clamp0(prev + add))
      runStartRef.current = null
      setTimerRunning(false)
      setTimerStoppedAtMs(now)
      setToast(`Fia: ${FIA.toast.timerStop}`)
      return
    }
    if (!timerRunning) {
      setTimerStoppedAtMs(Date.now())
      setToast(`Fia: ${FIA.toast.timerStop}`)
    }
  }

  const timerLap = (type, label) => {
    if (disableAll) return
    if (type === 'drop' && hasDrop) return // prevent infinite drops
    if (hasDrop) return // after drop, no more laps
    const now = Date.now()
    const elapsedMs = clamp0(currentElapsedMs)
    setTimerLaps((prev) => [...prev, { type, label, atMs: now, elapsedMs }])
    setToast(`Fia: ${FIA.toast.timerLap(label)}`)

    // ✅ Drop = finish (auto stop)
    if (type === 'drop') {
      // stop timer immediately and freeze total at drop time
      if (timerRunning && runStartRef.current != null) {
        runStartRef.current = null
        setTimerRunning(false)
      }
      setTimerTotalMs(elapsedMs)
      setTimerStoppedAtMs(now)
    }
  }

  const timerReset = () => {
    setTimerStartedAtMs(null)
    setTimerStoppedAtMs(null)
    setTimerTotalMs(0)
    setTimerRunning(false)
    runStartRef.current = null
    setTimerLaps([])
    setToast(`Fia: ${FIA.toast.timerReset}`)
  }

  // boot restore
  useEffect(() => {
    ;(async () => {
      const latest = await db.roasts.orderBy('updatedAt').reverse().first()
      if (!latest) {
        setToast(`Fia: ${FIA.toast.bootEmpty}`)
        await refreshHistory()
        return
      }

      setLastId(latest.id ?? null)
      setOriginCountry(latest.originCountry ?? '')
      setVariety(latest.variety ?? '')
      setProcess(latest.process ?? '')
      setAltitudeMeters(latest.altitudeMeters ?? '')
      setLotKey(latest.lotKey ?? '')
      setNotes(latest.notes ?? '')
      setFiaNote(latest.fiaNote ?? '')

      const t = isoToHuman(latest.updatedAt)
      if (t) setSavedAt(t)
      setToast(`Fia: ${FIA.toast.bootRestore(t)}`)

      if (latest.timer && typeof latest.timer === 'object') {
        setTimerStartedAtMs(latest.timer.startedAtMs ?? null)
        setTimerStoppedAtMs(latest.timer.stoppedAtMs ?? null)
        setTimerTotalMs(clamp0(latest.timer.totalMs ?? 0))
        setTimerLaps(Array.isArray(latest.timer.laps) ? latest.timer.laps : [])
        setTimerRunning(false)
        runStartRef.current = null
      } else {
        timerReset()
      }

      if (latest.flavor && typeof latest.flavor === 'object') {
        const next = { ...RADAR_DEFAULT }
        for (const ax of RADAR_AXES) {
          if (latest.flavor[ax.key] != null) next[ax.key] = clampRadar(latest.flavor[ax.key])
        }
        setFlavor(next)
      } else {
        setFlavor({ ...RADAR_DEFAULT })
      }

      await refreshHistory()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // save / export / load
  const onSaveDraft = async () => {
    setIsSaving(true)
    const iso = nowISO()
    try {
      const payload = {
        originCountry: normKey(originCountry),
        variety: normKey(variety),
        process: normKey(process),
        altitudeMeters: String(altitudeMeters ?? '').trim(),
        lotKey: normKey(lotKey),
        notes,
        fiaNote,
        updatedAt: iso,
        timer: timerSnapshot,
        flavor: { ...flavor },
      }

      if (lastId) {
        await db.roasts.update(lastId, payload)
      } else {
        const id = await db.roasts.add({ ...payload, createdAt: iso })
        setLastId(id)
      }

      const t = formatNow()
      setSavedAt(t)
      setToast(`Fia: ${FIA.toast.saved}`)
      await refreshHistory()
    } finally {
      setIsSaving(false)
    }
  }

  const onExportPng = async () => {
  if (!cardRef.current) return
  setIsExporting(true)

  try {
    const node = cardRef.current

    const dataUrl = await toPng(node, {
      cacheBust: true,
      pixelRatio: 3, // 2→3に上げてバンディング軽減
      backgroundColor: '#0f0f10',

      // ✅ ここが本命：クローンに「書き出し専用スタイル」を直指定
      style: {
        background: '#0f0f10',
        backgroundImage: 'none',
        boxShadow: 'none',
        filter: 'none',
      },
    })

    const a = document.createElement('a')
    a.download = `${safeFileName(buildCardTitle())}${showFiaOnCard ? '_fia' : '_clean'}.png`
    a.href = dataUrl
    a.click()
    setToast(`Fia: ${FIA.toast.exportOk}`)
  } catch (e) {
    console.error(e)
    setToast(`Fia: ${FIA.toast.exportFailed}`)
    alert(FIA.toast.exportFailed)
  } finally {
    setIsExporting(false)
  }
}



  const onCopyForFia = async () => {
    try {
      const text = buildFiaCopyTextFromLog({
        originCountry,
        variety,
        process,
        altitudeMeters,
        lotKey,
        notes,
        timer: timerSnapshot,
        flavor,
      })
      await navigator.clipboard.writeText(text)
      setToast(`Fia: ${FIA.toast.copied}`)
    } catch (e) {
      console.error(e)
      setToast(`Fia: ${FIA.toast.copyFailed}`)
      alert(FIA.toast.copyFailed)
    }
  }

  const onNew = () => {
    // keep lotKey to reduce friction
    setOriginCountry('')
    setVariety('')
    setProcess('')
    setAltitudeMeters('')
    // setLotKey('')
    setNotes('')
    setFiaNote('')
    setSavedAt(null)
    setLastId(null)
    timerReset()
    setFlavor({ ...RADAR_DEFAULT })
    setToast(`Fia: ${FIA.toast.newDraft}`)
  }

  const onClearForm = () => {
    setOriginCountry('')
    setVariety('')
    setProcess('')
    setAltitudeMeters('')
    setLotKey('')
    setNotes('')
    setFiaNote('')
    setSavedAt(null)
    setLastId(null)
    timerReset()
    setFlavor({ ...RADAR_DEFAULT })
    setToast(`Fia: ${FIA.toast.reset}`)
  }

  const onLoad = async (item) => {
    if (!item) return

    setLastId(item.id ?? null)
    setOriginCountry(item.originCountry ?? '')
    setVariety(item.variety ?? '')
    setProcess(item.process ?? '')
    setAltitudeMeters(item.altitudeMeters ?? '')
    setLotKey(item.lotKey ?? '')
    setNotes(item.notes ?? '')
    setFiaNote(item.fiaNote ?? '')

    const t = isoToHuman(item.updatedAt)
    setSavedAt(t || null)
    setToast(`Fia: ${FIA.toast.loaded(t)}`)

    if (item.timer && typeof item.timer === 'object') {
      setTimerStartedAtMs(item.timer.startedAtMs ?? null)
      setTimerStoppedAtMs(item.timer.stoppedAtMs ?? null)
      setTimerTotalMs(clamp0(item.timer.totalMs ?? 0))
      setTimerLaps(Array.isArray(item.timer.laps) ? item.timer.laps : [])
      setTimerRunning(false)
      runStartRef.current = null
    } else {
      timerReset()
    }

    if (item.flavor && typeof item.flavor === 'object') {
      const next = { ...RADAR_DEFAULT }
      for (const ax of RADAR_AXES) {
        if (item.flavor[ax.key] != null) next[ax.key] = clampRadar(item.flavor[ax.key])
      }
      setFlavor(next)
    } else {
      setFlavor({ ...RADAR_DEFAULT })
    }
  }

  // ✅ New from Lot
  const onNewFromLot = (item) => {
    if (!item) return

    setOriginCountry(item.originCountry ?? '')
    setVariety(item.variety ?? '')
    setProcess(item.process ?? '')
    setAltitudeMeters(item.altitudeMeters ?? '')
    setLotKey(item.lotKey ?? '')

    if (item.flavor && typeof item.flavor === 'object') {
      const next = { ...RADAR_DEFAULT }
      for (const ax of RADAR_AXES) {
        if (item.flavor[ax.key] != null) next[ax.key] = clampRadar(item.flavor[ax.key])
      }
      setFlavor(next)
    } else {
      setFlavor({ ...RADAR_DEFAULT })
    }

    // new draft fields
    setLastId(null)
    setNotes('')
    setFiaNote('')
    setSavedAt(null)
    timerReset()

    setToast(`Fia: ${FIA.toast.newFromLot(normKey(item.lotKey))}`)
  }

  const onDeleteHistory = async (item) => {
    if (!item?.id) return
    const ok = confirm('このログを削除する？（戻せない）')
    if (!ok) return
    await db.roasts.delete(item.id)
    if (item.id === lastId) {
      setLastId(null)
      setSavedAt(null)
    }
    setToast(`Fia: ${FIA.toast.deleted}`)
    await refreshHistory()
  }

  // Lot Compare（同一ロットを並べて差分を見る）
  const onOpenLotCompare = async (item) => {
    const k = normKey(item?.lotKey)
    if (!k) return

    setIsCompareOpen(true)
    setCompareLotKey(k)
    setIsCompareLoading(true)
    try {
      let rows = []
      try {
        rows = await db.roasts.where('lotKey').equals(k).toArray()
      } catch (e) {
        const all = await db.roasts.toArray()
        rows = all.filter((r) => normKey(r?.lotKey) === k)
      }
      rows.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
      setCompareItems(rows)
    } finally {
      setIsCompareLoading(false)
    }
  }

  const resetAllLogs = async () => {
    const ok = confirm('ログを全て削除して初期化する？（戻せない）')
    if (!ok) return
    await db.roasts.clear()
    setHistory([])
    onClearForm()
    setToast(`Fia: ${FIA.toast.nuked}`)
  }

  const buildCardTitle = () => {
    const o = normKey(originCountry)
    const p = normKey(process)
    const l = normKey(lotKey)
    const parts = [o, p, l].filter(Boolean)
    return parts.join('_') || 'cofia-card'
  }

  const timerSummary = useMemo(() => {
    const total = formatDuration(currentElapsedMs)
    const has = timerStartedAtMs != null || currentElapsedMs > 0 || timerLaps.length > 0
    return { total, has }
  }, [currentElapsedMs, timerStartedAtMs, timerLaps.length])

  const flavorCompact = useMemo(() => {
    const vals = RADAR_AXES.map((a) => clampRadar(flavor[a.key]))
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length
    return Math.round(avg * 10) / 10
  }, [flavor])

  const metaLine = useMemo(() => {
    const o = normKey(originCountry)
    const v = normKey(variety)
    const p = normKey(process)
    const a = cleanNumOrEmpty(altitudeMeters)
    const parts = []
    if (o) parts.push(o)
    const pv = [p, v].filter(Boolean).join(' • ')
    if (pv) parts.push(pv)
    if (a) parts.push(`${a}m`)
    const s = parts.join('  •  ')
    return s || 'origin / variety / process / altitude ...'
  }, [originCountry, variety, process, altitudeMeters])

  // -------------------- render --------------------
  return (
    <div className="cofia page">
      <header className="cofia header">
        <div>
          <div className="cofia appName">coFia Log</div>
          <div className="cofia sub">Coffee Roast Log</div>
        </div>
        <div className="cofia status">{headerText}</div>
      </header>

      <main className="cofia main">
        {/* History */}
        <section className="cofia card historySection">
          <div className="cofia cardTitleRow">
            <div className="cofia cardTitle">History</div>
            <button className="cofia ghostSmall" onClick={onNew} disabled={disableAll}>
              New
            </button>
          </div>

          <div className="cofia historyMeta">{isLoadingHistory ? 'loading…' : `${history.length} items`}</div>

          <div className="cofia historyList" role="list">
            {history.length === 0 ? (
              <div className="cofia historyEmpty">まだログがない。最初の1件、作ろ。</div>
            ) : (
              history.map((item) => {
                const t = isoToHuman(item.updatedAt)
                const hasLot = !!normKey(item.lotKey)

                const o = normKey(item.originCountry)
                const v = normKey(item.variety)
                const p = normKey(item.process)
                const a = cleanNumOrEmpty(item.altitudeMeters)

                const line1 = o || '—'
                const line2Parts = []
                const pv = [p, v].filter(Boolean).join(' • ')
                if (pv) line2Parts.push(pv)
                if (a) line2Parts.push(`${a}m`)

                return (
                  <div key={item.id} className={`cofia historyRow ${item.id === lastId ? 'isActive' : ''}`} role="listitem">
                    <div
                      className="cofia historyMain"
                      role="button"
                      tabIndex={disableAll ? -1 : 0}
                      aria-disabled={disableAll}
                      onClick={() => {
                        if (!disableAll) onLoad(item)
                      }}
                      onKeyDown={(e) => {
                        if (disableAll) return
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onLoad(item)
                        }
                      }}
                      aria-label="load-history-item"
                    >
                      <div className="cofia historyTop">
                        <div className="cofia historyName">{line1}</div>
                        <div className="cofia historyTime">{t}</div>
                      </div>
                      <div className="cofia historySub">
                        <span className="cofia historyBean">{line2Parts.join('  •  ') || '—'}</span>
                        {hasLot ? (
                          <button
                            type="button"
                            className="cofia lotChip"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              onOpenLotCompare(item)
                            }}
                            disabled={disableAll}
                            title="Open compare for this lot"
                          >
                            {shortLotLabel(item.lotKey)}
                          </button>
                        ) : (
                          <span className="cofia lotChipPlaceholder">Lot: —</span>
                        )}
                      </div>
                    </div>

                    <div className="cofia historyActions">
                      <button
                        className="cofia historyAction"
                        onClick={() => onNewFromLot(item)}
                        disabled={disableAll || !normKey(item.lotKey)}
                        title={normKey(item.lotKey) ? 'Create new draft from same lot' : 'Lot key is empty'}
                      >
                        New from lot
                      </button>

                      <button className="cofia historyDelete" onClick={() => onDeleteHistory(item)} disabled={disableAll}>
                        Delete
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="cofia hint">Fia: {FIA.hint.history}</div>
          <div className="cofia hint">Fia: {FIA.hint.newFromLot}</div>
        </section>

        {/* Preview */}
        <section className="cofia card previewSection">
          <div className="cofia cardTitleRow">
            <div className="cofia cardTitle">Preview</div>
            <label className="cofia toggle">
              <input type="checkbox" checked={showFiaOnCard} onChange={(e) => setShowFiaOnCard(e.target.checked)} />
              <span>Fia comment on card</span>
            </label>
          </div>

          <div ref={cardRef} className={`cofia previewBox cardAntique ${showFiaOnCard ? 'fia' : 'clean'}`}>
            <div
  className="cofia previewTitle"
  data-text={normKey(originCountry) || 'Origin'}
>
  {normKey(originCountry) || 'Origin'}
</div>

            <div className="cofia previewMeta">
              {metaLine}
              {normKey(lotKey) ? `  •  ${shortLotLabel(lotKey)}` : ''}
            </div>

            <div className="cofia previewRow">
              <div className="cofia previewNotes">{notes || 'notes...'}</div>
              <div className="cofia previewRadarMini">
                <RadarChart values={flavor} />
              </div>
            </div>

            {showFiaOnCard && (
              <div className="cofia fiaBubble">
                <div className="cofia fiaAvatarWrap" aria-hidden="true">
                  <img className="cofia fiaAvatar" src={fiaAvatar} alt="Fia" />
                </div>
                <div className="cofia fiaBubbleBody">
                  <div className="cofia fiaBubbleTop">
                    <span className="cofia fiaTag">Fia’s comment</span>
                  </div>
                  <div className="cofia fiaText">{String(fiaNote ?? '').trim() ? fiaNote : '（未入力）'}</div>
                </div>
              </div>
            )}

            <div className="cofia previewFooter">
              coFia Log • {savedAt ? `Saved ${savedAt}` : 'Not saved'}
              {lastId ? ` • id:${lastId}` : ''}
              {timerSummary.has ? ` • Timer ${timerSummary.total}` : ''}
              {dtr.dtr != null ? ` • DTR ${pct(dtr.dtr)}` : ''}
              {` • Flavor avg ${flavorCompact}`}
            </div>
          </div>

          <div className="cofia actions">
            <button className="cofia primary" onClick={onExportPng} disabled={disableAll}>
              {isExporting ? 'Exporting…' : 'Export PNG'}
            </button>
            <button className="cofia ghost" onClick={onCopyForFia} disabled={disableAll}>
              Fia分析用にコピー
            </button>
          </div>

          <div className="cofia hint">Fia: {FIA.hint.preview}</div>
          <div className="cofia hint">Fia: {FIA.hint.fiaManual}</div>
        </section>

        {/* Timer */}
        <section className="cofia card timerSection">
          <div className="cofia cardTitleRow">
            <div className="cofia cardTitle">Timer</div>
            <button className="cofia ghostSmall" onClick={timerReset} disabled={disableAll}>
              Reset
            </button>
          </div>

          <div className="cofia timerDisplay" aria-label="timer-display">
            {formatDuration(currentElapsedMs)}
          </div>

          <div className="cofia timerActions">
            <button className="cofia primary" onClick={timerStart} disabled={disableAll || timerRunning || hasDrop}>
              Start
            </button>
            <button className="cofia ghost" onClick={timerStop} disabled={disableAll || (!timerRunning && currentElapsedMs === 0) || hasDrop}>
              Stop
            </button>
          </div>

          <div className="cofia timerLapRow">
            <button className="cofia lapBtn" onClick={() => timerLap('dryEnd', 'Dry end')} disabled={disableAll || currentElapsedMs === 0 || hasDrop}>
              Dry end
            </button>
            <button className="cofia lapBtn" onClick={() => timerLap('firstCrack', '1C start')} disabled={disableAll || currentElapsedMs === 0 || hasDrop}>
              1C start
            </button>
            <button className="cofia lapBtn drop" onClick={() => timerLap('drop', 'Drop')} disabled={disableAll || currentElapsedMs === 0 || hasDrop}>
              Drop
            </button>
          </div>

          {hasDrop && <div className="cofia timerDone">Drop 記録で計測完了。ここからは編集じゃなく保存。</div>}

          <div className="cofia timerLaps">
            {timerLaps.length === 0 ? (
              <div className="cofia timerEmpty">まだマークなし。必要なとこだけ押せばOK。</div>
            ) : (
              timerLaps
                .slice()
                .reverse()
                .map((lap, idx) => (
                  <div className="cofia timerLapItem" key={`${lap.atMs}-${idx}`}>
                    <div className="cofia timerLapLabel">{lap.label}</div>
                    <div className="cofia timerLapTime">{formatDuration(lap.elapsedMs)}</div>
                  </div>
                ))
            )}
          </div>

          <div className="cofia hint">Fia: {FIA.hint.timer}</div>
        </section>

        {/* DTR */}
        <section className="cofia card dtrSection">
          <div className="cofia cardTitle">DTR auto calc</div>

          <div className="cofia dtrGrid">
            <div className="cofia dtrBox">
              <div className="cofia dtrLabel">Total</div>
              <div className="cofia dtrValue">{formatDuration(dtr.totalMs)}</div>
            </div>

            <div className="cofia dtrBox">
              <div className="cofia dtrLabel">1C start</div>
              <div className="cofia dtrValue">{dtr.oneC != null ? formatDuration(dtr.oneC) : '—'}</div>
            </div>

            <div className="cofia dtrBox">
              <div className="cofia dtrLabel">Development</div>
              <div className="cofia dtrValue">{dtr.devMs != null ? formatDuration(dtr.devMs) : '—'}</div>
            </div>

            <div className="cofia dtrBox">
              <div className="cofia dtrLabel">DTR</div>
              <div className="cofia dtrValue">{dtr.dtr != null ? pct(dtr.dtr) : '—'}</div>
            </div>
          </div>

          <div className="cofia dtrNote">{dtr.msg}</div>
          <div className="cofia hint">Fia: {FIA.hint.dtr}</div>
        </section>

        {/* Flavor Radar */}
        <section className="cofia card radarSection">
          <div className="cofia cardTitleRow">
            <div className="cofia cardTitle">Flavor radar</div>
            <button className="cofia ghostSmall" disabled={disableAll} onClick={() => setFlavor({ ...RADAR_DEFAULT })}>
              Reset
            </button>
          </div>

          <div className="cofia radarWrap">
            <div className="cofia radarChartBox">
              <RadarChart values={flavor} />
            </div>

            <div className="cofia radarControls">
              {RADAR_AXES.map((ax) => (
                <label className="cofia radarRow" key={ax.key}>
                  <div className="cofia radarTop">
                    <span className="cofia radarName">{ax.label}</span>
                    <span className="cofia radarVal">{clampRadar(flavor[ax.key])}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="1"
                    value={clampRadar(flavor[ax.key])}
                    disabled={disableAll}
                    onChange={(e) => setFlavor((prev) => ({ ...prev, [ax.key]: clampRadar(e.target.value) }))}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="cofia hint">Fia: {FIA.hint.radar}</div>
        </section>

        {/* Input */}
        <section className="cofia card inputSection">
          <div className="cofia cardTitleRow">
            <div className="cofia cardTitle">New Roast</div>
            <button className="cofia ghostSmall" onClick={onClearForm} disabled={disableAll}>
              Clear
            </button>
          </div>

          <label className="cofia label">
            Origin
            <input value={originCountry} onChange={(e) => setOriginCountry(e.target.value)} placeholder="e.g. Ethiopia" className="cofia input" />
          </label>

          <label className="cofia label">
            Variety
            <input value={variety} onChange={(e) => setVariety(e.target.value)} placeholder="e.g. Heirloom / SL28" className="cofia input" />
          </label>

          <label className="cofia label">
            Process
            <input value={process} onChange={(e) => setProcess(e.target.value)} placeholder="e.g. Washed / Natural" className="cofia input" />
          </label>

          <label className="cofia label">
            Altitude (m)
            <input
              value={altitudeMeters}
              onChange={(e) => setAltitudeMeters(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 1800"
              className="cofia input"
            />
          </label>

          <div className="cofia lotRow">
            <label className="cofia label" style={{ marginBottom: 0 }}>
              Lot key（same lot）
              <input value={lotKey} onChange={(e) => setLotKey(e.target.value)} placeholder="e.g. ETH-KER-2026-01" className="cofia input" />
            </label>
          </div>

          <div className="cofia hint">Fia: {FIA.hint.lot}</div>

          <label className="cofia label">
            Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="cup comment / memo…" rows={5} className="cofia textarea" />
          </label>

          <label className="cofia label">
            Fia one-liner（manual）
            <textarea value={fiaNote} onChange={(e) => setFiaNote(e.target.value)} placeholder="ChatGPT(Fia) から返ってきた一言を貼る…" rows={3} className="cofia textarea" />
          </label>

          <div className="cofia actions">
            <button className="cofia primary" onClick={onSaveDraft} disabled={disableAll}>
              {isSaving ? 'Saving…' : 'Save draft'}
            </button>
            <button className="cofia ghost" onClick={onNew} disabled={disableAll}>
              New draft
            </button>
          </div>

          <div className="cofia hint">Fia: {FIA.hint.input}</div>
        </section>

        {/* Settings */}
        <section className="cofia card settingsSection">
          <div className="cofia cardTitle">Settings</div>
          <div className="cofia settingsRow">
            <label className="cofia toggle">
              <input type="checkbox" checked={showFiaOnCard} onChange={(e) => setShowFiaOnCard(e.target.checked)} />
              <span>Fia comment on card</span>
            </label>
            <button className="cofia danger" onClick={resetAllLogs} disabled={disableAll}>
              Reset all logs
            </button>
          </div>
          <div className="cofia settingsNote">※ 既存ログは互換なしでOK運用。必要ならここで全消し。</div>
        </section>

        {/* Next */}
        <section className="cofia card nextSection">
          <div className="cofia cardTitle">Next</div>
          <ul className="cofia list">
            <li>運用（Fia手動フロー）を固める</li>
            <li>カードの見た目（clean / fia）を微調整</li>
            <li>削除 / 編集（必要になったら）</li>
          </ul>
          <div className="cofia hint">Fia: {FIA.hint.next}</div>
        </section>
      </main>

      <LotCompareModal
        open={isCompareOpen}
        lotKey={compareLotKey}
        items={compareItems}
        loading={isCompareLoading}
        onClose={() => setIsCompareOpen(false)}
        onLoad={(item) => {
          onLoad(item)
          setIsCompareOpen(false)
        }}
      />

      <footer className="cofia footer">
        <span className="cofia footerText">local-first / offline-friendly</span>
        {toast && <div className="cofia footerText cofToast">{toast}</div>}
      </footer>
    </div>
  )
}
