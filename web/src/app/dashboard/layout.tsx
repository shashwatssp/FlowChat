'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import DashboardNav from '@/components/layouts/DashboardNav';

/**
 * Shared layout for every route under /dashboard.
 * Renders the persistent sidebar navigation (brand + nav links + logout)
 * and a scrollable content area. Also guards authentication so individual
 * pages no longer need to repeat the token check / redirect boilerplate.
 */
export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
    }
  }, [router]);

  return (
    <div className="flex min-h-screen bg-gray-50">
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
