-- Block-composer state for the admin email template builder. body_html stays
-- the rendered source of truth (the send path reads only body_html); blocks
-- is the editable structure the composer reloads.
alter table email_template_overrides add column if not exists blocks jsonb;
