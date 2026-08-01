'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Save, BarChart3 } from 'lucide-react';

interface UserSettings {
  email: string;
  full_name?: string;
  avatar_url?: string;
  billing_plan?: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }
    // Mock settings - in production, fetch from API
    setSettings({
      email: 'user@example.com',
      full_name: 'User Name',
      billing_plan: 'free',
    });
    setLoading(false);
  }, [router]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // In production, call API to update settings
      toast.success('Settings saved successfully');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

          <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <BarChart3 size={20} />
              Account Overview
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={settings.email}
                  onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={settings.full_name || ''}
                  onChange={(e) => setSettings({ ...settings, full_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Current Plan
                </label>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 bg-primary-100 text-primary-800 rounded-full text-sm font-medium">
                    {settings.billing_plan || 'Free'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Environment Variables</h2>
            <div className="space-y-4 text-sm">
              <div className="bg-gray-50 rounded-lg p-4">
                <code className="text-xs text-gray-600 break-all">
                  NEXT_PUBLIC_API_URL=http://localhost:8080/api/v1
                </code>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <code className="text-xs text-gray-600 break-all">
                  NEXT_PUBLIC_ENV=development
                </code>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Environment variables control API endpoint and deployment environment.
              Set them in your .env.local file.
            </p>
          </div>

          <div className="flex justify-end mt-6">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              <Save size={16} className={saving ? 'animate-pulse' : ''} />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
