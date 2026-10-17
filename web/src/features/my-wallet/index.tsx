import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { HupijiaoPaymentDialog } from '@/components/payment/hupijiao-payment-dialog'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PaymentConfirmDialog } from '@/features/wallet/components/dialogs/payment-confirm-dialog'
import { PAYMENT_TYPES } from '@/features/wallet/constants'

import { AffiliateTab } from './components/affiliate-tab'
import { BalanceStatsCard } from './components/balance-stats-card'
import { RechargeTab } from './components/recharge-tab'
import { SubscriptionTab } from './components/subscription-tab'
import { TransferDialog } from './components/transfer-dialog'
import { type WalletTab, useMyWallet } from './hooks/use-my-wallet'
import { useSubscriptionSavings } from './hooks/use-subscription-savings'

interface MyWalletProps {
  initialTab?: WalletTab
}

export function MyWallet(props: MyWalletProps) {
  const { t } = useTranslation()
  const wallet = useMyWallet(props.initialTab)
  const subscriptionSavings = useSubscriptionSavings(wallet.rechargePricing)
  const savingsPercent = Math.floor(subscriptionSavings.maxSavings * 100)

  const alipayMethod = useMemo(
    () => ({
      type: PAYMENT_TYPES.ALIPAY,
      name: t('Alipay'),
      color: '#1677FF',
    }),
    [t]
  )

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Wallet')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-5'>
            <BalanceStatsCard user={wallet.user} loading={wallet.userLoading} />

            <Tabs
              value={wallet.activeTab}
              onValueChange={(value) =>
                wallet.setActiveTab(
                  (value as 'recharge' | 'subscription' | 'affiliate') ||
                    'recharge'
                )
              }
              className='gap-4'
            >
              <div className='overflow-x-auto pt-2 pr-2 pb-1'>
                <TabsList className='min-w-max p-1 group-data-horizontal/tabs:h-auto'>
                  <TabsTrigger
                    value='recharge'
                    className='h-auto! flex-col items-center gap-1.5 px-5 py-2.5'
                  >
                    <span className='text-base leading-none font-semibold'>
                      {t('Recharge')}
                    </span>
                    <span className='text-muted-foreground text-[11px] leading-none font-normal'>
                      {t('Flexible pay-as-you-go')}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value='subscription'
                    className='relative h-auto! flex-col items-center gap-1.5 px-5 py-2.5'
                  >
                    <span className='text-base leading-none font-semibold'>
                      {t('GPT Subscription')}
                    </span>
                    <span className='text-muted-foreground text-[11px] leading-none font-normal'>
                      {t('GPT only · plan quota')}
                    </span>
                    {savingsPercent > 0 && (
                      <Badge
                        data-slot='subscription-savings-badge'
                        variant='destructive'
                        className='bg-destructive text-destructive-foreground absolute -top-2 -right-2 h-4 px-1.5 text-[10px] leading-none'
                      >
                        {t('Save up to {{percent}}%', {
                          percent: savingsPercent,
                        })}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value='affiliate'
                    className='h-auto! flex-col items-center gap-1.5 px-5 py-2.5'
                  >
                    <span className='text-base leading-none font-semibold'>
                      {t('Referral Program')}
                    </span>
                    <span className='text-muted-foreground text-[11px] leading-none font-normal'>
                      {t('Invite to earn rewards')}
                    </span>
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value='subscription' className='mt-0'>
                <SubscriptionTab
                  topupInfo={wallet.topupInfo}
                  planSavings={subscriptionSavings.byPlan}
                  comparisonGroup={subscriptionSavings.comparisonGroup}
                  onPurchaseComplete={wallet.refreshUser}
                />
              </TabsContent>

              <TabsContent value='recharge' className='mt-0'>
                <RechargeTab
                  onlinePaymentEnabled={wallet.onlinePaymentEnabled}
                  presetAmounts={wallet.presetAmounts}
                  selectedPreset={wallet.selectedPreset}
                  onSelectPreset={wallet.handleSelectPreset}
                  topupAmount={wallet.topupAmount}
                  onTopupAmountChange={wallet.handleTopupAmountChange}
                  paymentAmount={wallet.paymentAmount}
                  calculating={wallet.calculating}
                  minTopup={wallet.minTopup}
                  priceRatio={wallet.priceRatio}
                  paymentLoading={wallet.paymentLoading}
                  onAlipayClick={wallet.handleAlipayClick}
                  redemptionCode={wallet.redemptionCode}
                  onRedemptionCodeChange={wallet.setRedemptionCode}
                  onRedeem={wallet.handleRedeem}
                  redeeming={wallet.redeeming}
                  redemptionEnabled={wallet.redemptionEnabled}
                  loading={wallet.topupLoading}
                />
              </TabsContent>

              <TabsContent value='affiliate' className='mt-0'>
                <AffiliateTab
                  user={wallet.user}
                  affiliateLink={wallet.affiliateLink}
                  onTransfer={() => wallet.setTransferDialogOpen(true)}
                  complianceConfirmed={wallet.complianceConfirmed}
                  loading={wallet.affiliateLoading}
                />
              </TabsContent>
            </Tabs>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <PaymentConfirmDialog
        open={wallet.confirmDialogOpen}
        onOpenChange={wallet.setConfirmDialogOpen}
        onConfirm={wallet.handlePaymentConfirm}
        topupAmount={wallet.topupAmount}
        paymentAmount={wallet.paymentAmount}
        paymentMethod={alipayMethod}
        calculating={wallet.calculating}
        processing={wallet.paymentProcessing}
        discountRate={wallet.discountRate}
        usdExchangeRate={1}
      />

      <TransferDialog
        open={wallet.transferDialogOpen}
        onOpenChange={wallet.setTransferDialogOpen}
        onConfirm={wallet.handleTransfer}
        availableQuota={wallet.user?.aff_quota ?? 0}
        transferring={wallet.transferring}
      />

      <HupijiaoPaymentDialog
        open={wallet.hupijiaoDialogOpen}
        onOpenChange={wallet.setHupijiaoDialogOpen}
        payment={wallet.hupijiaoPayment}
        amount={wallet.paymentAmount}
        onExpired={() => {
          wallet.setHupijiaoDialogOpen(false)
          wallet.setHupijiaoPayment(null)
        }}
      />
    </>
  )
}
