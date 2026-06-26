-- Reminders / tasks
CREATE TABLE IF NOT EXISTS reminders (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  due_date DATE,
  owner_name TEXT,
  done BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
