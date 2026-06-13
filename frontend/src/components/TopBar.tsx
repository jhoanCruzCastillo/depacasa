import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, HelpCircle, ChevronDown, User, Shield, LogOut } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { session } from '../services/session'
import {
  getAdminNotifications,
  getNotificationUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../services/api'
import { AdminNotification } from '../types'

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'hace un momento'
  if (m < 60) return `hace ${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h}h`
  return `hace ${Math.floor(h / 24)}d`
}

function notifEmoji(type: string): string {
  if (type === 'user_registered') return '👤'
  if (type === 'document_uploaded') return '📄'
  if (type === 'scrape_error') return '⚠️'
  return '🔔'
}

export default function TopBar() {
  const navigate = useNavigate()
  const [showNotifs, setShowNotifs] = useState(false)
  const [showUser, setShowUser] = useState(false)
  const notifsRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const adminName = session.get()?.name ?? 'Administrador'
  const adminEmail = session.get()?.email ?? ''

  const handleLogout = () => { session.clear(); navigate('/admin/auth', { replace: true }) }

  const { data: countData } = useQuery({
    queryKey: ['notif-count'],
    queryFn: () => getNotificationUnreadCount().then(r => r.data),
    refetchInterval: 30_000,
  })

  const { data: notifications = [] } = useQuery<AdminNotification[]>({
    queryKey: ['notifications'],
    queryFn: () => getAdminNotifications().then(r => r.data),
    enabled: showNotifs,
    refetchOnMount: true,
  })

  const markRead = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['notif-count'] })
    },
  })

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['notif-count'] })
    },
  })

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (notifsRef.current && !notifsRef.current.contains(e.target as Node)) {
        setShowNotifs(false)
      }
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setShowUser(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const unread = (countData as any)?.count ?? 0

  return (
    <div className="h-14 flex items-center justify-end px-6 gap-1 border-b border-gray-100 bg-white flex-shrink-0">
      {/* Bell */}
      <div className="relative" ref={notifsRef}>
        <button
          onClick={() => { setShowNotifs(v => !v); setShowUser(false) }}
          className="relative p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {showNotifs && (
          <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <span className="font-semibold text-sm text-gray-900">Notificaciones</span>
              {unread > 0 && (
                <button
                  onClick={() => markAll.mutate()}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  Marcar todas como leídas
                </button>
              )}
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-2xl mb-2">🔔</p>
                  <p className="text-sm text-gray-400">Sin notificaciones</p>
                </div>
              ) : (
                notifications.map(n => (
                  <div
                    key={n.id}
                    onClick={() => { if (!n.is_read) markRead.mutate(n.id) }}
                    className={`px-4 py-3 flex gap-3 cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 ${
                      !n.is_read ? 'bg-blue-50/50' : ''
                    }`}
                  >
                    <span className="text-base flex-shrink-0 mt-0.5 select-none">
                      {notifEmoji(n.type)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm leading-snug ${!n.is_read ? 'font-medium text-gray-900' : 'text-gray-600'}`}>
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate">{n.body}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {n.created_at ? timeAgo(n.created_at) : ''}
                      </p>
                    </div>
                    {!n.is_read && (
                      <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Help */}
      <button className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
        <HelpCircle className="w-5 h-5" />
      </button>

      {/* Avatar */}
      <div className="relative ml-1" ref={userRef}>
        <button
          onClick={() => { setShowUser(v => !v); setShowNotifs(false) }}
          className="flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-xs select-none">
            {adminName.slice(0, 2).toUpperCase()}
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
        </button>

        {showUser && (
          <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-900">{adminName}</p>
              <p className="text-xs text-gray-400 mt-0.5 truncate">{adminEmail}</p>
            </div>
            <div className="py-1">
              <button
                onClick={() => { setShowUser(false); navigate('/admin/profile') }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
              >
                <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                Perfil
              </button>
              <button
                onClick={() => { setShowUser(false); navigate('/admin/profile#security') }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
              >
                <Shield className="w-4 h-4 text-gray-400 flex-shrink-0" />
                Seguridad
              </button>
              <div className="border-t border-gray-100 my-1" />
              <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors text-left">
                <LogOut className="w-4 h-4 flex-shrink-0" />
                Cerrar sesión
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
