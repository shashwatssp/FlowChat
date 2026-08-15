'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Bot, MessageSquare, Database, Settings, LogOut, Menu, X } from 'lucide-react';
import { useAuthStore } from '@/lib/store';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  { href: '/dashboard/conversations', label: 'Conversations', icon: <MessageSquare size={20} /> },
  { href: '/dashboard/knowledge', label: 'Knowledge Base', icon: <Database size={20} /> },
  { href: '/dashboard/settings', label: 'Settings', icon: <Settings size={20} /> },
];

export default function DashboardNav() {
  const pathname = usePathname();
  const { logout } = useAuthStore();
  const [open, setOpen] = useState(false);

  // Shared nav links + logout button reused by the desktop sidebar and the mobile
  // overlay drawer so the two surfaces can never drift apart.
  const renderNav = () => (
    <>
      <ul className="space-y-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t mt-6 pt-4">
        <button
          onClick={logout}
          className="flex items-center gap-3 w-full px-3 py-2 text-sm font-medium text-gray-600 rounded-lg hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          <LogOut size={20} />
          Logout
        </button>
      </div>
    </>
  );

  // Close the mobile drawer with the Escape key for accessibility
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      {/* Mobile: fixed top bar — hamburger on the left, brand after it */}
      <div className="sm:hidden fixed top-0 left-0 right-0 z-30 bg-white border-b px-4 py-3 flex items-center justify-start gap-3">
        <button
          onClick={() => setOpen(true)}
          className="p-3 text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100 min-w-11 min-h-11 flex items-center justify-center"
          title="Menu"
          aria-label="Open menu"
        >
          <Menu size={24} />
        </button>
        <span className="text-xl font-bold text-primary-600">FlowChat</span>
      </div>

      {/* Mobile: overlay + slide drawer (always mounted so it can animate) */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 sm:hidden transition-opacity duration-250 ${open ? 'opacity-100' : 'opacity-0 invisible'}`}
        onClick={() => setOpen(false)}
        aria-hidden={open ? undefined : true}
      >
        <div
          className={`fixed top-0 left-0 h-full w-full max-w-xs bg-white shadow-lg flex flex-col p-4 overflow-y-auto transition-transform duration-250 ease-in-out ${open ? 'translate-x-0' : '-translate-x-full'}`}
          onClick={(e) => e.stopPropagation()}
          aria-hidden={open ? undefined : true}
        >
          <div className="flex items-center justify-between mb-6">
            <span className="text-xl font-bold text-primary-600">FlowChat</span>
            <button
              onClick={() => setOpen(false)}
              className="p-3 text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100 min-w-11 min-h-11 flex items-center justify-center"
              title="Close menu"
              aria-label="Close menu"
            >
              <X size={24} />
            </button>
          </div>
          {renderNav()}
        </div>
      </div>

      {/* Desktop: sticky sidebar */}
      <nav className="hidden sm:block w-64 bg-white border-r h-screen sticky top-0 overflow-y-auto">
        <div className="p-4">
          <div className="text-xl font-bold text-primary-600 mb-6">FlowChat</div>
          {renderNav()}
        </div>
      </nav>
    </>
  );
}
