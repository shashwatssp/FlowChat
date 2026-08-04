-- FlowChat Supabase Database Schema
-- ====================================

-- Enable extensions
create extension if not exists "uuid-ossp";

-- ====================================
-- Trigger: Updated At
-- ====================================
create or replace function update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language 'plpgsql';

-- ====================================
-- Users Table
-- ====================================
-- The id column has a server-side default (uuid_generate_v4) so inserts that
-- omit it (e.g. the oauth handle_new_user trigger) still succeed, while the
-- local-auth Register path can also supply an explicit id. The auth.users FK
-- reference is intentionally dropped so local-auth direct inserts are allowed.
create table if not exists users (
    id uuid primary key default uuid_generate_v4(),
    email text unique not null,
    full_name text,
    avatar_url text,
    password_hash text,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

create or replace function public.handle_new_user()
returns trigger as $$
begin
    insert into public.users (id, email, full_name, avatar_url)
    values (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
    return new;
end;
$$ language 'plpgsql'
security definer;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- RLS for users
alter table users enable row level security;
create policy "Users can view their own profile" on users
    for select using (auth.uid() = id);
create policy "Users can update their own profile" on users
    for update using (auth.uid() = id);

-- ====================================
-- Bots Table
-- ====================================
create table if not exists bots (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid references users on delete cascade not null,
    name text not null,
    description text,
    slug text unique not null,
    avatar_url text,
    system_prompt text,
    api_key text unique not null,
    usage_count bigint default 0,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

-- Indexes
create index if not exists idx_bots_user_id on bots(user_id);
create index if not exists idx_bots_slug on bots(slug);
create index if not exists idx_bots_api_key on bots(api_key);

-- Triggers
create trigger update_bots_updated_at before update on bots
    for each row execute function update_updated_at_column();

-- RLS for bots
alter table bots enable row level security;
create policy "Users can view bots they own" on bots
    for select using (user_id = auth.uid());
create policy "Users can create bots" on bots
    for insert with check (user_id = auth.uid());
create policy "Users can update their bots" on bots
    for update using (user_id = auth.uid());
create policy "Users can delete their bots" on bots
    for delete using (user_id = auth.uid());

-- ====================================
-- Conversations Table
-- ====================================
create table if not exists conversations (
    id uuid primary key default uuid_generate_v4(),
    bot_id uuid references bots on delete cascade not null,
    user_id uuid references users on delete cascade,
    started_at timestamp with time zone default now(),
    last_message_at timestamp with time zone default now()
);

-- Indexes
create index if not exists idx_conversations_bot_id on conversations(bot_id);
create index if not exists idx_conversations_user_id on conversations(user_id);
create index if not exists idx_conversations_last_message_at on conversations(last_message_at desc);

-- RLS for conversations
alter table conversations enable row level security;
create policy "Users can view conversations for bots they own" on conversations
    for select using (
        exists (select 1 from bots where id = conversations.bot_id and user_id = auth.uid())
    );
create policy "Users can create conversations" on conversations
    for insert with check (
        exists (select 1 from bots where id = bot_id and user_id = auth.uid())
    );

-- ====================================
-- Messages Table
-- ====================================
create table if not exists messages (
    id uuid primary key default uuid_generate_v4(),
    conversation_id uuid references conversations on delete cascade not null,
    bot_id uuid references bots on delete cascade not null,
    role text not null check (role in ('user', 'assistant', 'system')),
    content text not null,
    created_at timestamp with time zone default now()
);

-- Indexes
create index if not exists idx_messages_conversation_id on messages(conversation_id);
create index if not exists idx_messages_bot_id on messages(bot_id);
create index if not exists idx_messages_created_at on messages(created_at);
create index if not exists idx_messages_role on messages(role);

-- RLS for messages
alter table messages enable row level security;
create policy "Users can view messages for conversations of bots they own" on messages
    for select using (
        exists (
            select 1 from conversations c
            join bots b on c.bot_id = b.id
            where c.id = messages.conversation_id and b.user_id = auth.uid()
        )
    );
create policy "System can insert messages" on messages
    for insert with check (true);

-- ====================================
-- Knowledge Sources Table
-- ====================================
create table if not exists knowledge_sources (
    id uuid primary key default uuid_generate_v4(),
    bot_id uuid references bots on delete cascade not null,
    name text not null,
    type text not null check (type in ('file_upload', 'web_scraping', 'image', 'qa_pairs')),
    url text,
    status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'failed')),
    chunk_count integer default 0,
    created_at timestamp with time zone default now()
);

-- Indexes
create index if not exists idx_knowledge_sources_bot_id on knowledge_sources(bot_id);
create index if not exists idx_knowledge_sources_status on knowledge_sources(status);

-- RLS for knowledge_sources
alter table knowledge_sources enable row level security;
create policy "Users can view knowledge sources for bots they own" on knowledge_sources
    for select using (
        exists (select 1 from bots where id = knowledge_sources.bot_id and user_id = auth.uid())
    );
create policy "Users can insert knowledge sources for bots they own" on knowledge_sources
    for insert with check (
        exists (select 1 from bots where id = bot_id and user_id = auth.uid())
    );
create policy "Users can delete knowledge sources for bots they own" on knowledge_sources
    for delete using (
        exists (select 1 from bots where id = knowledge_sources.bot_id and user_id = auth.uid())
    );

-- ====================================
-- Feedback Table
-- ====================================
create table if not exists feedback (
    id uuid primary key default uuid_generate_v4(),
    conversation_id uuid references conversations on delete cascade not null,
    helpful boolean,
    rating integer check (rating >= 1 and rating <= 5),
    comment text,
    created_at timestamp with time zone default now()
);

-- Indexes
create index if not exists idx_feedback_conversation_id on feedback(conversation_id);

-- RLS for feedback
alter table feedback enable row level security;
create policy "Users can view feedback for conversations of bots they own" on feedback
    for select using (
        exists (
            select 1 from conversations c
            join bots b on c.bot_id = b.id
            where c.id = feedback.conversation_id and b.user_id = auth.uid()
        )
    );
create policy "Users can insert feedback for conversations of bots they own" on feedback
    for insert with check (
        exists (
            select 1 from conversations c
            join bots b on c.bot_id = b.id
            where c.id = feedback.conversation_id and b.user_id = auth.uid()
        )
    );

-- ====================================
-- Usage Tracking Function
-- ====================================
create or replace function increment_bot_usage(bot_id uuid)
returns void as $$
begin
    update bots set usage_count = usage_count + 1 where id = bot_id;
end;
$$ language 'plpgsql';
