import { useState, useCallback, useRef } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastState {
  message: string
  type: ToastType
  visible: boolean
}

export function useToast(duration: number = 3000) {
  const [toast, setToast] = useState<ToastState>({
    message: '',
    type: 'success',
    visible: false,
  })

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    setToast({ message, type, visible: true })
    timerRef.current = setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }))
    }, duration)
  }, [duration])

  return { toast, showToast }
}
