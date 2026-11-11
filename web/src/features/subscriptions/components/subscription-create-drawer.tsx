import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DateTimePicker } from '@/components/datetime-picker'
import {
  SideDrawerSection,
  SideDrawerSectionHeader,
  sideDrawerContentClassName,
  sideDrawerHeaderClassName,
  sideDrawerFormClassName,
  sideDrawerFooterClassName,
} from '@/components/drawer-layout'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
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
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { createPlan, getGroups, updatePlan } from '../api'
import {
  getPlanCreateFormSchema,
  PLAN_CREATE_FORM_DEFAULTS,
  planToCreateFormValues,
  createFormValuesToPayload,
  type PlanCreateFormValues,
} from '../lib'
import type { PlanRecord } from '../types'
import { PlanAdvancedFields } from './plan-advanced-fields'
import { PlanPricingFields } from './plan-pricing-fields'
import { PlanPromotionFields } from './plan-promotion-fields'
import { useSubscriptions } from './subscriptions-provider'

const NEW_GPT_MONTHLY_PLAN: PlanCreateFormValues = {
  ...PLAN_CREATE_FORM_DEFAULTS,
  enabled: false,
  allowed_channel_types: [1],
  pricing_ratio: 0.29,
  minimum_effective_ratio: 0.18,
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: PlanRecord
}

export function SubscriptionCreateDrawer({
  open,
  onOpenChange,
  currentRow,
}: Props) {
  const { t } = useTranslation()
  const isEdit = !!currentRow?.plan?.id
  const { triggerRefresh } = useSubscriptions()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [groupOptions, setGroupOptions] = useState<string[]>([])

  const quotaPerUnit = useSystemConfigStore(
    (s) => s.config.currency.quotaPerUnit || 500000
  )

  const schema = getPlanCreateFormSchema(t)
  const form = useForm<PlanCreateFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<PlanCreateFormValues>,
    defaultValues: NEW_GPT_MONTHLY_PLAN,
  })

  useEffect(() => {
    if (open) {
      setAdvancedOpen(false)
      if (currentRow?.plan) {
        form.reset(planToCreateFormValues(currentRow.plan, quotaPerUnit))
      } else {
        form.reset(NEW_GPT_MONTHLY_PLAN)
      }
      getGroups()
        .then((res) => {
          if (res.success) setGroupOptions(res.data || [])
        })
        .catch(() => {})
    }
  }, [open, currentRow, form, quotaPerUnit])

  const usdQuotaAmount = form.watch('price_amount')
  const pricingQuotaUSD =
    currentRow?.plan && Number(usdQuotaAmount) === currentRow.plan.price_amount
      ? currentRow.plan.total_amount / quotaPerUnit
      : Number(usdQuotaAmount || 0)

  const onSubmit = async (values: PlanCreateFormValues) => {
    // 促销窗口校验：结束时间必须晚于开始时间（两者都设置的情况下）
    if (
      values.starts_at &&
      values.expires_at &&
      values.expires_at <= values.starts_at
    ) {
      toast.error(t('Sale end time must be later than start time'))
      return
    }

    setIsSubmitting(true)
    try {
      const payload = createFormValuesToPayload(
        values,
        quotaPerUnit,
        currentRow?.plan
      )
      if (isEdit && currentRow?.plan?.id) {
        const res = requireServerSuccess(
          await updatePlan(currentRow.plan.id, payload)
        )
        if (res.success) {
          toast.success(t('Update succeeded'))
          onOpenChange(false)
          triggerRefresh()
        }
      } else {
        const res = requireServerSuccess(await createPlan(payload))
        if (res.success) {
          toast.success(t('Create succeeded'))
          onOpenChange(false)
          triggerRefresh()
        }
      }
    } catch (error) {
      handleServerError(error, t('Request failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const onInvalid = (errors: FieldErrors<PlanCreateFormValues>) => {
    const visible = new Set([
      'title',
      'subtitle',
      'price_cny',
      'price_amount',
      'pricing_ratio',
      'discount_rate',
      'discount_starts_at',
      'discount_ends_at',
      'enabled',
      'limited_sale',
      'sales_limit',
      'max_purchase_per_user',
    ])
    if (Object.keys(errors).some((key) => !visible.has(key))) {
      setAdvancedOpen(true)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) form.reset()
      }}
    >
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[680px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {isEdit ? t('Update plan info') : t('Create new subscription plan')}
          </SheetTitle>
          <SheetDescription>
            {isEdit
              ? t(
                  'Update future purchases. Existing subscriptions keep their original terms.'
                )
              : t(
                  'Set a regular price, choose a multiplier, then add a promotion if needed.'
                )}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            id='subscription-create-form'
            onSubmit={form.handleSubmit(onSubmit, onInvalid)}
            className={sideDrawerFormClassName()}
          >
            <SideDrawerSection>
              <SideDrawerSectionHeader
                title={t('Basic Info')}
                description={t('Give the plan a name customers can recognize.')}
              />
              <FormField
                control={form.control}
                name='title'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Plan Title')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t('e.g. Basic Plan')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='subtitle'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Plan Subtitle')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t('e.g. Suitable for light usage')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SideDrawerSection>
            <SideDrawerSection>
              <PlanPricingFields
                key={`${open}-${currentRow?.plan.id ?? 'new'}`}
                quotaUSD={pricingQuotaUSD}
                initialAutomatic={
                  !isEdit || currentRow?.plan.minimum_effective_ratio != null
                }
              />
            </SideDrawerSection>
            <SideDrawerSection>
              <PlanPromotionFields
                compact
                quotaUSD={pricingQuotaUSD}
                priceCNY={Number(form.watch('price_cny') || 0)}
                billingRatio={Number(form.watch('billing_ratio') ?? 1)}
              />
            </SideDrawerSection>
            <SideDrawerSection>
              <SideDrawerSectionHeader
                title={t('Sales & inventory')}
                description={t(
                  'Control publication, sale dates and available stock separately from discounts.'
                )}
              />
              <FormField
                control={form.control}
                name='enabled'
                render={({ field }) => (
                  <FormItem className='flex items-center justify-between gap-4'>
                    <div>
                      <FormLabel>{t('Publish plan')}</FormLabel>
                      <FormDescription>
                        {t(
                          'When off, this plan is visible to administrators only.'
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
              <FormField
                control={form.control}
                name='limited_sale'
                render={({ field }) => (
                  <FormItem className='flex items-center justify-between gap-4'>
                    <div>
                      <FormLabel>{t('Limited edition')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Enable only when you want to control the total number sold.'
                        )}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={(checked) => {
                          field.onChange(checked)
                          if (!checked) {
                            form.setValue('sales_limit', 0, {
                              shouldDirty: true,
                            })
                          }
                        }}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
                {form.watch('limited_sale') && (
                  <FormField
                    control={form.control}
                    name='sales_limit'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Total Sales Limit')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type='number'
                            min={0}
                            max={2147483647}
                            step={1}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value === ''
                                  ? 0
                                  : Number(e.target.value)
                              )
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          {form.watch('limited_sale')
                            ? t(
                                'For limited editions, 0 means no stock. Paid orders, pending payments and display sales count toward the total.'
                              )
                            : t(
                                '0 means unlimited. Paid orders, pending payments and display sales count toward this limit; gifts do not.'
                              )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name='max_purchase_per_user'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Purchase Limit')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min={0}
                          step={1}
                          onChange={(event) =>
                            field.onChange(Number(event.target.value))
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t('0 means unlimited')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <Collapsible>
                <CollapsibleTrigger
                  render={
                    <Button
                      variant='ghost'
                      className='text-muted-foreground w-full justify-between px-0'
                    />
                  }
                >
                  {t('Sale dates (optional)')}
                  <ChevronDown className='size-4' />
                </CollapsibleTrigger>
                <CollapsibleContent className='space-y-3 pt-3'>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'These dates control when purchases are allowed. Set promotion dates above to restore the regular price automatically.'
                    )}
                  </p>
                  <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
                    <FormField
                      control={form.control}
                      name='starts_at'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Sale Start Time')}</FormLabel>
                          <FormControl>
                            <DateTimePicker
                              value={
                                field.value
                                  ? new Date(field.value * 1000)
                                  : undefined
                              }
                              onChange={(date) =>
                                field.onChange(
                                  date ? Math.floor(date.getTime() / 1000) : 0
                                )
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name='expires_at'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Sale End Time')}</FormLabel>
                          <FormControl>
                            <DateTimePicker
                              value={
                                field.value
                                  ? new Date(field.value * 1000)
                                  : undefined
                              }
                              onChange={(date) =>
                                field.onChange(
                                  date ? Math.floor(date.getTime() / 1000) : 0
                                )
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </SideDrawerSection>
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger
                render={
                  <Button
                    variant='ghost'
                    className='h-auto w-full justify-between px-0 py-2 whitespace-normal'
                  />
                }
              >
                <span className='min-w-0 text-start whitespace-normal'>
                  <span className='block font-semibold'>
                    {t('Advanced Settings')}
                  </span>
                  <span className='text-muted-foreground mt-1 block text-xs font-normal'>
                    {t(
                      'Models, validity, quota resets, display sales and price floor'
                    )}
                  </span>
                </span>
                <ChevronDown className='size-4 shrink-0' />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <PlanAdvancedFields groupOptions={groupOptions} />
              </CollapsibleContent>
            </Collapsible>
          </form>
        </Form>

        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button variant='outline' />}>
            {t('Close')}
          </SheetClose>
          <Button
            form='subscription-create-form'
            type='submit'
            disabled={isSubmitting}
          >
            {isSubmitting ? t('Saving...') : t('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
