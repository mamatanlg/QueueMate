-- Add private, ticket-scoped Expo push registrations and delivery receipts.
CREATE TABLE public.ticket_push_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  expo_push_token_hash char(64) NOT NULL,
  expo_push_token_ciphertext text NOT NULL,
  expo_push_token_iv varchar(24) NOT NULL,
  expo_push_token_auth_tag varchar(24) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (ticket_id, expo_push_token_hash),
  CONSTRAINT ticket_push_subscriptions_ticket_id_fkey
    FOREIGN KEY (ticket_id)
    REFERENCES public.queue_tickets (id)
    ON UPDATE NO ACTION
    ON DELETE CASCADE
);

CREATE INDEX ticket_push_subscriptions_active_ticket_idx
  ON public.ticket_push_subscriptions (ticket_id)
  WHERE is_active = true;

CREATE INDEX ticket_push_subscriptions_active_token_idx
  ON public.ticket_push_subscriptions (expo_push_token_hash)
  WHERE is_active = true;

ALTER TABLE public.ticket_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.notification_push_deliveries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  delivery_status varchar(20) NOT NULL DEFAULT 'pending',
  expo_ticket_id varchar(64),
  error_code varchar(100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  receipt_checked_at timestamptz,
  PRIMARY KEY (id),
  UNIQUE (notification_id, subscription_id),
  CONSTRAINT notification_push_deliveries_notification_id_fkey
    FOREIGN KEY (notification_id)
    REFERENCES public.notifications (id)
    ON UPDATE NO ACTION
    ON DELETE CASCADE,
  CONSTRAINT notification_push_deliveries_subscription_id_fkey
    FOREIGN KEY (subscription_id)
    REFERENCES public.ticket_push_subscriptions (id)
    ON UPDATE NO ACTION
    ON DELETE CASCADE,
  CONSTRAINT notification_push_deliveries_status_check
    CHECK (delivery_status IN (
      'pending', 'sending', 'accepted', 'delivered', 'failed', 'cancelled'
    ))
);

CREATE INDEX notification_push_deliveries_receipts_idx
  ON public.notification_push_deliveries (created_at)
  WHERE delivery_status = 'accepted' AND receipt_checked_at IS NULL;

ALTER TABLE public.notification_push_deliveries ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.deactivate_ticket_push_subscriptions_on_terminal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.status IN ('completed', 'skipped', 'expired')
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.ticket_push_subscriptions
    SET is_active = false, updated_at = now()
    WHERE ticket_id = NEW.id AND is_active = true;

    UPDATE public.notification_push_deliveries AS delivery
    SET delivery_status = 'cancelled', updated_at = now()
    FROM public.notifications AS notification
    WHERE delivery.notification_id = notification.id
      AND notification.ticket_id = NEW.id
      AND delivery.delivery_status IN ('pending', 'sending');
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER queue_tickets_deactivate_push_subscriptions
  AFTER UPDATE OF status ON public.queue_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.deactivate_ticket_push_subscriptions_on_terminal();
