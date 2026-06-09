// Database types for Pymova AI
// These types mirror the Supabase schema

export type AppRole = 'owner' | 'admin' | 'staff';
export type SubscriptionStatus = 'active' | 'cancelled' | 'past_due' | 'trialing';
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';

// Module keys for type safety (maps to modules.key in DB)
export type ModuleKey = 'clients' | 'products' | 'invoicing' | 'payments' | 'ai_advisor' | 'reports' | 'retail' | 'marketing' | 'hr';

// HR module
export type AbsenceType = 'vacation' | 'sick_leave' | 'personal' | 'other';
export type AbsenceStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type TimeEntryType = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';
export type WorkSessionStatus = 'open' | 'closed';
export type PermissionType = 'late_arrival' | 'early_departure' | 'personal_errand' | 'other';

export interface HrPermission {
  id: string;
  business_id: string;
  employee_id: string;
  permission_type: PermissionType;
  custom_type_label: string | null;
  status: AbsenceStatus;
  permission_date: string;
  start_time: string;
  end_time: string;
  hours_count: number;
  reason: string | null;
  reviewer_id: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface HrEmployee {
  id: string;
  business_id: string;
  user_id: string;
  hire_date: string | null;
  weekly_hours: number;
  annual_vacation_days: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface HrTimeEntry {
  id: string;
  business_id: string;
  employee_id: string;
  entry_type: TimeEntryType;
  occurred_at: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface HrWorkSession {
  id: string;
  business_id: string;
  employee_id: string;
  session_date: string;
  clock_in_at: string;
  clock_out_at: string | null;
  break_seconds: number;
  worked_seconds: number;
  status: WorkSessionStatus;
  last_break_start: string | null;
  created_at: string;
  updated_at: string;
}

export interface HrAbsence {
  id: string;
  business_id: string;
  employee_id: string;
  absence_type: AbsenceType;
  custom_type_label: string | null;
  status: AbsenceStatus;
  start_date: string;
  end_date: string;
  days_count: number;
  reason: string | null;
  reviewer_id: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface HrSchedule {
  id: string;
  business_id: string;
  employee_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface HrDashboard {
  my_employee_id: string | null;
  my_session_status: 'none' | 'open' | 'closed';
  my_session_clock_in: string | null;
  my_last_entry_type: TimeEntryType | null;
  pending_absences: number;
  team_on_vacation_today: number;
  vacation_days_total: number;
  vacation_days_used: number;
  vacation_days_pending: number;
}

// Marketing calendar
export type MarketingContentType = 'story' | 'post' | 'reel';
export type MarketingChannel = 'instagram' | 'facebook';
export type MarketingStatus = 'idea' | 'draft' | 'scheduled' | 'published' | 'cancelled';

export interface MarketingPost {
  id: string;
  business_id: string;
  title: string;
  copy: string | null;
  content_type: MarketingContentType;
  channels: MarketingChannel[];
  status: MarketingStatus;
  scheduled_at: string | null;
  assignee_id: string | null;
  reference_url: string | null;
  hashtags: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Plan keys for type safety (maps to plans.key in DB)
export type PlanKey = 'free' | 'trial' | 'pro' | 'business';

export interface Profile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  active_business_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Plan {
  id: string;
  key: PlanKey;
  name: string;
  price_monthly: number;
  price_yearly: number;
  limits: Record<string, unknown>;
  is_active: boolean;
  display_order: number;
  created_at: string;
}

export interface Module {
  id: string;
  key: ModuleKey;
  name: string;
  description: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
}

export interface PlanModule {
  id: string;
  plan_id: string;
  module_id: string;
  limits: Record<string, unknown>;
}

export interface Business {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  industry: string | null;
  currency: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface BusinessMember {
  id: string;
  business_id: string;
  user_id: string;
  role: AppRole;
  is_active: boolean;
  invited_at: string | null;
  joined_at: string | null;
}

export interface Subscription {
  id: string;
  business_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessModule {
  id: string;
  business_id: string;
  module_id: string;
  is_enabled: boolean;
  limits: Record<string, unknown>;
}

export interface BusinessSettings {
  id: string;
  business_id: string;
  next_invoice_number: number;
  invoice_prefix: string;
  tax_rate: number;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  business_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  price: number;
  unit: string | null;
  category: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  business_id: string;
  client_id: string | null;
  invoice_number: string;
  status: InvoiceStatus;
  subtotal: number;
  tax: number;
  total: number;
  due_date: string | null;
  paid_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  product_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface Payment {
  id: string;
  business_id: string;
  invoice_id: string | null;
  amount: number;
  payment_method: string | null;
  payment_date: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  business_id: string | null;
  user_id: string | null;
  actor_user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

// Extended types with relations
export interface BusinessWithMembership extends Business {
  role: AppRole;
  subscription?: Subscription;
  modules?: BusinessModuleWithKey[];
}

// Business module with the module key for access checks
export interface BusinessModuleWithKey extends BusinessModule {
  module_key: ModuleKey;
}

// Invoice with joined client name for display
export interface InvoiceWithClient extends Invoice {
  client_name?: string;
}

// Payment with joined invoice info for display
export interface PaymentWithInvoice extends Payment {
  invoice_number?: string;
  invoice_total?: number;
}

// Invoice info for payment form selector
export interface InvoiceForPayment {
  id: string;
  invoice_number: string;
  total: number;
  status: InvoiceStatus;
  due_date: string | null;
  client_name?: string;
  total_paid: number;
  pending: number;
}

// Data for creating a new payment
export interface CreatePaymentData {
  invoice_id: string;
  amount: number;
  payment_method?: string;
  payment_date: string;
  notes?: string;
}
