-- communities.icon_name usa uma lista fechada no banco. Amplia o mesmo constraint
-- para os identificadores do catálogo React, preservando todos os valores antigos.
alter table public.communities
  drop constraint if exists communities_icon_name_check;

alter table public.communities
  add constraint communities_icon_name_check
  check (icon_name is null or icon_name in (
    'apple', 'carrot', 'salad', 'utensils', 'cooking-pot', 'chef-hat',
    'fish', 'egg', 'glass-water', 'coffee', 'wheat', 'scale',
    'dumbbell', 'biceps-flexed', 'zap', 'flame', 'target', 'timer', 'medal', 'trophy',
    'route', 'bike', 'footprints', 'mountain', 'goal', 'circle-dot', 'waves', 'move',
    'heart-pulse', 'heart', 'brain', 'moon', 'leaf', 'flower-2', 'sun', 'activity',
    'users', 'messages-square', 'star', 'rocket', 'flag', 'calendar-days',
    'book-open', 'hand-heart'
  ));
