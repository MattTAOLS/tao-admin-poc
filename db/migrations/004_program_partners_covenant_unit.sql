-- A program can be visible to several partners (docs/portal-map.md shows MOVE Trust and F-PIL in both the Investor
-- and Manager portals). program.partner_slug stays as the first partner; program_partner is the visibility list the
-- API's partner_filter reads. Existing rows carry over their single partner.
create table program_partner (
  program_slug text not null references program(slug) on delete cascade,
  partner_slug text not null references partner(slug),
  primary key (program_slug, partner_slug)
);
insert into program_partner (program_slug, partner_slug) select slug, partner_slug from program;

-- The unit a covenant threshold is expressed in, so screens stop guessing from its size.
alter table covenant_definition add column unit text check (unit in ('fraction', 'ratio', 'currency'));
