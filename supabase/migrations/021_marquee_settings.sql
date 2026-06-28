-- Per-section homepage motion controls (speed + direction + on/off), edited in
-- admin → Settings → Homepage motion and read by the homepage marquees.
alter table public.site_settings
  add column if not exists marquee_settings jsonb not null default '{
    "collections": { "enabled": true,  "speed": 45, "direction": "left"  },
    "bestsellers": { "enabled": true,  "speed": 50, "direction": "left"  },
    "premium":     { "enabled": true,  "speed": 90, "direction": "left"  },
    "madeforyou":  { "enabled": false, "speed": 60, "direction": "left"  },
    "reviews":     { "enabled": true,  "speed": 60, "direction": "left"  }
  }'::jsonb;
