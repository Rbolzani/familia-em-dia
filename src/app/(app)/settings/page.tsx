import { fundadorLogado } from '@/lib/admin'
import SettingsClient from './SettingsClient'

export default async function SettingsPage() {
  return <SettingsClient isAdmin={(await fundadorLogado()) !== null} />
}
