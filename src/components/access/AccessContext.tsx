'use client'
import React, { createContext, useContext } from 'react'
import type { Access } from '@/lib/access'

const AccessCtx = createContext<Access>({
  role: 'owner', isOwner: true, isPartner: false,
  canEdit: true, canLogistics: true, ownerName: null, pausada: false,
})

export function AccessProvider({ value, children }: { value: Access; children: React.ReactNode }) {
  return <AccessCtx.Provider value={value}>{children}</AccessCtx.Provider>
}

/** Acesso efetivo do usuário logado. Use para gatear botões na UI. */
export function useAccess(): Access {
  return useContext(AccessCtx)
}
