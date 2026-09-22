-- =========================================================
-- 1. Create workouts table
-- =========================================================

drop table if exists public.workouts;

create table public.workouts (
    -- Unique identifier for each workout
    id uuid primary key default gen_random_uuid(),

    -- Authenticated user who owns this workout
    user_id uuid not null
        references auth.users(id)
        on delete cascade,

    -- Preserves the original workout ID from the source data
    source_workout_id integer,

    -- Final workout score; nullable while the workout is in progress
    final_score integer,

    -- Workout start and end timestamps
    started_at timestamptz not null,
    ended_at timestamptz,

    -- Active band locations used during the workout
    active_bands integer[] not null default '{}',

    -- Total number of sensor messages received for this workout
    sample_count integer not null default 0,

    -- Timestamp when the workout record was created
    created_at timestamptz not null default now()
);


-- =========================================================
-- 2. Create workout_chunks table
-- =========================================================

create table public.workout_chunks (
    -- Unique identifier for each chunk
    id uuid primary key default gen_random_uuid(),

    -- Workout this chunk belongs to
    workout_id uuid not null
        references public.workouts(id)
        on delete cascade,

    -- Sequence number used to preserve chunk ordering
    sequence integer not null,

    -- Number of sensor messages contained in this chunk
    sample_count integer not null default 0,

    -- Raw sensor data for this chunk
    sensor_data jsonb not null,

    -- Timestamp when the chunk was stored
    created_at timestamptz not null default now(),

    -- Prevent duplicate sequence numbers within the same workout
    unique (workout_id, sequence)
);


-- =========================================================
-- 3. Enable Row Level Security
-- =========================================================

alter table public.workouts
enable row level security;

alter table public.workout_chunks
enable row level security;


-- =========================================================
-- 4. RLS policies for workouts
-- =========================================================

-- Users can read only their own workouts
create policy "Users can view own workouts"
on public.workouts
for select
to authenticated
using (
    (select auth.uid()) = user_id
);


-- Users can create workouts only for themselves
create policy "Users can insert own workouts"
on public.workouts
for insert
to authenticated
with check (
    (select auth.uid()) = user_id
);


-- Users can update only their own workouts
-- Needed to set final_score / ended_at when a workout finishes
create policy "Users can update own workouts"
on public.workouts
for update
to authenticated
using (
    (select auth.uid()) = user_id
)
with check (
    (select auth.uid()) = user_id
);


-- =========================================================
-- 5. RLS policies for workout_chunks
-- =========================================================

-- Users can read chunks only when the parent workout belongs to them
create policy "Users can view own workout chunks"
on public.workout_chunks
for select
to authenticated
using (
    exists (
        select 1
        from public.workouts
        where workouts.id = workout_chunks.workout_id
          and workouts.user_id = (select auth.uid())
    )
);


-- Users can insert chunks only into their own workouts
create policy "Users can insert own workout chunks"
on public.workout_chunks
for insert
to authenticated
with check (
    exists (
        select 1
        from public.workouts
        where workouts.id = workout_chunks.workout_id
          and workouts.user_id = (select auth.uid())
    )
);