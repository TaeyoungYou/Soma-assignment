-- =========================================================
-- Usage Statistics RPC
-- =========================================================

create or replace function public.get_usage_statistics()
returns jsonb
language sql
security definer
-- Execute with the function owner's privileges
-- so statistics can be aggregated across all users
set search_path = ''
as $$
  with workout_stats as (
    select
      -- Total number of workouts
      count(*) as total_workouts,

      -- Number of unique users who have at least one workout
      count(distinct user_id) as unique_users,

      -- Number of completed workouts
      count(*) filter (
        where ended_at is not null
      ) as completed_workouts,

      -- Average final score for workouts with a final score
      avg(final_score) filter (
        where final_score is not null
      ) as average_final_score,

      -- Average workout duration in minutes
      avg(
        extract(epoch from (ended_at - started_at)) / 60.0
      ) filter (
        where ended_at is not null
      ) as average_duration_minutes

    from public.workouts
  ),

  sample_stats as (
    select
      -- Total number of samples across all workout chunks
      -- Return 0 instead of NULL when no chunks exist
      coalesce(sum(sample_count), 0) as total_samples

    from public.workout_chunks
  )

  -- Return all aggregated statistics as a single JSON object
  select jsonb_build_object(
    'total_workouts',
      ws.total_workouts,

    'unique_users',
      ws.unique_users,

    'completed_workouts',
      ws.completed_workouts,

    'average_final_score',
      round(ws.average_final_score, 2),

    'average_duration_minutes',
      round(ws.average_duration_minutes, 2),

    'total_samples',
      ss.total_samples
  )

  from workout_stats ws
  cross join sample_stats ss;
$$;


-- =========================================================
-- RPC Permissions
-- =========================================================

-- Remove the default function execution permission
revoke execute
on function public.get_usage_statistics()
from public;

-- Prevent unauthenticated users from calling the RPC
revoke execute
on function public.get_usage_statistics()
from anon;

-- Allow authenticated users to call the RPC
grant execute
on function public.get_usage_statistics()
to authenticated;