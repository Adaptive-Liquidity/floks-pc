-- Flok domain: flocks, birds, chirps, claim codes.
-- Applied after 0001_auth.sql. Idempotent.

create table if not exists flocks (
  id          text primary key,
  handle      text not null unique,
  title       text not null,
  bio         text not null default '',
  owner_hint  text,
  token_hash  text not null,
  visibility  text not null default 'public'
              check (visibility in ('public', 'unlisted')),
  is_seed     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists flocks_handle_idx on flocks (handle);
create index if not exists flocks_updated_at_idx on flocks (updated_at);
create index if not exists flocks_is_seed_idx on flocks (is_seed);

create table if not exists birds (
  id              text primary key,
  flock_id        text not null references flocks (id) on delete cascade,
  name            text not null,
  role            text not null,
  color           text not null,
  sort_order      integer not null default 0,
  grok_bot_label  text not null default '',
  state           text not null default 'offline'
                  check (state in ('working', 'idle', 'offline')),
  last_chirp_at   timestamptz,
  unique (flock_id, name)
);

create index if not exists birds_flock_id_idx on birds (flock_id);

create table if not exists chirps (
  id          text primary key,
  bird_id     text not null references birds (id) on delete cascade,
