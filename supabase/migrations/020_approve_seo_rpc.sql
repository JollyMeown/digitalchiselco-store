-- Bulk-approve SEO proposals. Promotes proposed_* -> live columns for products
-- in 'generated' status, either all of them (p_ids null) or a specific set.
-- One SQL statement instead of N browser round-trips. SECURITY INVOKER so the
-- caller's RLS applies (only admins can update products).

create or replace function public.approve_seo(p_ids uuid[] default null)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare n integer;
begin
  update public.products p set
    original_title  = coalesce(p.original_title, p.title),
    title           = coalesce(nullif(p.proposed_title, ''), p.title),
    description     = coalesce(nullif(p.proposed_body, ''), p.description),
    seo_title       = nullif(p.proposed_seo_title, ''),
    seo_description = nullif(p.proposed_seo_description, ''),
    image_alt       = nullif(p.proposed_alt_text, ''),
    seo_status      = 'approved',
    seo_reviewed_at = now()
  where p.seo_status = 'generated'
    and (p_ids is null or p.id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;
