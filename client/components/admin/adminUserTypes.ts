import type { UserRole } from '@/lib/users'

export type AdminUserStatus = 'active' | 'suspended' | 'deleted'

export interface AdminUserListItem {
  user_id: string
  name: string | null
  email: string
  role: UserRole
  status: AdminUserStatus
  avatar_url: string | null
  created_at: string | null
  last_active_at: string | null
  last_login_at: string | null
  places_added: number
  reports_count: number
}

export interface AdminUserDetail extends AdminUserListItem {
  has_password: boolean
  home_country: string | null
  lang: string | null
}

export interface UsersListResponse {
  items: AdminUserListItem[]
  total: number
  page: number
}
