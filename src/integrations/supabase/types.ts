export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          business_id: string | null
          created_at: string
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          business_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          business_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_members: {
        Row: {
          business_id: string
          id: string
          invited_at: string | null
          is_active: boolean
          joined_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          business_id: string
          id?: string
          invited_at?: string | null
          is_active?: boolean
          joined_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          business_id?: string
          id?: string
          invited_at?: string | null
          is_active?: boolean
          joined_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_members_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_modules: {
        Row: {
          business_id: string
          id: string
          is_enabled: boolean
          limits: Json | null
          module_id: string
        }
        Insert: {
          business_id: string
          id?: string
          is_enabled?: boolean
          limits?: Json | null
          module_id: string
        }
        Update: {
          business_id?: string
          id?: string
          is_enabled?: boolean
          limits?: Json | null
          module_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_modules_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_modules_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      business_settings: {
        Row: {
          business_id: string
          created_at: string
          id: string
          invoice_prefix: string | null
          next_invoice_number: number
          tax_rate: number | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          invoice_prefix?: string | null
          next_invoice_number?: number
          tax_rate?: number | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          invoice_prefix?: string | null
          next_invoice_number?: number
          tax_rate?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          created_at: string
          currency: string
          id: string
          industry: string | null
          logo_url: string | null
          name: string
          slug: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          industry?: string | null
          logo_url?: string | null
          name: string
          slug?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          industry?: string | null
          logo_url?: string | null
          name?: string
          slug?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          business_id: string
          company: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          company?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          company?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_absences: {
        Row: {
          absence_type: Database["public"]["Enums"]["absence_type"]
          business_id: string
          created_at: string
          created_by: string | null
          custom_type_label: string | null
          days_count: number
          employee_id: string
          end_date: string
          id: string
          reason: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          start_date: string
          status: Database["public"]["Enums"]["absence_status"]
          updated_at: string
        }
        Insert: {
          absence_type: Database["public"]["Enums"]["absence_type"]
          business_id: string
          created_at?: string
          created_by?: string | null
          custom_type_label?: string | null
          days_count: number
          employee_id: string
          end_date: string
          id?: string
          reason?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["absence_status"]
          updated_at?: string
        }
        Update: {
          absence_type?: Database["public"]["Enums"]["absence_type"]
          business_id?: string
          created_at?: string
          created_by?: string | null
          custom_type_label?: string | null
          days_count?: number
          employee_id?: string
          end_date?: string
          id?: string
          reason?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["absence_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_absences_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_absences_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_employees: {
        Row: {
          annual_vacation_days: number
          business_id: string
          created_at: string
          hire_date: string | null
          id: string
          is_active: boolean
          updated_at: string
          user_id: string
          weekly_hours: number
        }
        Insert: {
          annual_vacation_days?: number
          business_id: string
          created_at?: string
          hire_date?: string | null
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id: string
          weekly_hours?: number
        }
        Update: {
          annual_vacation_days?: number
          business_id?: string
          created_at?: string
          hire_date?: string | null
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id?: string
          weekly_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "hr_employees_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_schedules: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          employee_id: string
          end_time: string
          id: string
          notes: string | null
          shift_date: string
          start_time: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          employee_id: string
          end_time: string
          id?: string
          notes?: string | null
          shift_date: string
          start_time: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
          end_time?: string
          id?: string
          notes?: string | null
          shift_date?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_schedules_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_schedules_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_time_entries: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          employee_id: string
          entry_type: Database["public"]["Enums"]["time_entry_type"]
          id: string
          latitude: number | null
          longitude: number | null
          notes: string | null
          occurred_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          employee_id: string
          entry_type: Database["public"]["Enums"]["time_entry_type"]
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          occurred_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
          entry_type?: Database["public"]["Enums"]["time_entry_type"]
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_time_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_time_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_work_sessions: {
        Row: {
          break_seconds: number
          business_id: string
          clock_in_at: string
          clock_out_at: string | null
          created_at: string
          employee_id: string
          id: string
          last_break_start: string | null
          session_date: string
          status: Database["public"]["Enums"]["work_session_status"]
          updated_at: string
          worked_seconds: number
        }
        Insert: {
          break_seconds?: number
          business_id: string
          clock_in_at: string
          clock_out_at?: string | null
          created_at?: string
          employee_id: string
          id?: string
          last_break_start?: string | null
          session_date: string
          status?: Database["public"]["Enums"]["work_session_status"]
          updated_at?: string
          worked_seconds?: number
        }
        Update: {
          break_seconds?: number
          business_id?: string
          clock_in_at?: string
          clock_out_at?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          last_break_start?: string | null
          session_date?: string
          status?: Database["public"]["Enums"]["work_session_status"]
          updated_at?: string
          worked_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "hr_work_sessions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_work_sessions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          description: string
          id: string
          invoice_id: string
          product_id: string | null
          quantity: number
          total: number
          unit_price: number
        }
        Insert: {
          description: string
          id?: string
          invoice_id: string
          product_id?: string | null
          quantity?: number
          total?: number
          unit_price?: number
        }
        Update: {
          description?: string
          id?: string
          invoice_id?: string
          product_id?: string | null
          quantity?: number
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          business_id: string
          client_id: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          invoice_number: string
          notes: string | null
          paid_at: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tax: number
          total: number
          updated_at: string
        }
        Insert: {
          business_id: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          invoice_number: string
          notes?: string | null
          paid_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
        }
        Update: {
          business_id?: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string
          notes?: string | null
          paid_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_posts: {
        Row: {
          assignee_id: string | null
          business_id: string
          channels: string[]
          content_type: string
          copy: string | null
          created_at: string
          created_by: string | null
          hashtags: string | null
          id: string
          notes: string | null
          reference_url: string | null
          scheduled_at: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          business_id: string
          channels?: string[]
          content_type: string
          copy?: string | null
          created_at?: string
          created_by?: string | null
          hashtags?: string | null
          id?: string
          notes?: string | null
          reference_url?: string | null
          scheduled_at?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          business_id?: string
          channels?: string[]
          content_type?: string
          copy?: string | null
          created_at?: string
          created_by?: string | null
          hashtags?: string | null
          id?: string
          notes?: string | null
          reference_url?: string | null
          scheduled_at?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_posts_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_posts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          created_at: string
          description: string | null
          display_order: number | null
          id: string
          is_active: boolean
          key: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean
          key: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean
          key?: string
          name?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string | null
          notes: string | null
          payment_date: string
          payment_method: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          payment_date?: string
          payment_method?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          payment_date?: string
          payment_method?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_modules: {
        Row: {
          id: string
          limits: Json | null
          module_id: string
          plan_id: string
        }
        Insert: {
          id?: string
          limits?: Json | null
          module_id: string
          plan_id: string
        }
        Update: {
          id?: string
          limits?: Json | null
          module_id?: string
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_modules_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_modules_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          created_at: string
          display_order: number | null
          id: string
          is_active: boolean
          key: string
          limits: Json | null
          name: string
          price_monthly: number | null
          price_yearly: number | null
        }
        Insert: {
          created_at?: string
          display_order?: number | null
          id?: string
          is_active?: boolean
          key: string
          limits?: Json | null
          name: string
          price_monthly?: number | null
          price_yearly?: number | null
        }
        Update: {
          created_at?: string
          display_order?: number | null
          id?: string
          is_active?: boolean
          key?: string
          limits?: Json | null
          name?: string
          price_monthly?: number | null
          price_yearly?: number | null
        }
        Relationships: []
      }
      platform_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          id: string
          notes: string | null
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          notes?: string | null
          role: Database["public"]["Enums"]["platform_role"]
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          notes?: string | null
          role?: Database["public"]["Enums"]["platform_role"]
          user_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          business_id: string
          category: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          price: number
          stock_quantity: number | null
          track_inventory: boolean | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          price?: number
          stock_quantity?: number | null
          track_inventory?: boolean | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          stock_quantity?: number | null
          track_inventory?: boolean | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_business_id: string | null
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          active_business_id?: string | null
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          active_business_id?: string | null
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_business_id_fkey"
            columns: ["active_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          id: string
          product_id: string | null
          product_name: string
          quantity: number
          sale_id: string
          total: number
          unit_price: number
        }
        Insert: {
          id?: string
          product_id?: string | null
          product_name: string
          quantity?: number
          sale_id: string
          total?: number
          unit_price?: number
        }
        Update: {
          id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          sale_id?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          business_id: string
          client_id: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          payment_method: string | null
          sale_number: string
          subtotal: number
          tax: number
          total: number
        }
        Insert: {
          business_id: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          payment_method?: string | null
          sale_number: string
          subtotal?: number
          tax?: number
          total?: number
        }
        Update: {
          business_id?: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          payment_method?: string | null
          sale_number?: string
          subtotal?: number
          tax?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          business_id: string
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_id: string
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      clock_action: {
        Args: {
          _business_id: string
          _entry_type: Database["public"]["Enums"]["time_entry_type"]
          _latitude?: number
          _longitude?: number
          _notes?: string
        }
        Returns: string
      }
      create_invoice_with_items: {
        Args: {
          _business_id: string
          _client_id: string
          _due_date?: string
          _items: Json
          _notes?: string
        }
        Returns: {
          invoice_id: string
          invoice_number: string
        }[]
      }
      create_payment_and_recalc_invoice: {
        Args: {
          _amount: number
          _business_id: string
          _invoice_id: string
          _notes?: string
          _payment_date?: string
          _payment_method?: string
        }
        Returns: string
      }
      ensure_hr_employee: { Args: { _business_id: string }; Returns: string }
      generate_invoice_number: {
        Args: { _business_id: string }
        Returns: string
      }
      generate_sale_number: { Args: { _business_id: string }; Returns: string }
      get_active_business: { Args: never; Returns: string }
      get_dashboard_metrics: {
        Args: { _business_id: string }
        Returns: {
          active_clients: number
          monthly_payments_count: number
          monthly_revenue: number
          overdue_amount: number
          overdue_invoices: number
          pending_amount: number
          pending_invoices: number
          prev_active_clients: number
          prev_monthly_payments_count: number
          prev_monthly_revenue: number
        }[]
      }
      get_employee_monthly_report: {
        Args: {
          _business_id: string
          _employee_id: string
          _month: number
          _year: number
        }
        Returns: {
          break_seconds: number
          clock_in_at: string
          clock_out_at: string
          session_date: string
          status: Database["public"]["Enums"]["work_session_status"]
          worked_seconds: number
        }[]
      }
      get_hr_dashboard: {
        Args: { _business_id: string }
        Returns: {
          my_employee_id: string
          my_last_entry_type: Database["public"]["Enums"]["time_entry_type"]
          my_session_clock_in: string
          my_session_status: string
          pending_absences: number
          team_on_vacation_today: number
          vacation_days_pending: number
          vacation_days_total: number
          vacation_days_used: number
        }[]
      }
      get_recent_activity: {
        Args: { _business_id: string; _limit?: number }
        Returns: {
          amount: number
          created_at: string
          description: string
          event_id: string
          event_type: string
          title: string
        }[]
      }
      get_user_role_in_business: {
        Args: { _business_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_business_role: {
        Args: {
          _business_id: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      has_min_role: {
        Args: {
          _business_id: string
          _min_role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      has_platform_role: {
        Args: {
          _role: Database["public"]["Enums"]["platform_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_member_of_business: {
        Args: { _business_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      request_absence: {
        Args: {
          _absence_type: Database["public"]["Enums"]["absence_type"]
          _business_id: string
          _custom_label?: string
          _end_date: string
          _reason?: string
          _start_date: string
        }
        Returns: string
      }
      review_absence: {
        Args: { _absence_id: string; _approve: boolean; _notes?: string }
        Returns: undefined
      }
      set_active_business: { Args: { _business_id: string }; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      absence_status: "pending" | "approved" | "rejected" | "cancelled"
      absence_type: "vacation" | "sick_leave" | "personal" | "other"
      app_role: "owner" | "admin" | "staff"
      invoice_status: "draft" | "sent" | "paid" | "overdue" | "cancelled"
      module_type:
        | "clients"
        | "products"
        | "invoicing"
        | "payments"
        | "ai_advisor"
        | "reports"
      platform_role: "super_admin" | "support"
      subscription_plan: "free" | "trial" | "pro" | "business"
      subscription_status: "active" | "cancelled" | "past_due" | "trialing"
      time_entry_type: "clock_in" | "break_start" | "break_end" | "clock_out"
      work_session_status: "open" | "closed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      absence_status: ["pending", "approved", "rejected", "cancelled"],
      absence_type: ["vacation", "sick_leave", "personal", "other"],
      app_role: ["owner", "admin", "staff"],
      invoice_status: ["draft", "sent", "paid", "overdue", "cancelled"],
      module_type: [
        "clients",
        "products",
        "invoicing",
        "payments",
        "ai_advisor",
        "reports",
      ],
      platform_role: ["super_admin", "support"],
      subscription_plan: ["free", "trial", "pro", "business"],
      subscription_status: ["active", "cancelled", "past_due", "trialing"],
      time_entry_type: ["clock_in", "break_start", "break_end", "clock_out"],
      work_session_status: ["open", "closed"],
    },
  },
} as const
