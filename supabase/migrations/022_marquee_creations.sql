-- Add the "Carved by You" row to the per-section homepage motion settings.
alter table public.site_settings
  alter column marquee_settings set default '{
    "collections": { "enabled": true,  "speed": 45, "direction": "left"  },
    "bestsellers": { "enabled": true,  "speed": 50, "direction": "left"  },
    "premium":     { "enabled": true,  "speed": 90, "direction": "left"  },
    "madeforyou":  { "enabled": false, "speed": 60, "direction": "left"  },
    "creations":   { "enabled": true,  "speed": 55, "direction": "left"  },
    "reviews":     { "enabled": true,  "speed": 60, "direction": "left"  }
  }'::jsonb;

update public.site_settings
  set marquee_settings = marquee_settings || '{"creations":{"enabled":true,"speed":55,"direction":"left"}}'::jsonb
  where not (marquee_settings ? 'creations');
