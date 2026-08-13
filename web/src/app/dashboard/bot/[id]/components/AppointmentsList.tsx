'use client';

import { useState, useEffect } from 'react';
import { calendarApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Send,
} from 'lucide-react';

interface Appointment {
  id: string;
  customer_name: string;
  customer_phone?: string;
  customer_email?: string;
  start_time: string;
  end_time: string;
  status: 'confirmed' | 'cancelled' | 'pending';
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

interface Slot {
  start_time: string;
  end_time: string;
}

interface AppointmentsListProps {
  botID: string;
}

const APPOINTMENT_STATUSES: Appointment['status'][] = ['confirmed', 'cancelled', 'pending'];

export default function AppointmentsList({ botID }: AppointmentsListProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [filterStatus, setFilterStatus] = useState<'all' | Appointment['status']>('all');

  // Calendar / slot-picker state
  const [settings, setSettings] = useState<any>(null);
  const [slotDate, setSlotDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingStart, setBookingStart] = useState<string | null>(null);
  const [bookingName, setBookingName] = useState('');
  const [bookingPhone, setBookingPhone] = useState('');
  const [bookingEmail, setBookingEmail] = useState('');

  useEffect(() => {
    fetchAppointments();
  }, [botID]);

  const fetchAppointments = async () => {
    setLoading(true);
    try {
      const response = await calendarApi.listAppointments(botID);
      setAppointments(response.data?.appointments || []);
    } catch {
      toast.error('Failed to load appointments');
    } finally {
      setLoading(false);
    }
  };

  // Fetch the bot's calendar settings (duration + timezone + rules).
  const fetchSettings = async () => {
    try {
      const response = await calendarApi.getSettings(botID);
      setSettings(response.data);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to load calendar settings');
      setSettings({ timezone: 'UTC', appointment_duration_minutes: 30 });
    }
  };

  // Fetch open slots for the selected date at the bot's configured duration.
  const fetchSlots = async () => {
    if (!settings) return;
    const duration = settings.appointment_duration_minutes || 30;
    setSlotsLoading(true);
    try {
      const response = await calendarApi.getAvailableSlots(
        botID,
        slotDate,
        slotDate,
        duration,
      );
      setSlots(response.data?.slots || []);
    } catch {
      toast.error('Failed to load available slots');
      setSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  };

  const durationMinutes = settings?.appointment_duration_minutes || 30;
  // End time is the start + the bot's configured slot duration.
  const computeEndISO = (startISO: string) => {
    const d = new Date(startISO);
    d.setMinutes(d.getMinutes() + durationMinutes);
    return d.toISOString();
  };
  const formatTimeInTz = (iso: string) =>
    new Date(iso).toLocaleTimeString([], {
      timeZone: settings?.timezone || 'UTC',
      hour: '2-digit',
      minute: '2-digit',
    } as any);

  useEffect(() => {
    fetchSettings();
  }, []);
  useEffect(() => {
    if (settings) fetchSlots();
  }, [slotDate, settings]);

  const handleCancel = async (appointmentId: string) => {
    setCancelingId(appointmentId);
    try {
      await calendarApi.cancelAppointment(botID, appointmentId);
      toast.success('Appointment cancelled');
      setAppointments((prev) =>
        prev.map((a) =>
          a.id === appointmentId ? { ...a, status: 'cancelled' } : a,
        ),
      );
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to cancel appointment');
    } finally {
      setCancelingId(null);
    }
  };

  // ─── Filtering ──────────────────────────────────────────────────────────
  const filteredAppointments = appointments.filter((a) => {
    if (filterStatus === 'all') return true;
    return a.status === filterStatus;
  });

  // ─── Stats ──────────────────────────────────────────────────────────────
  const stats = {
    total: appointments.length,
    confirmed: appointments.filter((a) => a.status === 'confirmed').length,
    cancelled: appointments.filter((a) => a.status === 'cancelled').length,
    pending: appointments.filter((a) => a.status === 'pending').length,
  };

  // ─── Calendar grid ──────────────────────────────────────────────────────
  const today = new Date();
  const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
  const dayOfWeek = firstDay.getDay(); // 0 = Sunday
  // Start the grid on Monday
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 7; j++) {
      const cellDate = new Date(startDate);
      cellDate.setDate(startDate.getDate() + i * 7 + j);
      calendarDays.push(
        cellDate.getMonth() === currentMonth.getMonth() ? cellDate.getDate() : null,
      );
    }
  }

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const getStatusBadge = (status: Appointment['status']) => {
    const colorMap: Record<Appointment['status'], string> = {
      confirmed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
      pending: 'bg-yellow-100 text-yellow-800',
    };
    const iconMap: Record<Appointment['status'], JSX.Element> = {
      confirmed: <CheckCircle size={12} />,
      cancelled: <XCircle size={12} />,
      pending: <Clock size={12} />,
    };
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
          colorMap[status]
        }`}
      >
        {iconMap[status]}
        {status}
      </span>
    );
  };

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getDayAppointments = (day: number) => {
    return appointments.filter((a) => {
      const d = new Date(a.start_time);
      return d.getDate() === day;
    });
  };

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-primary-600">{stats.total}</div>
          <div className="text-sm text-gray-600">Total Appointments</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{stats.confirmed}</div>
          <div className="text-sm text-gray-600">Confirmed</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
          <div className="text-sm text-gray-600">Pending</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-red-600">{stats.cancelled}</div>
          <div className="text-sm text-gray-600">Cancelled</div>
        </div>
      </div>

      {/* Book an appointment (owner slot picker) */}
      <div className="bg-white border rounded-lg p-4 mt-6">
        <h3 className="text-lg font-medium text-gray-900 mb-3 flex items-center gap-2">
          <Calendar size={18} />
          Book an Appointment
        </h3>
        <div className="flex flex-wrap gap-3 items-end mb-3">
          <div>
            <label className="block text-xs text-gray-500">Pick a date</label>
            <input
              type="date"
              value={slotDate}
              onChange={(e) => setSlotDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          {settings && (
            <span className="text-sm text-gray-600">
              Duration: <span className="font-medium">{durationMinutes} min</span> · TZ:{' '}
              <span className="font-medium">{settings.timezone || 'UTC'}</span>
            </span>
          )}
        </div>

        {slotsLoading ? (
          <p className="text-sm text-gray-500">Loading slots…</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-gray-500">
            No open slots for this date. Adjust working hours in Calendar Settings.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {slots.map((s) => (
              <button
                key={s.start_time}
                onClick={() => {
                  setBookingStart(s.start_time);
                  setBookingName('');
                  setBookingPhone('');
                  setBookingEmail('');
                  setBookingOpen(true);
                }}
                className="text-left px-3 py-2 rounded-md border border-green-200 bg-green-50 hover:bg-green-100 text-green-800 text-sm"
              >
                {formatTimeInTz(s.start_time)} – {formatTimeInTz(s.end_time)}
              </button>
            ))}
          </div>
        )}

        {/* Already-booked times on this date (closed / taken) */}
        {appointments
          .filter((a) => a.start_time.slice(0, 10) === slotDate)
          .map((a) => (
            <div
              key={a.id}
              className="mt-2 px-3 py-2 rounded-md border border-blue-200 bg-blue-50 text-blue-800 text-sm"
            >
              <span className="font-medium">Booked:</span>{' '}
              {formatTimeInTz(a.start_time)} – {formatTimeInTz(a.end_time)} · {a.customer_name}
            </div>
          ))}
      </div>

      {/* Booking confirmation modal */}
      {bookingOpen && bookingStart && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-2">
            <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Clock size={18} />
              Confirm Appointment
            </h4>
            <p className="text-sm text-gray-600 mb-4">
              {formatTimeInTz(bookingStart)} – {formatTimeInTz(computeEndISO(bookingStart))}
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={bookingName}
                  onChange={(e) => setBookingName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-700 mb-1">Phone *</label>
                <input
                  type="text"
                  value={bookingPhone}
                  onChange={(e) => setBookingPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={bookingEmail}
                  onChange={(e) => setBookingEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
            <div className="mt-5 flex gap-3 justify-end">
              <button
                onClick={() => setBookingOpen(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!bookingName.trim() || !bookingPhone.trim()) {
                    toast.error('Name and phone are required');
                    return;
                  }
                  try {
                    await calendarApi.bookAppointment(botID, {
                      customer_name: bookingName,
                      customer_phone: bookingPhone,
                      customer_email: bookingEmail || undefined,
                      start_time: bookingStart,
                      end_time: computeEndISO(bookingStart),
                    });
                    toast.success('Appointment booked successfully!');
                    setBookingOpen(false);
                    fetchSlots();
                    fetchAppointments();
                  } catch (error: any) {
                    const status = error.response?.status;
                    if (status === 409) {
                      toast.error('That slot was just booked by someone else. Availability refreshed.');
                    } else {
                      toast.error(error.response?.data?.error || 'Failed to book appointment');
                    }
                    // Another user may have won the race for this slot — refresh so it shows as taken.
                    fetchSlots();
                    fetchAppointments();
                  }
                }}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 flex items-center gap-1"
              >
                <Send size={14} />
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Calendar + List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Month-view calendar grid */}
        <div className="bg-white border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={prevMonth}
              className="p-1 text-gray-500 hover:text-gray-700 rounded"
              title="Previous month"
            >
              <ChevronLeft size={20} />
            </button>
            <h3 className="text-lg font-medium text-gray-900">
              {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </h3>
            <button
              onClick={nextMonth}
              className="p-1 text-gray-500 hover:text-gray-700 rounded"
              title="Next month"
            >
              <ChevronRight size={20} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-2">
            {weekDays.map((day) => (
              <div key={day} className="text-center text-xs font-medium text-gray-500 py-2">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, idx) => {
              if (day === null) {
                return <div key={idx} className="h-10" />;
              }
              const dayAppts = getDayAppointments(day);
              const isToday =
                day === today.getDate() &&
                currentMonth.getMonth() === today.getMonth() &&
                currentMonth.getFullYear() === today.getFullYear();
              return (
                <div
                  key={idx}
                  className={`h-10 text-center flex flex-col items-center justify-center rounded-md text-sm transition-colors ${
                    isToday
                      ? 'bg-primary-100 font-semibold'
                      : 'hover:bg-gray-100'
                  }`}
                >
                  <span>{day}</span>
                  {dayAppts.length > 0 && (
                    <span className="flex items-center gap-0.5 mt-0.5">
                      <span className="w-1.5 h-1.5 bg-primary-600 rounded-full"></span>
                      <span className="text-xs text-gray-600">{dayAppts.length}</span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Appointment list table */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">Appointments</h3>
            <div className="flex flex-wrap gap-1">
              {(['all', ...APPOINTMENT_STATUSES] as const).map((status) => {
                const label = status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1);
                return (
                  <button
                    key={status}
                    onClick={() => setFilterStatus(status)}
                    className={`px-3 py-1 text-xs rounded-md ${
                      filterStatus === status
                        ? status === 'confirmed'
                          ? 'bg-green-600 text-white'
                          : status === 'cancelled'
                            ? 'bg-red-600 text-white'
                            : status === 'pending'
                              ? 'bg-yellow-600 text-white'
                              : 'bg-primary-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={fetchAppointments}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
          >
            <RefreshCw size={14} />
            Refresh
          </button>

          {loading ? (
            <div className="py-8 text-center text-gray-500">Loading appointments...</div>
          ) : filteredAppointments.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              <Calendar size={32} className="mx-auto mb-2 opacity-30" />
              <p>No appointments found.</p>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-3 py-2 font-medium text-gray-700">Customer</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-700">Date &amp; Time</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-700">Status</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredAppointments.map((appointment) => (
                    <tr key={appointment.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <span className="font-medium text-gray-900">{appointment.customer_name}</span>
                        {appointment.customer_phone && (
                          <div className="text-xs text-gray-500">{appointment.customer_phone}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-600">
                        <div>{new Date(appointment.start_time).toLocaleDateString()}</div>
                        <div className="text-xs">
                          {formatTime(appointment.start_time)} – {formatTime(appointment.end_time)}
                        </div>
                      </td>
                      <td className="px-3 py-2">{getStatusBadge(appointment.status)}</td>
                      <td className="px-3 py-2 text-right">
                        {appointment.status !== 'cancelled' ? (
                          <button
                            onClick={() => handleCancel(appointment.id)}
                            disabled={cancelingId === appointment.id}
                            className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                            title="Cancel appointment"
                          >
                            {cancelingId === appointment.id ? 'Cancelling...' : 'Cancel'}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
