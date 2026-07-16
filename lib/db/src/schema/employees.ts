import { pgTable, serial, text, real, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const employeesTable = pgTable("employees", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  department: text("department").notNull(),
  designation: text("designation").notNull(),
  employeeCode: text("employee_code").notNull(),
  status: text("status").notNull().default("active"), // active|inactive|terminated|on_leave
  joinDate: text("join_date").notNull(),
  salary: real("salary").notNull().default(0),
  managerId: integer("manager_id"),
  avatarUrl: text("avatar_url"),
  // Optional AI-task generation context (backward-compatible additions)
  skillLevel: text("skill_level"), // junior | mid | senior | lead
  workingHours: text("working_hours"), // e.g. "9:00-18:00 IST"
  currentProject: text("current_project"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employeesTable.$inferSelect;
