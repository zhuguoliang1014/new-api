/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getApiKeys } from '@/features/keys/api'
import type { ApiKey } from '@/features/keys/types'
import { getUserModels } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { getPlaygroundAgentConfig, savePlaygroundAgentConfig } from '../api'

function isUsableKey(key: ApiKey): boolean {
  return (
    key.status === 1 &&
    (key.expired_time === -1 ||
      key.expired_time > Math.floor(Date.now() / 1000)) &&
    (key.unlimited_quota || key.remain_quota > 0)
  )
}

export function useStudioAgentConfig(loadChoices = true) {
  const queryClient = useQueryClient()
  const scope = useAuthStore((state) => state.auth.session?.sid)
  const configQuery = useQuery({
    queryKey: ['image-playground', 'agent-config', scope],
    queryFn: getPlaygroundAgentConfig,
    enabled: Boolean(scope),
    staleTime: 60 * 1000,
  })
  const keysQuery = useQuery({
    queryKey: ['image-playground', 'api-keys', scope],
    enabled: loadChoices && Boolean(scope),
    queryFn: async () => {
      const response = requireServerSuccess(
        await getApiKeys({ p: 1, size: 100 })
      )
      return response.data?.items ?? []
    },
    staleTime: 60 * 1000,
  })
  const modelsQuery = useQuery({
    queryKey: ['image-playground', 'models', scope],
    enabled: loadChoices && Boolean(scope),
    queryFn: async () => {
      const response = requireServerSuccess(await getUserModels())
      return response.data ?? []
    },
    staleTime: 5 * 60 * 1000,
  })
  const saveMutation = useMutation({
    mutationFn: savePlaygroundAgentConfig,
    onSuccess: (config) => {
      queryClient.setQueryData(
        ['image-playground', 'agent-config', scope],
        config
      )
    },
  })
  return {
    config: configQuery.data ?? null,
    keys: (keysQuery.data ?? []).filter(isUsableKey),
    models: modelsQuery.data ?? [],
    isLoading:
      configQuery.isLoading || keysQuery.isLoading || modelsQuery.isLoading,
    isSaving: saveMutation.isPending,
    save: saveMutation.mutateAsync,
    saveError: saveMutation.error,
  }
}
