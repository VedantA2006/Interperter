import { pgTable, serial, text, timestamp, integer, json } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const strategies = pgTable('strategies', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const strategyVersions = pgTable('strategy_versions', {
  id: serial('id').primaryKey(),
  strategyId: integer('strategy_id').references(() => strategies.id).notNull(),
  parentVersionId: integer('parent_version_id'),
  versionStr: text('version_str').notNull(), // e.g. "V1", "V1.1"
  sourceCode: text('source_code').notNull(),
  hypothesis: text('hypothesis'),
  status: text('status').notNull().default('candidate'), // candidate, rejected, promising, robust
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const backtests = pgTable('backtests', {
  id: serial('id').primaryKey(),
  versionId: integer('version_id').references(() => strategyVersions.id).notNull(),
  config: json('config').notNull(),
  status: text('status').notNull().default('running'), // running, completed, failed
  results: json('results'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

// Relations
export const strategiesRelations = relations(strategies, ({ many }) => ({
  versions: many(strategyVersions),
}));

export const strategyVersionsRelations = relations(strategyVersions, ({ one, many }) => ({
  strategy: one(strategies, {
    fields: [strategyVersions.strategyId],
    references: [strategies.id],
  }),
  parent: one(strategyVersions, {
    fields: [strategyVersions.parentVersionId],
    references: [strategyVersions.id],
  }),
  backtests: many(backtests),
}));

export const backtestsRelations = relations(backtests, ({ one }) => ({
  version: one(strategyVersions, {
    fields: [backtests.versionId],
    references: [strategyVersions.id],
  }),
}));

export const ai_logs = pgTable('ai_logs', {
  id: serial('id').primaryKey(),
  strategyId: integer('strategy_id').references(() => strategies.id),
  action: text('action').notNull(),
  rationale: text('rationale'),
  metadata: json('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const webhook_events = pgTable('webhook_events', {
  id: serial('id').primaryKey(),
  payload: json('payload').notNull(),
  status: text('status').notNull().default('received'), // received, processed, failed
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const forward_test_results = pgTable('forward_test_results', {
  id: serial('id').primaryKey(),
  versionId: integer('version_id').references(() => strategyVersions.id).notNull(),
  tradeId: text('trade_id').notNull(),
  expectedEntryTime: integer('expected_entry_time'),
  actualEntryTime: integer('actual_entry_time'),
  expectedPrice: integer('expected_price'),
  actualPrice: integer('actual_price'),
  consistencyScore: integer('consistency_score'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
