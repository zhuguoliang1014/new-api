import { zodResolver } from '@hookform/resolvers/zod'
import {
  Add01Icon,
  Delete02Icon,
  GitCompareIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { SettingsPageFormActions } from '@/features/system-settings/components/settings-page-context'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { useUpdateOption } from '@/features/system-settings/hooks/use-update-option'
import { safeNumberFieldProps } from '@/features/system-settings/utils/numeric-field'
import { cn } from '@/lib/utils'

import type {
  ChannelHealthAlertCondition,
  ChannelHealthAlertRule,
  CustomIntegrationSettings,
} from './types'

const metricOptions = [
  'total_count',
  'request_count',
  'success_count',
  'error_count',
  'error_rate',
  'success_rate',
  'avg_ttft_ms',
  'p95_ttft_ms',
  'max_ttft_ms',
  'avg_latency_ms',
  'p95_latency_ms',
  'max_latency_ms',
] as const

const operatorOptions = ['>=', '>', '<=', '<', '==', '!='] as const

const formSchema = z.object({
  enabled: z.boolean(),
  check_interval_seconds: z.coerce.number().min(15),
  wechat_group_ids: z.string().min(1),
})

type FormValues = z.infer<typeof formSchema>
type FormInput = z.input<typeof formSchema>

type Props = {
  defaultValues: CustomIntegrationSettings
}

function createLeafCondition(): ChannelHealthAlertCondition {
  return { metric: 'total_count', op: '>=', value: 10 }
}

function createGroupCondition(
  type: 'and' | 'or' = 'and'
): ChannelHealthAlertCondition {
  return { [type]: [createLeafCondition()] }
}

function normalizeCondition(
  condition: ChannelHealthAlertCondition | undefined
): ChannelHealthAlertCondition {
  if (!condition) return createGroupCondition()
  if (Array.isArray(condition.and)) {
    return { and: condition.and.map(normalizeCondition) }
  }
  if (Array.isArray(condition.or)) {
    return { or: condition.or.map(normalizeCondition) }
  }
  return {
    metric: metricOptions.includes(
      condition.metric as (typeof metricOptions)[number]
    )
      ? condition.metric
      : 'total_count',
    op: operatorOptions.includes(
      condition.op as (typeof operatorOptions)[number]
    )
      ? condition.op
      : '>=',
    value: Number.isFinite(condition.value) ? condition.value : 0,
  }
}

function normalizeRules(
  rules: ChannelHealthAlertRule[]
): ChannelHealthAlertRule[] {
  return rules.map((rule) => ({
    id: rule.id || crypto.randomUUID(),
    name: rule.name || '',
    enabled: rule.enabled !== false,
    window_minutes: Math.max(1, Number(rule.window_minutes) || 5),
    cooldown_minutes: Math.max(1, Number(rule.cooldown_minutes) || 15),
    scope: {
      channel_ids: rule.scope?.channel_ids ?? [],
      models: rule.scope?.models ?? [],
      groups: rule.scope?.groups ?? [],
    },
    condition: normalizeCondition(rule.condition),
  }))
}

function parseNumberList(value: string): number[] {
  return value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0)
}

function parseStringList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatNumberList(values: number[] | undefined): string {
  return (values ?? []).join(', ')
}

function formatStringList(values: string[] | undefined): string {
  return (values ?? []).join(', ')
}

function isGroupCondition(condition: ChannelHealthAlertCondition): boolean {
  return Array.isArray(condition.and) || Array.isArray(condition.or)
}

type ConditionEditorProps = {
  condition: ChannelHealthAlertCondition
  depth?: number
  path: string
  onChange: (condition: ChannelHealthAlertCondition) => void
  onRemove?: () => void
}

function ConditionEditor(props: ConditionEditorProps) {
  const { t } = useTranslation()
  const depth = props.depth ?? 0
  const groupType = Array.isArray(props.condition.or) ? 'or' : 'and'
  const children = props.condition[groupType] ?? []

  if (!isGroupCondition(props.condition)) {
    return (
      <div className='border-border bg-background grid gap-2 rounded-lg border p-2 md:grid-cols-[minmax(0,1.4fr)_7rem_minmax(6rem,0.8fr)_auto]'>
        <Select
          value={props.condition.metric ?? 'total_count'}
          onValueChange={(value) => {
            if (value) props.onChange({ ...props.condition, metric: value })
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {metricOptions.map((metric) => (
                <SelectItem key={metric} value={metric}>
                  {t(metric)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          value={props.condition.op ?? '>='}
          onValueChange={(value) => {
            if (value) props.onChange({ ...props.condition, op: value })
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {operatorOptions.map((operator) => (
                <SelectItem key={operator} value={operator}>
                  {operator}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Input
          type='number'
          value={props.condition.value ?? 0}
          onChange={(event) =>
            props.onChange({
              ...props.condition,
              value: Number(event.target.value),
            })
          }
        />
        {props.onRemove && (
          <Button
            type='button'
            variant='ghost'
            size='icon'
            onClick={props.onRemove}
            aria-label={t('Remove condition')}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
        )}
      </div>
    )
  }

  const updateChild = (
    index: number,
    childCondition: ChannelHealthAlertCondition
  ) => {
    const nextChildren = [...children]
    nextChildren[index] = childCondition
    props.onChange({ [groupType]: nextChildren })
  }

  const removeChild = (index: number) => {
    const nextChildren = children.filter(
      (_, childIndex) => childIndex !== index
    )
    props.onChange({
      [groupType]:
        nextChildren.length > 0 ? nextChildren : [createLeafCondition()],
    })
  }

  const switchGroupType = (value: string | null) => {
    if (!value) return
    const nextType = value === 'or' ? 'or' : 'and'
    props.onChange({ [nextType]: children })
  }

  return (
    <div
      className={cn(
        'border-border bg-muted/20 flex flex-col gap-2 rounded-lg border p-3',
        depth > 0 && 'bg-background'
      )}
    >
      <div className='flex flex-wrap items-center gap-2'>
        <Select value={groupType} onValueChange={switchGroupType}>
          <SelectTrigger className='w-28'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              <SelectItem value='and'>AND</SelectItem>
              <SelectItem value='or'>OR</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() =>
            props.onChange({
              [groupType]: [...children, createLeafCondition()],
            })
          }
        >
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          {t('Condition')}
        </Button>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() =>
            props.onChange({
              [groupType]: [...children, createGroupCondition('and')],
            })
          }
        >
          <HugeiconsIcon icon={GitCompareIcon} strokeWidth={2} />
          {t('Group')}
        </Button>
        {props.onRemove && (
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            onClick={props.onRemove}
            aria-label={t('Remove group')}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
        )}
      </div>
      <div className='flex flex-col gap-2'>
        {children.map((child, index) => {
          const childPath = `${props.path}.${groupType}.${index}`
          return (
            <ConditionEditor
              key={childPath}
              condition={child}
              depth={depth + 1}
              path={childPath}
              onChange={(nextCondition) => updateChild(index, nextCondition)}
              onRemove={() => removeChild(index)}
            />
          )
        })}
      </div>
    </div>
  )
}

export function ChannelHealthAlertSection(props: Props) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [rules, setRules] = useState<ChannelHealthAlertRule[]>(
    normalizeRules(props.defaultValues['channel_health_alert_setting.rules'])
  )
  const [ruleKeys, setRuleKeys] = useState<string[]>(() =>
    props.defaultValues['channel_health_alert_setting.rules'].map(() =>
      crypto.randomUUID()
    )
  )
  const baselineRef = useRef({
    enabled: props.defaultValues['channel_health_alert_setting.enabled'],
    check_interval_seconds:
      props.defaultValues[
        'channel_health_alert_setting.check_interval_seconds'
      ],
    wechat_group_ids:
      props.defaultValues['channel_health_alert_setting.wechat_group_ids'],
    rules: normalizeRules(
      props.defaultValues['channel_health_alert_setting.rules']
    ),
  })

  const formDefaults = useMemo(
    () => ({
      enabled: props.defaultValues['channel_health_alert_setting.enabled'],
      check_interval_seconds:
        props.defaultValues[
          'channel_health_alert_setting.check_interval_seconds'
        ],
      wechat_group_ids:
        props.defaultValues['channel_health_alert_setting.wechat_group_ids'],
    }),
    [props.defaultValues]
  )

  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: formDefaults,
  })

  useEffect(() => {
    const normalizedRules = normalizeRules(
      props.defaultValues['channel_health_alert_setting.rules']
    )
    setRules(normalizedRules)
    setRuleKeys(normalizedRules.map(() => crypto.randomUUID()))
    form.reset(formDefaults)
    baselineRef.current = {
      enabled: props.defaultValues['channel_health_alert_setting.enabled'],
      check_interval_seconds:
        props.defaultValues[
          'channel_health_alert_setting.check_interval_seconds'
        ],
      wechat_group_ids:
        props.defaultValues['channel_health_alert_setting.wechat_group_ids'],
      rules: normalizedRules,
    }
  }, [form, formDefaults, props.defaultValues])

  const updateRule = (index: number, nextRule: ChannelHealthAlertRule) => {
    setRules((currentRules) =>
      currentRules.map((rule, ruleIndex) =>
        ruleIndex === index ? nextRule : rule
      )
    )
  }

  const addRule = () => {
    setRuleKeys((currentKeys) => [...currentKeys, crypto.randomUUID()])
    setRules((currentRules) => [
      ...currentRules,
      {
        id: crypto.randomUUID(),
        name: t('New alert rule'),
        enabled: true,
        window_minutes: 5,
        cooldown_minutes: 15,
        scope: {},
        condition: createGroupCondition('and'),
      },
    ])
  }

  const removeRule = (index: number) => {
    setRuleKeys((currentKeys) =>
      currentKeys.filter((_, ruleIndex) => ruleIndex !== index)
    )
    setRules((currentRules) =>
      currentRules.filter((_, ruleIndex) => ruleIndex !== index)
    )
  }

  const onSubmit = async (values: FormValues) => {
    const normalizedRules = normalizeRules(rules)
    const updates: Array<{ key: string; value: string | boolean | number }> = []
    const baseline = baselineRef.current

    if (values.enabled !== baseline.enabled) {
      updates.push({
        key: 'channel_health_alert_setting.enabled',
        value: values.enabled,
      })
    }
    if (values.check_interval_seconds !== baseline.check_interval_seconds) {
      updates.push({
        key: 'channel_health_alert_setting.check_interval_seconds',
        value: values.check_interval_seconds,
      })
    }
    if (values.wechat_group_ids !== baseline.wechat_group_ids) {
      updates.push({
        key: 'channel_health_alert_setting.wechat_group_ids',
        value: values.wechat_group_ids,
      })
    }
    if (JSON.stringify(normalizedRules) !== JSON.stringify(baseline.rules)) {
      updates.push({
        key: 'channel_health_alert_setting.rules',
        value: JSON.stringify(normalizedRules),
      })
    }

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const update of updates) {
      await updateOption.mutateAsync(update)
    }

    baselineRef.current = { ...values, rules: normalizedRules }
    setRules(normalizedRules)
  }

  return (
    <SettingsSection title={t('Channel health alerts')}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <FormItem className='border-border flex flex-row items-center justify-between rounded-lg border p-4'>
                <div className='space-y-0.5'>
                  <FormLabel className='text-base'>
                    {t('Enable channel health alerts')}
                  </FormLabel>
                  <FormDescription>
                    {t(
                      'Send WeChat alerts when channel log metrics match a rule.'
                    )}
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <FormField
              control={form.control}
              name='check_interval_seconds'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Check interval (seconds)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={15}
                      step={1}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('The monitor checks logs at this cadence.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='wechat_group_ids'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Alert WeChat group IDs')}</FormLabel>
                  <FormControl>
                    <Input placeholder='57047022764@chatroom' {...field} />
                  </FormControl>
                  <FormDescription>
                    {t('Comma-separated WeChat groups for channel alerts.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className='flex items-center justify-between gap-3'>
            <div>
              <h4 className='font-medium'>{t('Advanced alert rules')}</h4>
              <p className='text-muted-foreground mt-1 text-xs'>
                {t('Build AND/OR conditions from channel log metrics.')}
              </p>
            </div>
            <Button type='button' variant='outline' onClick={addRule}>
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
              {t('Add rule')}
            </Button>
          </div>

          <div className='flex flex-col gap-4'>
            {rules.map((rule, index) => (
              <div
                key={ruleKeys[index] ?? rule.id}
                className='border-border flex flex-col gap-4 rounded-lg border p-4'
              >
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  <div className='flex min-w-0 items-center gap-3'>
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={(checked) =>
                        updateRule(index, { ...rule, enabled: checked })
                      }
                    />
                    <div className='min-w-0'>
                      <div className='truncate text-sm font-medium'>
                        {rule.name || t('Unnamed rule')}
                      </div>
                      <div className='text-muted-foreground truncate text-xs'>
                        {rule.id}
                      </div>
                    </div>
                  </div>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    onClick={() => removeRule(index)}
                    aria-label={t('Remove rule')}
                  >
                    <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                  </Button>
                </div>

                <div className='grid grid-cols-1 gap-3 md:grid-cols-4'>
                  <div className='space-y-1.5'>
                    <FormLabel>{t('Rule name')}</FormLabel>
                    <Input
                      value={rule.name}
                      onChange={(event) =>
                        updateRule(index, {
                          ...rule,
                          name: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <FormLabel>{t('Rule ID')}</FormLabel>
                    <Input
                      value={rule.id}
                      onChange={(event) =>
                        updateRule(index, {
                          ...rule,
                          id: event.target.value.trim(),
                        })
                      }
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <FormLabel>{t('Window (minutes)')}</FormLabel>
                    <Input
                      type='number'
                      min={1}
                      value={rule.window_minutes}
                      onChange={(event) =>
                        updateRule(index, {
                          ...rule,
                          window_minutes: Number(event.target.value),
                        })
                      }
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <FormLabel>{t('Cooldown (minutes)')}</FormLabel>
                    <Input
                      type='number'
                      min={1}
                      value={rule.cooldown_minutes}
                      onChange={(event) =>
                        updateRule(index, {
                          ...rule,
                          cooldown_minutes: Number(event.target.value),
                        })
                      }
                    />
                  </div>
                </div>

                <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
                  <div className='space-y-1.5'>
                    <FormLabel>{t('Channel IDs')}</FormLabel>
                    <Input
                      value={formatNumberList(rule.scope?.channel_ids)}
                      placeholder='1, 2, 3'
                      onChange={(event) =>
                        updateRule(index, {
                          ...rule,
                          scope: {
                            ...rule.scope,
                            channel_ids: parseNumberList(event.target.value),
                          },
                        })
                      }
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <FormLabel>{t('Models')}</FormLabel>
                    <Input
                      value={formatStringList(rule.scope?.models)}
                      placeholder='gpt-4o, claude-sonnet-4'
                      onChange={(event) =>
                        updateRule(index, {
                          ...rule,
                          scope: {
                            ...rule.scope,
                            models: parseStringList(event.target.value),
                          },
                        })
                      }
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <FormLabel>{t('Groups')}</FormLabel>
                    <Input
                      value={formatStringList(rule.scope?.groups)}
                      placeholder='default, vip'
                      onChange={(event) =>
                        updateRule(index, {
                          ...rule,
                          scope: {
                            ...rule.scope,
                            groups: parseStringList(event.target.value),
                          },
                        })
                      }
                    />
                  </div>
                </div>

                <div className='space-y-2'>
                  <FormLabel>{t('Condition tree')}</FormLabel>
                  <ConditionEditor
                    condition={rule.condition}
                    path={`rule.${ruleKeys[index] ?? index}.condition`}
                    onChange={(condition) =>
                      updateRule(index, { ...rule, condition })
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </form>
      </Form>
    </SettingsSection>
  )
}
