import { useEffect, useState } from 'react'

export function usePromotionClock(enabled: boolean) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000
    )
    return () => window.clearInterval(timer)
  }, [enabled])
  return enabled ? now : Math.floor(Date.now() / 1000)
}
