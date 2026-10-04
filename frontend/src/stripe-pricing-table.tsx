import { createElement, useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from './components/ui/button';

type Config = {
  publishableKey: string;
  personalMonthlyTableId: string;
  personalAnnualTableId: string;
  businessMonthlyTableId: string;
  businessAnnualTableId: string;
};
type State = { status: 'loading' | 'unavailable' | 'error' } | { status: 'ready'; config: Config };
const scriptURL = 'https://js.stripe.com/v3/pricing-table.js';
let scriptReady: Promise<void> | undefined;

function loadStripePricingTable() {
  if (customElements.get('stripe-pricing-table')) return Promise.resolve();
  if (!scriptReady) {
    scriptReady = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = scriptURL;
      script.async = true;
      let settled = false;
      const timeout = window.setTimeout(failed, 15000);
      function failed() {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        script.onerror = null;
        script.onload = null;
        script.remove();
        reject(new Error('Pricing table script unavailable'));
      }
      script.onerror = failed;
      script.onload = () => {
        // Registration may finish after the script's load event. Keep the same
        // deadline so a downloaded script that never registers cannot hang.
        void customElements.whenDefined('stripe-pricing-table').then(() => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          script.onerror = null;
          script.onload = null;
          resolve();
        });
      };
      document.head.append(script);
    }).catch((error: unknown) => {
      scriptReady = undefined;
      throw error;
    });
  }
  return scriptReady;
}

function readConfig(value: unknown): Config | undefined {
  if (!value || typeof value !== 'object') return;
  const config = value as Partial<Config>;
  // This preview must not become live checkout through a configuration change.
  if (
    typeof config.publishableKey !== 'string' ||
    !/^pk_test_[A-Za-z0-9]+$/.test(config.publishableKey)
  )
    return;
  const tableId = (id: unknown) =>
    typeof id === 'string' && /^prctbl_[A-Za-z0-9]+$/.test(id) ? id : '';
  const tables = {
    personalMonthlyTableId: tableId(config.personalMonthlyTableId),
    personalAnnualTableId: tableId(config.personalAnnualTableId),
    businessMonthlyTableId: tableId(config.businessMonthlyTableId),
    businessAnnualTableId: tableId(config.businessAnnualTableId),
  };
  if (!Object.values(tables).some(Boolean)) return;
  return { publishableKey: config.publishableKey, ...tables };
}

export function StripePricingTable({
  audience,
  billingInterval,
}: {
  audience: 'personal' | 'business';
  billingInterval: 'monthly' | 'annual';
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      try {
        const response = await fetch('/stripe-pricing.json', {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
          cache: 'no-cache',
        });
        if (!response.ok) throw new Error('Pricing configuration unavailable');
        const config = readConfig(await response.json());
        if (!active) return;
        if (!config) return setState({ status: 'unavailable' });
        await loadStripePricingTable();
        if (active) setState({ status: 'ready', config });
      } catch {
        if (active) setState({ status: 'error' });
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt]);

  const tableKey =
    `${audience}${billingInterval === 'monthly' ? 'Monthly' : 'Annual'}TableId` as const;
  const tableId = state.status === 'ready' ? state.config[tableKey] : '';
  return (
    <div
      className="min-w-0"
      role="region"
      aria-label={`${audience === 'personal' ? 'Personal' : 'Business'} ${billingInterval} plans`}
    >
      {state.status === 'ready' && tableId ? (
        <>
          {audience === 'personal' && (
            <p className="text-center text-sm font-semibold text-[#0f2d5b]">
              7-day free trial · Payment method required
            </p>
          )}
          <p className="mb-5 mt-2 text-center text-sm text-[#526780]">
            Test mode. Test checkout does not activate trial or paid access in Whumpo.
          </p>
          {createElement('stripe-pricing-table', {
            key: tableId,
            'pricing-table-id': tableId,
            'publishable-key': state.config.publishableKey,
          })}
        </>
      ) : (
        <div className="flex h-full min-h-80 flex-col items-center justify-center rounded-xl border border-[#dce6ef] bg-white p-8 text-center">
          <p role="status" className="text-xl font-bold">
            {state.status === 'loading'
              ? 'Loading plans…'
              : state.status === 'error'
                ? 'Plans could not load'
                : 'Plans are coming soon'}
          </p>
          <p className="mt-4 max-w-md text-sm text-[#526780]">
            The invite-only preview is free. Explore Whumpo while we prepare our paid plans.
          </p>
          {state.status === 'error' && (
            <Button
              type="button"
              variant="outline"
              className="mt-6 rounded-full"
              onClick={() => {
                setState({ status: 'loading' });
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </Button>
          )}
          <Button asChild variant="outline" className="mt-6 rounded-full bg-white">
            <Link to="/workspace" search={{ signup: true }}>
              Explore with an invite
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
