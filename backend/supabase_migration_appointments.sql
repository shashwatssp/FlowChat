-- =============================================================
-- ChatFlow — Google Calendar appointment integration
-- =============================================================
-- Tables:
--   availability_rules        recurring weekly availability windows
--   availability_exceptions   one-off open/closed overrides (holidays, etc.)
--   appointments              confirmed bookings
--   appointment_holds         short-lived slot holds used during booking
--   booking_locks             prevents double-booking across concurrent requests
--   bot_calendar_tokens       per-bot Google Calendar OAuth tokens
-- =============================================================

-- Per-bot recurring weekly availability rules.
create table if not exists availability_rules (
    id         uuid primary key default gen_random_uuid(),
    bot_id     uuid references bots on delete cascade not null,
    day_of_week integer not null check (day_of_week between 0 and 6), -- 0 = Sunday
    start_time time not null,
    end_time   time not null,
    timezone   text not null default 'UTC',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Per-bot, per-day exceptions to the recurring rules.
-- is_open=false removes availability for the day; is_open=true adds it.
create table if not exists availability_exceptions (
    id          uuid primary key default gen_random_uuid(),
    bot_id      uuid references bots on delete cascade not null,
    exception_date date not null,
    is_open     boolean not null default false,
    start_time  time,
    end_time    time,
    timezone    text not null default 'UTC',
    note        text,
    created_at  timestamptz not null default now(),
    unique (bot_id, exception_date)
);

-- Confirmed calendar appointments.
create table if not exists appointments (
    id              uuid primary key default gen_random_uuid(),
    bot_id          uuid references bots on delete cascade not null,
    start_time      timestamptz not null,
    end_time        timestamptz not null,
    customer_name   text not null,
    customer_phone  text not null,
    customer_email  text,
    notes           text,
    status          text not null default 'pending' check (status in ('pending','confirmed','cancelled','completed')),
    calendar_event_id text, -- Google Calendar event id once synced
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    -- Prevent overlapping bookings for the same bot.
    constraint appointments_unique_slot unique (bot_id, start_time, end_time)
);

create index if not exists idx_appointments_bot_start on appointments (bot_id, start_time);
create index if not exists idx_appointments_customer on appointments (customer_email);
create index if not exists idx_appointments_status on appointments (status);

-- Short-lived holds placed on a slot while the customer finalises booking.
create table if not exists appointment_holds (
    id            uuid primary key default gen_random_uuid(),
    bot_id        uuid references bots on delete cascade not null,
    start_time    timestamptz not null,
    end_time      timestamptz not null,
    holder_token  text not null, -- opaque token identifying the booking session
    expires_at    timestamptz not null,
    created_at    timestamptz not null default now(),
    unique (bot_id, start_time, end_time)
);

create index if not exists idx_appointment_holds_expires on appointment_holds (expires_at);

-- Advisory-style locks to serialise booking attempts per bot+slot.
create table if not exists booking_locks (
    bot_id      uuid not null,
    slot_key    text not null,
    locked_at   timestamptz not null default now(),
    locked_by   text,
    primary key (bot_id, slot_key)
);

-- OAuth tokens for each bot's Google Calendar connection.
create table if not exists bot_calendar_tokens (
    id            uuid primary key default gen_random_uuid(),
    bot_id        uuid references bots on delete cascade not null,
    access_token  text not null,   -- refreshable access token (encrypted at rest by vault / supabase)
    refresh_token text not null,   -- long-lived refresh token
    token_type    text not null default 'Bearer',
    expiry        timestamptz,
    scope         text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    unique (bot_id)
);

create index if not exists idx_bot_calendar_tokens_bot on bot_calendar_tokens (bot_id);
