# SOMA Backend Interview Assignment

This project is a minimal Supabase-based backend implementation for SOMA that stores workout data, allows users to retrieve their own workouts, and calculates overall usage statistics.

## 1. Project Goals

The current implementation focuses on two main requirements.

### User Requirements

Users should be able to:

1. Sign in using Supabase Auth.
2. Store their workout metadata.
3. Store sensor data associated with each workout.
4. Retrieve their own workout data.
5. Access the same workout data when signing in with the same account from another device.

### Internal Statistics Requirements

The system should also be able to calculate statistics across all users, including:

* Total number of workouts
* Number of unique users with workouts
* Number of completed workouts
* Average final score
* Average workout duration
* Total number of sensor samples

The expected scale for this assignment is approximately:

* 1,000 users
* An average of one workout per user per day
* Approximately 45 minutes per workout

At this scale, I decided that introducing a complex ingestion infrastructure from the beginning would be unnecessary.

Instead, the backend uses a relatively simple architecture based on PostgreSQL, Row Level Security, JSONB, and RPC functions.

---

## 2. Tech Stack

* TypeScript
* Supabase
* PostgreSQL
* Supabase Auth
* PostgreSQL Row Level Security
* PostgreSQL RPC
* JSONB
* Vitest

Supabase was selected because it provides authentication, database access, Row Level Security, and RPC functionality without requiring a separate Express server for this assignment.

This makes it possible to build a relatively small backend while still maintaining a clear security boundary between users.

---

## 3. Architecture

<img width="707" height="341" alt="Architecture Diagram" src="https://github.com/user-attachments/assets/12ac05cf-1a39-48ba-91d2-b2d2de33fe46" />

Workout data is divided into two main tables.

### `workouts`

Stores workout-level metadata.

### `workout_chunks`

Stores the larger sensor payload associated with a workout.

I separated workout metadata from sensor data in order to keep the `workouts` table relatively lightweight.

This structure also allows the system to support chunked sensor uploads in the future, where a client could upload multiple sensor chunks during a workout instead of uploading one large payload at the end.

---

## 4. Database Design

### 1. Why Use UUIDs as Database Primary Keys?

The provided workout JSON already contains its own `id`.

Initially, I considered using this value directly as the database primary key.

However, a source workout ID cannot necessarily be assumed to be globally unique across every user, device, or external source.

Therefore, the database uses:

* `id` → PostgreSQL-generated UUID
* `source_workout_id` → original workout ID from the client

This prevents database row collisions while still preserving the original workout identifier.

---

### 2. Why Store Sensor Data as JSONB?

The provided workout data is not a simple one-dimensional array.

It contains nested structures such as:

* `dat0`
* `dat1`
* `dat2`

The internal message structure can also vary depending on fields such as location, channel, and analyte.

Fully normalizing every sensor message into relational tables would require significantly more tables and rows.

For this assignment, the main requirements are:

* Storing workouts
* Retrieving workouts
* Counting sensor samples
* Enforcing user-level access control

Because of this, fully normalizing all sensor messages would introduce unnecessary complexity.

Using JSONB provides several advantages:

* Preserves the original sensor structure
* Simplifies ingestion
* Keeps the payload inside PostgreSQL
* Allows PostgreSQL JSON operators to query the payload when necessary
* Makes future schema changes easier when the sensor format is still evolving

If large-scale analytics on individual sensor fields becomes important, a hybrid architecture could be introduced later.

For example, frequently queried sensor fields could be extracted into dedicated columns or relational tables while the original raw payload remains stored as JSONB.

---

### 3. `sample_count` Strategy

The provided Flutter `Workout` structure contains the concept of `sampleCount`, but the actual JSON files do not directly include a `sample_count` field.

Therefore, the current test implementation calculates the number of samples by iterating through `dat0`, `dat1`, and `dat2`.

I initially considered calculating this value using a database trigger or RPC function.

However, recalculating the number of samples from the full JSON payload every time statistics are requested would create unnecessary repeated work.

For a production client, I would expect the Flutter application or ingestion layer to calculate `sampleCount` when creating the sensor payload and send that value together with the data.

For this assignment, the calculation is implemented as a TypeScript utility before the data is inserted.

The calculated value is stored in `workout_chunks.sample_count`.

This allows statistics to use:

```sql
sum(workout_chunks.sample_count)
```

without loading and parsing `dat0`, `dat1`, and `dat2` every time.

---

### 4. Chunk and Sequence Design

The provided JSON files represent either completed workouts or partial workout snapshots.

In the current implementation:

```text
1 JSON file = 1 workout_chunk = sequence 0
```

Therefore, it is expected that the first chunk of every workout currently has:

```text
sequence = 0
```

The `sequence` value is not globally unique.

It only represents the order of chunks within the same workout.

For example, if the Flutter application later uploads sensor buffers periodically, the structure could look like this:

```text
Workout A
  ├─ sequence 0
  ├─ sequence 1
  ├─ sequence 2
  └─ sequence 3
```

A unique constraint can therefore be applied to the combination of:

```text
(workout_id, sequence)
```

rather than to `sequence` alone.

If ingestion volume grows significantly in the future, a queue-based architecture could also be introduced so that sensor ingestion and downstream processing are separated from the client request.

---

### 5. Authentication

Authentication is handled using Supabase Auth.

The current implementation uses email and password authentication.

OAuth could also be added later to improve user convenience and support easier sign-in across devices.

OAuth is not included in this assignment because there is no frontend application or redirect flow required for the current backend tests.

The important point for this assignment is that the same authenticated account receives the same Supabase user ID regardless of the device used to sign in.

Workout ownership is therefore associated with the authenticated user rather than with a specific device.

---

### 6. Row Level Security

Row Level Security is enabled on both:

* `workouts`
* `workout_chunks`

For `workouts`, users can only access rows that belong to their own authenticated user ID.

Conceptually:

```sql
user_id = auth.uid()
```

`workout_chunks` does not directly contain a `user_id`.

Instead, ownership is determined through the parent workout.

For example:

```sql
exists (
  select 1
  from public.workouts
  where workouts.id = workout_chunks.workout_id
    and workouts.user_id = auth.uid()
)
```

This means that even if another user somehow knows a workout UUID, they still cannot read or insert chunks for that workout unless they own the parent workout.

---

### 7. Usage Statistics RPC

The system needs to calculate statistics across all users.

However, a normal authenticated user cannot directly query every workout because RLS limits them to their own rows.

To solve this, I created a PostgreSQL RPC function:

```text
get_usage_statistics()
```

<img width="584" height="1417" alt="Usage Statistics RPC" src="https://github.com/user-attachments/assets/173b8823-4f5e-4b60-9df7-32f832b413e3" />

The function returns:

* `total_workouts`
* `unique_users`
* `completed_workouts`
* `average_final_score`
* `average_duration_minutes`
* `total_samples`

This allows the backend to calculate global aggregate statistics without exposing raw workout rows from other users.

---

### 8. Why Use `SECURITY DEFINER`?

The statistics function needs to aggregate workout data across all users.

If the function executed only with the permissions of the authenticated caller, RLS would limit the query to that user's own rows.

For this reason, the statistics function uses:

```sql
SECURITY DEFINER
```

This allows the function to execute with the privileges of its owner.

However, the function does not return raw user records.

It only returns aggregate statistics.

This creates a controlled boundary where privileged database access is used internally while the caller only receives the final aggregated values.

In a production implementation, the function should also use a controlled `search_path` and expose only the minimum required execution permissions.

---

### 9. Statistics RPC Access Control

For this assignment, authenticated users are allowed to call the aggregate statistics function.

This was intentionally kept simple.

In a production system, exposing company-wide usage statistics to every normal user would likely not be appropriate.

Possible production alternatives include:

* An admin role
* A dedicated internal service
* An internal-only Edge Function
* Restricted RPC execution permissions

For this assignment, the goal was to demonstrate global aggregation while keeping the authorization model relatively small.

---

### 10. Why I Did Not Implement an Admin Role

I initially considered adding a separate user/admin role system.

However, introducing an admin role would also require additional infrastructure such as:

* Profile or role tables
* Role assignment logic
* Role-based RLS policies
* Protection against unauthorized role modification

None of these are required to satisfy the core requirements of this assignment.

Therefore, the current implementation keeps the architecture minimal:

```text
User data
    ↓
Protected by RLS

Global aggregate statistics
    ↓
Provided through a controlled RPC
```

An admin role can be added later if the product requires administrative functionality.

---

### 11. Storage Considerations

I also considered using Supabase Storage.

Storage is well suited for data such as:

* Images
* Videos
* Large binary files
* Archives
* Very large raw data files

In this assignment, however, the sensor payload is structured JSON and is strongly associated with a workout record.

At the expected scale, storing the payload as JSONB inside PostgreSQL keeps the architecture simpler.

If raw sensor payloads become significantly larger or long-term historical data grows substantially, a possible future architecture would be:

```text
Recent / frequently accessed data
        ↓
PostgreSQL

Large or archived raw sensor data
        ↓
Object Storage
```

The database could then store the storage object path or metadata associated with the workout.

Private objects could be retrieved using signed URLs when necessary.

---

### 12. Realtime Considerations

Supabase Realtime is useful when database changes need to be pushed to other connected clients immediately.

The main requirements of this assignment are:

* Store workout data
* Retrieve workout data
* Enforce ownership
* Calculate statistics

Because of this, Realtime is not currently necessary.

However, Realtime could become useful for features such as:

* Live workout dashboards
* Real-time coach monitoring
* Progress updates
* Live workout status synchronization across devices

---

### 13. Edge Functions and Queue Considerations

The current requirements can be implemented using:

```text
Supabase Auth
        ↓
PostgreSQL
        ↓
RLS
        ↓
RPC
```

The insert logic is currently simple enough that introducing an additional backend service would add complexity without providing a major benefit.

I also considered using a queue for sensor ingestion.

A queue could provide several advantages:

* Separating client requests from database processing
* Retry handling
* Burst traffic absorption
* Asynchronous processing
* Downstream analysis pipelines

However, with approximately 1,000 users performing around one workout per day, introducing a queue from the beginning would likely be unnecessary.

A more practical approach would be to introduce a queue when actual traffic, processing latency, or reliability requirements justify it.

A possible future architecture could be:

```text
Flutter Client
      ↓
Ingestion API / Edge Function
      ↓
Queue
      ↓
Worker
      ↓
PostgreSQL / Storage / Analytics
```

This keeps the current implementation simple while leaving a clear path for future scaling.

---

### 14. Manual Testing to Vitest

During early development, I tested each backend feature using individual TypeScript scripts.

These included:

* Supabase connection
* Authentication
* Workout insertion
* RLS behavior
* JSON sample upload
* Statistics RPC
* Workout retrieval

These scripts were useful while developing individual components.

For the final implementation, I integrated the main scenarios into Vitest because automated tests provide clearer pass/fail results and are easier to run repeatedly.

The tests interact with the actual Supabase backend, so they function as integration tests rather than isolated unit tests.

---

## 5. Running the Project

### Install Dependencies

```bash
npm install
```

### Run the Integration Test Suite

```bash
npm run test
```

### Test Supabase Connection / Session

```bash
npm run test:connection
```

### Test Sign Up, Sign In, and Sign Out

```bash
npm run test:auth
```

### Test Workout Ownership and RLS

```bash
npm run test:workout
```

### Upload a Small Sample

```bash
npm run test:upload-small-sample
```

### Test Statistics RPC

```bash
npm run test:statistics
```

### Upload and Validate All Samples

```bash
npm run test:all-samples
```

### Retrieve Workout Metadata and Sensor Chunks

```bash
npm run test:read-workout
```

---

## 6. Final Summary

The main design priorities of this implementation were:

* User-level data ownership
* RLS-based access control
* A simple structure capable of storing the provided sensor JSON
* Separation of workout metadata and large sensor payloads
* Separation of database UUIDs and client-provided workout IDs
* Support for partial workouts
* Support for future chunked sensor ingestion
* Global aggregate statistics through RPC
* Integration tests against the actual Supabase backend
* Avoiding unnecessary infrastructure at the current scale
* A clear upgrade path toward Queue, Workers, Edge Functions, and Object Storage

The goal of this implementation is not to represent a complete production architecture.

Instead, it provides a secure and relatively simple foundation that satisfies the assignment requirements while allowing the system to evolve as actual usage, traffic, and data-processing requirements become clearer.
