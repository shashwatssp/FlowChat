'use client';

import BotList from '@/components/dashboard/BotList';

/**
 * Dashboard home route.
 *
 * The persistent sidebar navigation and auth gating live in
 * `app/dashboard/layout.tsx`. This page is intentionally thin: it renders the
 * page title and delegates all bot management (list, create, rename, delete,
 * configure) to the reusable `<BotList />` component.
 */
export default function DashboardPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Your Bots</h1>
      </div>
      <BotList />
    </div>
  );
}
