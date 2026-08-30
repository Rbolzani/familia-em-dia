import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { destinoInternoSeguro } from '@/lib/redirectSeguro'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = destinoInternoSeguro(searchParams.get('next') ?? searchParams.get('redirect'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: families } = await supabase.rpc('get_my_families')
        if (!families || families.length === 0) {
          const { data: membership } = await supabase
            .from('family_members')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle()
          if (!membership) {
            const familyName: string =
              (user.user_metadata?.family_name as string | undefined)?.trim() || 'Minha Família'
            await supabase.rpc('create_my_family', { p_name: familyName })
          }
        }

        return NextResponse.redirect(`${origin}${next}`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=auth_error`)
}
