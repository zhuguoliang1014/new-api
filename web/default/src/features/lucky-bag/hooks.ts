import { useEffect, useState } from 'react'

interface RefreshCountdown {
  h: number
  m: number
  s: number
  diff: number
  expired: boolean
}

// 返回距下一次刷新（unix 秒时间戳）的剩余 hh:mm:ss
// 当 nextRefreshUnix <= 0 时返回 expired=true
export function useNextRefreshCountdown(nextRefreshUnix: number, onExpire?: () => void): RefreshCountdown {
  const calc = (): RefreshCountdown => {
    if (!nextRefreshUnix || nextRefreshUnix <= 0) {
      return { h: 0, m: 0, s: 0, diff: 0, expired: true }
    }
    const nowSec = Math.floor(Date.now() / 1000)
    const diff = nextRefreshUnix - nowSec
    if (diff <= 0) {
      return { h: 0, m: 0, s: 0, diff: 0, expired: true }
    }
    return {
      h: Math.floor(diff / 3600),
      m: Math.floor((diff % 3600) / 60),
      s: diff % 60,
      diff,
      expired: false,
    }
  }

  const [state, setState] = useState<RefreshCountdown>(calc)

  useEffect(() => {
    setState(calc())
    const id = setInterval(() => {
      const next = calc()
      setState((prev) => {
        if (!prev.expired && next.expired && onExpire) {
          onExpire()
        }
        return next
      })
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextRefreshUnix])

  return state
}
