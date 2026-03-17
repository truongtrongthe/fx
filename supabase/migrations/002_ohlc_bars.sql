-- OHLC bar history (shared market data). Persist to avoid reloading from API.
-- One row per bar: symbol + timeframe + timestamp (bar start).

create table if not exists ohlc_bars (
  symbol text not null,
  tf text not null,
  t bigint not null,
  o numeric not null,
  h numeric not null,
  l numeric not null,
  c numeric not null,
  primary key (symbol, tf, t)
);

create index if not exists idx_ohlc_bars_symbol_tf_t on ohlc_bars (symbol, tf, t);

alter table ohlc_bars enable row level security;

-- Anon can read (everyone sees same market data) and write (app backfills/upserts from API).
create policy "Allow anon read ohlc_bars"
  on ohlc_bars for select to anon using (true);

create policy "Allow anon insert ohlc_bars"
  on ohlc_bars for insert to anon with check (true);

create policy "Allow anon update ohlc_bars"
  on ohlc_bars for update to anon using (true) with check (true);
