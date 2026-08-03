'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Bot, MessageSquare, Database, Settings, LogOut } from 'lucide-react';
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

  return (
    <nav className="w-64 bg-white border-r h-screen sticky top-0 overflow-y-auto">
      <div className="p-4">
        <div className="text-xl font-bold text-primary-600 mb-6">FlowChat</div>
        <ul className="space-y-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
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
      </div>
    </nav>
  );
}
