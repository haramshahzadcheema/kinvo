-- A ship may have at most one PENDING_APPROVAL reminder campaign at a
-- time. Prisma's schema DSL cannot express a partial/filtered unique
-- index, so this constraint is hand-authored here rather than declared in
-- schema.prisma (which only carries a plain index on the same column as a
-- query-shape hint — see the ReminderCampaign model's comment). A ship CAN
-- have multiple historical campaigns (sent, then later cancelled, then a
-- new one) — this index only ever blocks a second simultaneously-pending
-- one. Closes a real check-then-create race in
-- reminders.service.ts's createReminderCampaign: two concurrent requests
-- could both pass the "does one already exist" check before either
-- committed, previously creating two live PENDING_APPROVAL campaigns for
-- the same ship.
CREATE UNIQUE INDEX "reminder_campaigns_one_pending_per_ship"
  ON "reminder_campaigns" ("shipId")
  WHERE "status" = 'PENDING_APPROVAL';
