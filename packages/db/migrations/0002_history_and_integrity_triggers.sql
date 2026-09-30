-- History that must never be rewritten (FR-18, ADR-0008).
--
-- Triggers fire for every role, including the table owner. A bug, a careless
-- migration or a manual psql session can't rewrite history without first
-- dropping a trigger, and dropping one is itself a visible, reviewed change.

CREATE FUNCTION forbid_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING HINT = 'Corrections are new rows. History is never updated or deleted.';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER messages_append_only
  BEFORE UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER messages_no_truncate
  BEFORE TRUNCATE ON messages
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_change();
--> statement-breakpoint

-- A ticket's identity and original request are fixed once it exists. Status,
-- priority, assignment and escalation change, and each change writes an
-- audit event in the same transaction.
CREATE FUNCTION tickets_forbid_write_once_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  changed text[] := '{}';
BEGIN
  IF NEW.reference IS DISTINCT FROM OLD.reference THEN changed := array_append(changed, 'reference'); END IF;
  IF NEW.number IS DISTINCT FROM OLD.number THEN changed := array_append(changed, 'number'); END IF;
  IF NEW.brand_id IS DISTINCT FROM OLD.brand_id THEN changed := array_append(changed, 'brand_id'); END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN changed := array_append(changed, 'customer_id'); END IF;
  IF NEW.channel IS DISTINCT FROM OLD.channel THEN changed := array_append(changed, 'channel'); END IF;
  IF NEW.subject IS DISTINCT FROM OLD.subject THEN changed := array_append(changed, 'subject'); END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN changed := array_append(changed, 'description'); END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN changed := array_append(changed, 'created_at'); END IF;
  IF cardinality(changed) > 0 THEN
    RAISE EXCEPTION 'tickets.% cannot change after the ticket is created', array_to_string(changed, ', ');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tickets_write_once
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION tickets_forbid_write_once_change();
--> statement-breakpoint

-- The human-friendly reference: the brand's prefix, a hyphen and the number
-- padded to at least six digits (DSD-000123). Larger numbers get longer
-- (DSD-1234567) and are never truncated. Whatever the insert supplies is
-- replaced, so a reference can't be chosen by the caller.
CREATE FUNCTION tickets_set_reference() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prefix text;
  digits text := NEW.number::text;
BEGIN
  SELECT ticket_prefix INTO prefix FROM public.brands WHERE id = NEW.brand_id;
  IF prefix IS NULL THEN
    -- Report it as the foreign key violation it is, rather than a NULL
    -- reference, because this trigger runs before the key is checked.
    RAISE foreign_key_violation USING MESSAGE = format('brand %s does not exist', NEW.brand_id);
  END IF;
  NEW.reference := prefix || '-' || lpad(digits, greatest(6, length(digits)), '0');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tickets_set_reference
  BEFORE INSERT ON tickets
  FOR EACH ROW EXECUTE FUNCTION tickets_set_reference();
--> statement-breakpoint
ALTER SEQUENCE ticket_number_seq OWNED BY tickets.number;
