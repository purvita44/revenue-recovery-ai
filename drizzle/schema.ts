import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const recoveryAuditEvents = mysqlTable("recoveryAuditEvents", {
  id: int("id").autoincrement().primaryKey(),
  eventId: varchar("eventId", { length: 80 }).notNull().unique(),
  caseId: varchar("caseId", { length: 32 }).notNull(),
  kind: varchar("kind", { length: 32 }).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  detail: text("detail").notNull(),
  status: varchar("status", { length: 24 }).notNull(),
  eventTimestamp: timestamp("eventTimestamp").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RecoveryAuditEvent = typeof recoveryAuditEvents.$inferSelect;
export type InsertRecoveryAuditEvent = typeof recoveryAuditEvents.$inferInsert;