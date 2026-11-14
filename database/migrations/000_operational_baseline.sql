CREATE TABLE public.cashier_windows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  window_number integer NOT NULL,
  window_name varchar(50) NOT NULL,
  availability_status varchar(20) NOT NULL DEFAULT 'unavailable',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (window_number),
  CONSTRAINT cashier_windows_window_number_check
    CHECK (window_number BETWEEN 1 AND 4),
  CONSTRAINT cashier_windows_availability_status_check
    CHECK (availability_status IN ('available', 'unavailable'))
);

CREATE TABLE public.staff (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  username varchar(100) NOT NULL,
  password_hash text NOT NULL,
  display_name varchar(150) NOT NULL,
  role varchar(20) NOT NULL DEFAULT 'cashier',
  assigned_window_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (username),
  UNIQUE (assigned_window_id),
  CONSTRAINT staff_window_role_check
    CHECK (
    (role = 'cashier' AND assigned_window_id IS NOT NULL)
    OR (role = 'admin' AND assigned_window_id IS NULL)
  ),
  CONSTRAINT staff_role_check
    CHECK (role IN ('cashier', 'admin')),
  CONSTRAINT staff_assigned_window_id_fkey
    FOREIGN KEY (assigned_window_id)
    REFERENCES public.cashier_windows (id)
    ON UPDATE NO ACTION
    ON DELETE RESTRICT
);

CREATE TABLE public.transaction_types (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (name)
);

CREATE TABLE public.daily_queue_counters (
  business_date date NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_date),
  CONSTRAINT daily_queue_counters_last_number_check
    CHECK (last_number >= 0)
);

CREATE TABLE public.queue_tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_date date NOT NULL,
  queue_number integer NOT NULL,
  transaction_type_id uuid NOT NULL,
  ticket_token_hash text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'waiting',
  window_id uuid,
  issued_at timestamptz NOT NULL DEFAULT now(),
  called_at timestamptz,
  completed_at timestamptz,
  skipped_at timestamptz,
  expired_at timestamptz,
  PRIMARY KEY (id),
  UNIQUE (ticket_token_hash),
  CONSTRAINT queue_tickets_queue_number_check CHECK (queue_number > 0),
  CONSTRAINT queue_tickets_status_check
    CHECK (status IN ('waiting', 'serving', 'completed', 'skipped', 'expired')),
  CONSTRAINT queue_tickets_transaction_type_id_fkey
    FOREIGN KEY (transaction_type_id)
    REFERENCES public.transaction_types (id)
    ON UPDATE NO ACTION
    ON DELETE RESTRICT,
  CONSTRAINT queue_tickets_window_id_fkey
    FOREIGN KEY (window_id)
    REFERENCES public.cashier_windows (id)
    ON UPDATE NO ACTION
    ON DELETE RESTRICT
);

CREATE TABLE public.queue_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  staff_id uuid,
  window_id uuid,
  action varchar(30) NOT NULL,
  previous_status varchar(20),
  new_status varchar(20),
  details jsonb NOT NULL DEFAULT '0'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT queue_history_action_check
    CHECK (action IN ('issued', 'called', 'completed', 'skipped', 'expired')),
  CONSTRAINT queue_history_ticket_id_fkey
    FOREIGN KEY (ticket_id)
    REFERENCES public.queue_tickets (id)
    ON UPDATE NO ACTION
    ON DELETE RESTRICT,
  CONSTRAINT queue_history_staff_id_fkey
    FOREIGN KEY (staff_id)
    REFERENCES public.staff (id)
    ON UPDATE NO ACTION
    ON DELETE SET NULL,
  CONSTRAINT queue_history_window_id_fkey
    FOREIGN KEY (window_id)
    REFERENCES public.cashier_windows (id)
    ON UPDATE NO ACTION
    ON DELETE SET NULL
);

CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  alert_type varchar(20) NOT NULL,
  delivery_status varchar(20) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT notifications_alert_type_check
    CHECK (alert_type IN ('near_turn', 'called')),
  CONSTRAINT notifications_delivery_status_check
    CHECK (delivery_status IN ('pending', 'sent', 'failed')),
  CONSTRAINT notifications_ticket_id_fkey
    FOREIGN KEY (ticket_id)
    REFERENCES public.queue_tickets (id)
    ON UPDATE NO ACTION
    ON DELETE RESTRICT
);

CREATE TABLE public.system_settings (
  setting_key varchar(100) NOT NULL,
  setting_value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (setting_key)
);

CREATE UNIQUE INDEX unique_daily_queue_number
  ON public.queue_tickets (business_date, queue_number);

CREATE INDEX idx_queue_waiting
  ON public.queue_tickets (business_date, queue_number)
  WHERE status = 'waiting';

CREATE INDEX idx_queue_window
  ON public.queue_tickets (window_id, status);

CREATE UNIQUE INDEX one_serving_ticket_per_window
  ON public.queue_tickets (window_id)
  WHERE status = 'serving';

CREATE UNIQUE INDEX unique_ticket_alert
  ON public.notifications (ticket_id, alert_type);

CREATE INDEX idx_notifications_ticket
  ON public.notifications (ticket_id);

CREATE INDEX idx_queue_history_ticket
  ON public.queue_history (ticket_id, created_at);

INSERT INTO public.cashier_windows
  (window_number, window_name, availability_status, is_active)
VALUES
  (1, 'Window 1', 'unavailable', true),
  (2, 'Window 2', 'unavailable', true),
  (3, 'Window 3', 'unavailable', true),
  (4, 'Window 4', 'unavailable', true);

INSERT INTO public.transaction_types (name, description, is_active)
VALUES
  ('Payment', 'Payment-related transactions', true),
  ('SOA', 'Statement of Account inquiries', true),
  ('Other Transactions', 'Other Business Office transactions', true);

INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES
  (
    'business_timezone',
    '"Asia/Manila"'::jsonb,
    'Timezone used for daily queue numbering'
  ),
  (
    'daily_number_reset',
    'true'::jsonb,
    'Start queue numbering at 001 each business day'
  ),
  (
    'near_turn_offset',
    '5'::jsonb,
    'Trigger near-turn alert when ticket N-5 is called'
  );

ALTER TABLE public.cashier_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_queue_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
