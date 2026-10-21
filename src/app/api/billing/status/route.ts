import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getFamilyPlan, getAiUsageThisMonth, PLAN_LIMITS } from '@/lib/billing'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const plan = await getFamilyPlan()
  const limits = PLAN_LIMITS[plan]
  const aiUsed = await getAiUsageThisMonth(user.id)

  return NextResponse.json({
    plan,
    voice: limits.voice,
    pausada: plan === 'pausada',
    children: { limit: limits.children },
    ai: {
      used: aiUsed,
      limit: limits.aiPerMonth === Infinity ? null : limits.aiPerMonth,
      remaining: limits.aiPerMonth === Infinity ? null : Math.max(0, limits.aiPerMonth - aiUsed),
    },
  })
}
