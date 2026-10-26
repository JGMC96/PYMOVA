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
          actor_is_super_admin: boolean | null
          actor_user_id: string | null
          business_id: string | null
          created_at: string
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
          reason: string | null
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          actor_is_super_admin?: boolean | null
          actor_user_id?: string | null
          business_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          reason?: string | null
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          actor_is_super_admin?: boolean | null
          actor_user_id?: string | null
          business_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          reason?: string | null
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
      business_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          business_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          business_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          business_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_invitations_business_id_fkey"
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
          ean_prefix: string | null
          id: string
          invoice_prefix: string | null
          next_invoice_number: number
          next_online_order_number: number
          next_return_number: number
          next_sale_number: number
          sku_pattern: string | null
          tax_rate: number | null
          ticket_address: string | null
          ticket_bold_items: boolean
          ticket_font_size: string
          ticket_footer: string | null
          ticket_header: string | null
          ticket_legal_name: string | null
          ticket_line_spacing: string
          ticket_phone: string | null
          ticket_return_policy: string | null
          ticket_show_logo: boolean
          ticket_tax_id: string | null
          ticket_trade_name: string | null
          ticket_website: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          ean_prefix?: string | null
          id?: string
          invoice_prefix?: string | null
          next_invoice_number?: number
          next_online_order_number?: number
          next_return_number?: number
          next_sale_number?: number
          sku_pattern?: string | null
          tax_rate?: number | null
          ticket_address?: string | null
          ticket_bold_items?: boolean
          ticket_font_size?: string
          ticket_footer?: string | null
          ticket_header?: string | null
          ticket_legal_name?: string | null
          ticket_line_spacing?: string
          ticket_phone?: string | null
          ticket_return_policy?: string | null
          ticket_show_logo?: boolean
          ticket_tax_id?: string | null
          ticket_trade_name?: string | null
          ticket_website?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          ean_prefix?: string | null
          id?: string
          invoice_prefix?: string | null
          next_invoice_number?: number
          next_online_order_number?: number
          next_return_number?: number
          next_sale_number?: number
          sku_pattern?: string | null
          tax_rate?: number | null
          ticket_address?: string | null
          ticket_bold_items?: boolean
          ticket_font_size?: string
          ticket_footer?: string | null
          ticket_header?: string | null
          ticket_legal_name?: string | null
          ticket_line_spacing?: string
          ticket_phone?: string | null
          ticket_return_policy?: string | null
          ticket_show_logo?: boolean
          ticket_tax_id?: string | null
          ticket_trade_name?: string | null
          ticket_website?: string | null
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
          legal_name: string | null
          logo_url: string | null
          name: string
          slug: string | null
          store_profile: Database["public"]["Enums"]["store_profile"]
          tax_id: string | null
          timezone: string
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          industry?: string | null
          legal_name?: string | null
          logo_url?: string | null
          name: string
          slug?: string | null
          store_profile?: Database["public"]["Enums"]["store_profile"]
          tax_id?: string | null
          timezone?: string
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          industry?: string | null
          legal_name?: string | null
          logo_url?: string | null
          name?: string
          slug?: string | null
          store_profile?: Database["public"]["Enums"]["store_profile"]
          tax_id?: string | null
          timezone?: string
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cash_register_sessions: {
        Row: {
          business_id: string
          close_authorized_by_employee_id: string | null
          closed_at: string | null
          closed_by: string | null
          closed_by_employee_id: string | null
          counted_amount: number | null
          created_at: string
          difference: number | null
          expected_amount: number | null
          id: string
          notes: string | null
          opened_at: string
          opened_by: string | null
          opened_by_employee_id: string | null
          opening_amount: number
          status: Database["public"]["Enums"]["register_status"]
          updated_at: string
        }
        Insert: {
          business_id: string
          close_authorized_by_employee_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_by_employee_id?: string | null
          counted_amount?: number | null
          created_at?: string
          difference?: number | null
          expected_amount?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opened_by_employee_id?: string | null
          opening_amount?: number
          status?: Database["public"]["Enums"]["register_status"]
          updated_at?: string
        }
        Update: {
          business_id?: string
          close_authorized_by_employee_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_by_employee_id?: string | null
          counted_amount?: number | null
          created_at?: string
          difference?: number | null
          expected_amount?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opened_by_employee_id?: string | null
          opening_amount?: number
          status?: Database["public"]["Enums"]["register_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_register_sessions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_register_sessions_close_authorized_by_employee_id_fkey"
            columns: ["close_authorized_by_employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_register_sessions_closed_by_employee_id_fkey"
            columns: ["closed_by_employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_register_sessions_opened_by_employee_id_fkey"
            columns: ["opened_by_employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_code_reservations: {
        Row: {
          business_id: string
          code: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          variant_id: string | null
        }
        Insert: {
          business_id: string
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          variant_id?: string | null
        }
        Update: {
          business_id?: string
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_code_reservations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_code_reservations_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          business_id: string
          company: string | null
          created_at: string
          created_by: string | null
          email: string | null
          external_id: string | null
          external_source: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          receipt_email_consent: boolean
          receipt_email_consent_at: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          company?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          receipt_email_consent?: boolean
          receipt_email_consent_at?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          company?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          receipt_email_consent?: boolean
          receipt_email_consent_at?: string | null
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
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
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
      hr_employee_permissions: {
        Row: {
          business_id: string
          can_adjust_stock: boolean | null
          can_close_register: boolean
          can_edit_catalog: boolean | null
          can_return: boolean
          can_see_costs: boolean | null
          employee_id: string
          id: string
          max_discount_pct: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          business_id: string
          can_adjust_stock?: boolean | null
          can_close_register?: boolean
          can_edit_catalog?: boolean | null
          can_return?: boolean
          can_see_costs?: boolean | null
          employee_id: string
          id?: string
          max_discount_pct?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          business_id?: string
          can_adjust_stock?: boolean | null
          can_close_register?: boolean
          can_edit_catalog?: boolean | null
          can_return?: boolean
          can_see_costs?: boolean | null
          employee_id?: string
          id?: string
          max_discount_pct?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_employee_permissions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_employee_permissions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_employee_pins: {
        Row: {
          employee_id: string
          failed_attempts: number
          locked_until: string | null
          pin_hash: string
          updated_at: string
        }
        Insert: {
          employee_id: string
          failed_attempts?: number
          locked_until?: string | null
          pin_hash: string
          updated_at?: string
        }
        Update: {
          employee_id?: string
          failed_attempts?: number
          locked_until?: string | null
          pin_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_employee_pins_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
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
          display_name: string | null
          hire_date: string | null
          id: string
          is_active: boolean
          updated_at: string
          user_id: string | null
          weekly_hours: number
        }
        Insert: {
          annual_vacation_days?: number
          business_id: string
          created_at?: string
          display_name?: string | null
          hire_date?: string | null
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id?: string | null
          weekly_hours?: number
        }
        Update: {
          annual_vacation_days?: number
          business_id?: string
          created_at?: string
          display_name?: string | null
          hire_date?: string | null
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id?: string | null
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
      hr_permissions: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          custom_type_label: string | null
          employee_id: string
          end_time: string
          hours_count: number
          id: string
          permission_date: string
          permission_type: Database["public"]["Enums"]["permission_type"]
          reason: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          start_time: string
          status: Database["public"]["Enums"]["absence_status"]
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          custom_type_label?: string | null
          employee_id: string
          end_time: string
          hours_count?: number
          id?: string
          permission_date: string
          permission_type: Database["public"]["Enums"]["permission_type"]
          reason?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          start_time: string
          status?: Database["public"]["Enums"]["absence_status"]
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          custom_type_label?: string | null
          employee_id?: string
          end_time?: string
          hours_count?: number
          id?: string
          permission_date?: string
          permission_type?: Database["public"]["Enums"]["permission_type"]
          reason?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["absence_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_permissions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_permissions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
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
          corrected_at: string | null
          corrected_by: string | null
          correction_reason: string | null
          created_at: string
          employee_id: string
          id: string
          last_break_start: string | null
          needs_review: boolean
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
          corrected_at?: string | null
          corrected_by?: string | null
          correction_reason?: string | null
          created_at?: string
          employee_id: string
          id?: string
          last_break_start?: string | null
          needs_review?: boolean
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
          corrected_at?: string | null
          corrected_by?: string | null
          correction_reason?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          last_break_start?: string | null
          needs_review?: boolean
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
      integration_interests: {
        Row: {
          business_id: string
          created_at: string
          id: string
          integration_key: string
          notes: string | null
          requested_by: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          integration_key: string
          notes?: string | null
          requested_by?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          integration_key?: string
          notes?: string | null
          requested_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_interests_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_sync_issues: {
        Row: {
          attempts: number
          business_id: string
          created_at: string
          entity_name: string
          entity_type: string
          error_message: string
          external_id: string | null
          id: string
          resolved: boolean
          run_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          business_id: string
          created_at?: string
          entity_name: string
          entity_type?: string
          error_message: string
          external_id?: string | null
          id?: string
          resolved?: boolean
          run_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          business_id?: string
          created_at?: string
          entity_name?: string
          entity_type?: string
          error_message?: string
          external_id?: string | null
          id?: string
          resolved?: boolean
          run_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_issues_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_sync_issues_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "integration_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_sync_runs: {
        Row: {
          business_id: string
          created_by: string | null
          created_count: number
          failed_count: number
          finished_at: string | null
          id: string
          integration_key: string
          message: string | null
          processed_count: number
          scope: string
          started_at: string
          status: string
          total_count: number
          updated_count: number
        }
        Insert: {
          business_id: string
          created_by?: string | null
          created_count?: number
          failed_count?: number
          finished_at?: string | null
          id?: string
          integration_key: string
          message?: string | null
          processed_count?: number
          scope: string
          started_at?: string
          status?: string
          total_count?: number
          updated_count?: number
        }
        Update: {
          business_id?: string
          created_by?: string | null
          created_count?: number
          failed_count?: number
          finished_at?: string | null
          id?: string
          integration_key?: string
          message?: string | null
          processed_count?: number
          scope?: string
          started_at?: string
          status?: string
          total_count?: number
          updated_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_variant_mismatches: {
        Row: {
          barcode: string | null
          business_id: string
          created_at: string
          details: string | null
          external_id: string | null
          external_stock: number | null
          id: string
          integration_key: string
          issue_code: string
          local_stock: number | null
          local_variant_id: string | null
          product_name: string
          resolved: boolean
          run_id: string | null
          sku: string | null
          updated_at: string
          variant_name: string | null
        }
        Insert: {
          barcode?: string | null
          business_id: string
          created_at?: string
          details?: string | null
          external_id?: string | null
          external_stock?: number | null
          id?: string
          integration_key?: string
          issue_code: string
          local_stock?: number | null
          local_variant_id?: string | null
          product_name: string
          resolved?: boolean
          run_id?: string | null
          sku?: string | null
          updated_at?: string
          variant_name?: string | null
        }
        Update: {
          barcode?: string | null
          business_id?: string
          created_at?: string
          details?: string | null
          external_id?: string | null
          external_stock?: number | null
          id?: string
          integration_key?: string
          issue_code?: string
          local_stock?: number | null
          local_variant_id?: string | null
          product_name?: string
          resolved?: boolean
          run_id?: string | null
          sku?: string | null
          updated_at?: string
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_variant_mismatches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_variant_mismatches_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "integration_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_webhook_events: {
        Row: {
          attempts: number
          business_id: string | null
          created_at: string
          event_id: string | null
          external_id: string | null
          id: string
          integration_key: string
          message: string | null
          next_attempt_at: string
          payload: Json | null
          processed_at: string | null
          shop_domain: string | null
          status: string
          topic: string
        }
        Insert: {
          attempts?: number
          business_id?: string | null
          created_at?: string
          event_id?: string | null
          external_id?: string | null
          id?: string
          integration_key: string
          message?: string | null
          next_attempt_at?: string
          payload?: Json | null
          processed_at?: string | null
          shop_domain?: string | null
          status?: string
          topic: string
        }
        Update: {
          attempts?: number
          business_id?: string | null
          created_at?: string
          event_id?: string | null
          external_id?: string | null
          id?: string
          integration_key?: string
          message?: string | null
          next_attempt_at?: string
          payload?: Json | null
          processed_at?: string | null
          shop_domain?: string | null
          status?: string
          topic?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_webhook_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
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
      label_templates: {
        Row: {
          business_id: string
          config: Json
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean
          name: string
          updated_at: string
        }
        Insert: {
          business_id: string
          config: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "label_templates_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
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
      online_order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string | null
          product_name: string
          quantity: number
          total: number
          unit_price: number
          variant_id: string | null
        }
        Insert: {
          id?: string
          order_id: string
          product_id?: string | null
          product_name: string
          quantity?: number
          total?: number
          unit_price?: number
          variant_id?: string | null
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          total?: number
          unit_price?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "online_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "online_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      online_order_returns: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          external_refund_id: string | null
          external_source: string | null
          external_sync_error: string | null
          external_sync_status: string
          external_synced_at: string | null
          id: string
          kind: string
          order_id: string
          reason: string | null
          refund_method: string | null
          restock: boolean
          return_number: string
          total: number
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          external_refund_id?: string | null
          external_source?: string | null
          external_sync_error?: string | null
          external_sync_status?: string
          external_synced_at?: string | null
          id?: string
          kind?: string
          order_id: string
          reason?: string | null
          refund_method?: string | null
          restock?: boolean
          return_number: string
          total?: number
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          external_refund_id?: string | null
          external_source?: string | null
          external_sync_error?: string | null
          external_sync_status?: string
          external_synced_at?: string | null
          id?: string
          kind?: string
          order_id?: string
          reason?: string | null
          refund_method?: string | null
          restock?: boolean
          return_number?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "online_order_returns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_order_returns_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "online_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      online_orders: {
        Row: {
          business_id: string
          client_id: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          discount: number
          external_id: string | null
          external_synced_at: string | null
          external_updated_at: string | null
          id: string
          notes: string | null
          order_number: string
          payment_method: string | null
          payment_status: string
          shipping_address: string | null
          shipping_cost: number
          source: string
          status: Database["public"]["Enums"]["online_order_status"]
          stock_applied: boolean
          subtotal: number
          tax: number
          total: number
          tracking_number: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          discount?: number
          external_id?: string | null
          external_synced_at?: string | null
          external_updated_at?: string | null
          id?: string
          notes?: string | null
          order_number: string
          payment_method?: string | null
          payment_status?: string
          shipping_address?: string | null
          shipping_cost?: number
          source?: string
          status?: Database["public"]["Enums"]["online_order_status"]
          stock_applied?: boolean
          subtotal?: number
          tax?: number
          total?: number
          tracking_number?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          discount?: number
          external_id?: string | null
          external_synced_at?: string | null
          external_updated_at?: string | null
          id?: string
          notes?: string | null
          order_number?: string
          payment_method?: string | null
          payment_status?: string
          shipping_address?: string | null
          shipping_cost?: number
          source?: string
          status?: Database["public"]["Enums"]["online_order_status"]
          stock_applied?: boolean
          subtotal?: number
          tax?: number
          total?: number
          tracking_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "online_orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
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
      pos_authorizations: {
        Row: {
          action: string
          business_id: string
          created_at: string
          employee_id: string
          expires_at: string
          id: string
          max_amount: number | null
          requested_by: string
          used_at: string | null
        }
        Insert: {
          action: string
          business_id: string
          created_at?: string
          employee_id: string
          expires_at?: string
          id?: string
          max_amount?: number | null
          requested_by: string
          used_at?: string | null
        }
        Update: {
          action?: string
          business_id?: string
          created_at?: string
          employee_id?: string
          expires_at?: string
          id?: string
          max_amount?: number | null
          requested_by?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_authorizations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_authorizations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_seller_sessions: {
        Row: {
          business_id: string
          created_at: string
          employee_id: string
          expires_at: string
          id: string
          last_used_at: string
          opened_by: string
        }
        Insert: {
          business_id: string
          created_at?: string
          employee_id: string
          expires_at?: string
          id?: string
          last_used_at?: string
          opened_by: string
        }
        Update: {
          business_id?: string
          created_at?: string
          employee_id?: string
          expires_at?: string
          id?: string
          last_used_at?: string
          opened_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_seller_sessions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_seller_sessions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          attributes: Json
          barcode: string | null
          business_id: string
          cost_price: number | null
          created_at: string
          created_by: string | null
          external_id: string | null
          external_source: string | null
          id: string
          is_active: boolean
          name: string
          price: number | null
          product_id: string
          sku: string | null
          stock_quantity: number
          updated_at: string
        }
        Insert: {
          attributes?: Json
          barcode?: string | null
          business_id: string
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          name: string
          price?: number | null
          product_id: string
          sku?: string | null
          stock_quantity?: number
          updated_at?: string
        }
        Update: {
          attributes?: Json
          barcode?: string | null
          business_id?: string
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          name?: string
          price?: number | null
          product_id?: string
          sku?: string | null
          stock_quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          business_id: string
          category: string | null
          color: string | null
          cost_price: number | null
          created_at: string
          created_by: string | null
          description: string | null
          external_id: string | null
          external_source: string | null
          id: string
          is_active: boolean
          name: string
          price: number
          sku: string | null
          stock_quantity: number | null
          track_inventory: boolean | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          business_id: string
          category?: string | null
          color?: string | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          name: string
          price?: number
          sku?: string | null
          stock_quantity?: number | null
          track_inventory?: boolean | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          business_id?: string
          category?: string | null
          color?: string | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          sku?: string | null
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
      purchase_order_items: {
        Row: {
          barcode: string | null
          business_id: string
          created_at: string
          discount_pct: number
          id: string
          order_id: string
          product_id: string | null
          product_name: string
          qty_ordered: number
          qty_received: number
          sku: string | null
          unit_cost: number
          variant_id: string | null
        }
        Insert: {
          barcode?: string | null
          business_id: string
          created_at?: string
          discount_pct?: number
          id?: string
          order_id: string
          product_id?: string | null
          product_name: string
          qty_ordered: number
          qty_received?: number
          sku?: string | null
          unit_cost?: number
          variant_id?: string | null
        }
        Update: {
          barcode?: string | null
          business_id?: string
          created_at?: string
          discount_pct?: number
          id?: string
          order_id?: string
          product_id?: string | null
          product_name?: string
          qty_ordered?: number
          qty_received?: number
          sku?: string | null
          unit_cost?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          expected_at: string | null
          id: string
          location_gid: string | null
          location_name: string | null
          notes: string | null
          number: string
          ordered_at: string | null
          received_at: string | null
          season: string | null
          status: string
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          expected_at?: string | null
          id?: string
          location_gid?: string | null
          location_name?: string | null
          notes?: string | null
          number: string
          ordered_at?: string | null
          received_at?: string | null
          season?: string | null
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          expected_at?: string | null
          id?: string
          location_gid?: string | null
          location_name?: string | null
          notes?: string | null
          number?: string
          ordered_at?: string | null
          received_at?: string | null
          season?: string | null
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_receipt_items: {
        Row: {
          business_id: string
          id: string
          order_item_id: string
          quantity: number
          receipt_id: string
          unit_cost: number
        }
        Insert: {
          business_id: string
          id?: string
          order_item_id: string
          quantity: number
          receipt_id: string
          unit_cost?: number
        }
        Update: {
          business_id?: string
          id?: string
          order_item_id?: string
          quantity?: number
          receipt_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_receipt_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipt_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipt_items_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "purchase_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_receipts: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          order_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          order_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_receipts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          discount: number
          id: string
          product_id: string | null
          product_name: string
          quantity: number
          sale_id: string
          total: number
          unit_cost: number | null
          unit_price: number
          variant_id: string | null
        }
        Insert: {
          discount?: number
          id?: string
          product_id?: string | null
          product_name: string
          quantity?: number
          sale_id: string
          total?: number
          unit_cost?: number | null
          unit_price?: number
          variant_id?: string | null
        }
        Update: {
          discount?: number
          id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          sale_id?: string
          total?: number
          unit_cost?: number | null
          unit_price?: number
          variant_id?: string | null
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
          {
            foreignKeyName: "sale_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_return_items: {
        Row: {
          id: string
          product_id: string | null
          product_name: string
          quantity: number
          return_id: string
          sale_item_id: string | null
          total: number
          unit_cost: number | null
          unit_price: number
          variant_id: string | null
        }
        Insert: {
          id?: string
          product_id?: string | null
          product_name: string
          quantity: number
          return_id: string
          sale_item_id?: string | null
          total?: number
          unit_cost?: number | null
          unit_price?: number
          variant_id?: string | null
        }
        Update: {
          id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          return_id?: string
          sale_item_id?: string | null
          total?: number
          unit_cost?: number | null
          unit_price?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "sale_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_return_items_sale_item_id_fkey"
            columns: ["sale_item_id"]
            isOneToOne: false
            referencedRelation: "sale_items"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_returns: {
        Row: {
          authorized_by_employee_id: string | null
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          reason: string | null
          refund_method: string | null
          register_session_id: string | null
          restock: boolean
          return_number: string
          sale_id: string
          seller_employee_id: string | null
          shopify_refund_attempts: number
          shopify_refund_error: string | null
          shopify_refund_gid: string | null
          shopify_refund_status: string
          total: number
        }
        Insert: {
          authorized_by_employee_id?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          refund_method?: string | null
          register_session_id?: string | null
          restock?: boolean
          return_number: string
          sale_id: string
          seller_employee_id?: string | null
          shopify_refund_attempts?: number
          shopify_refund_error?: string | null
          shopify_refund_gid?: string | null
          shopify_refund_status?: string
          total?: number
        }
        Update: {
          authorized_by_employee_id?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          refund_method?: string | null
          register_session_id?: string | null
          restock?: boolean
          return_number?: string
          sale_id?: string
          seller_employee_id?: string | null
          shopify_refund_attempts?: number
          shopify_refund_error?: string | null
          shopify_refund_gid?: string | null
          shopify_refund_status?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_returns_authorized_by_employee_id_fkey"
            columns: ["authorized_by_employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_returns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_returns_register_session_id_fkey"
            columns: ["register_session_id"]
            isOneToOne: false
            referencedRelation: "cash_register_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_returns_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_returns_seller_employee_id_fkey"
            columns: ["seller_employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_seller_changes: {
        Row: {
          business_id: string
          changed_by: string
          created_at: string
          from_employee_id: string | null
          id: string
          reason: string
          sale_id: string
          to_employee_id: string | null
        }
        Insert: {
          business_id: string
          changed_by: string
          created_at?: string
          from_employee_id?: string | null
          id?: string
          reason: string
          sale_id: string
          to_employee_id?: string | null
        }
        Update: {
          business_id?: string
          changed_by?: string
          created_at?: string
          from_employee_id?: string | null
          id?: string
          reason?: string
          sale_id?: string
          to_employee_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_seller_changes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_seller_changes_from_employee_id_fkey"
            columns: ["from_employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_seller_changes_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_seller_changes_to_employee_id_fkey"
            columns: ["to_employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          authorized_by_employee_id: string | null
          business_id: string
          cash_received: number | null
          change_given: number | null
          client_id: string | null
          created_at: string
          created_by: string | null
          discount: number
          id: string
          notes: string | null
          payment_method: string | null
          register_session_id: string | null
          sale_number: string
          seller_employee_id: string | null
          shopify_order_attempts: number
          shopify_order_claimed_at: string | null
          shopify_order_error: string | null
          shopify_order_gid: string | null
          shopify_order_name: string | null
          shopify_order_status: string | null
          subtotal: number
          tax: number
          tip: number
          total: number
          voucher_amount: number
          voucher_id: string | null
        }
        Insert: {
          authorized_by_employee_id?: string | null
          business_id: string
          cash_received?: number | null
          change_given?: number | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          discount?: number
          id?: string
          notes?: string | null
          payment_method?: string | null
          register_session_id?: string | null
          sale_number: string
          seller_employee_id?: string | null
          shopify_order_attempts?: number
          shopify_order_claimed_at?: string | null
          shopify_order_error?: string | null
          shopify_order_gid?: string | null
          shopify_order_name?: string | null
          shopify_order_status?: string | null
          subtotal?: number
          tax?: number
          tip?: number
          total?: number
          voucher_amount?: number
          voucher_id?: string | null
        }
        Update: {
          authorized_by_employee_id?: string | null
          business_id?: string
          cash_received?: number | null
          change_given?: number | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          discount?: number
          id?: string
          notes?: string | null
          payment_method?: string | null
          register_session_id?: string | null
          sale_number?: string
          seller_employee_id?: string | null
          shopify_order_attempts?: number
          shopify_order_claimed_at?: string | null
          shopify_order_error?: string | null
          shopify_order_gid?: string | null
          shopify_order_name?: string | null
          shopify_order_status?: string | null
          subtotal?: number
          tax?: number
          tip?: number
          total?: number
          voucher_amount?: number
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_authorized_by_employee_id_fkey"
            columns: ["authorized_by_employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
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
          {
            foreignKeyName: "sales_register_session_id_fkey"
            columns: ["register_session_id"]
            isOneToOne: false
            referencedRelation: "cash_register_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_seller_employee_id_fkey"
            columns: ["seller_employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "store_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_job_tickets: {
        Row: {
          action: string
          created_at: string
          id: string
          used_at: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          used_at?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          used_at?: string | null
        }
        Relationships: []
      }
      shopify_app_tokens: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string | null
          id: string
          scopes: string[]
          shop_domain: string
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at?: string | null
          id?: string
          scopes?: string[]
          shop_domain: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          scopes?: string[]
          shop_domain?: string
          updated_at?: string
        }
        Relationships: []
      }
      shopify_connections: {
        Row: {
          api_version: string
          business_id: string
          created_at: string
          created_by: string | null
          default_location_gid: string | null
          granted_scopes: string[]
          id: string
          last_catalog_sync_at: string | null
          last_orders_sync_at: string | null
          last_stock_refresh_at: string | null
          last_stock_refresh_status: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          last_verified_at: string | null
          orders_history_imported_at: string | null
          orders_sync_enabled: boolean
          pos_orders_enabled: boolean
          pos_orders_since: string
          shop_domain: string
          stock_push_enabled: boolean
          uninstalled_at: string | null
          updated_at: string
          webhooks_registered_at: string | null
        }
        Insert: {
          api_version?: string
          business_id: string
          created_at?: string
          created_by?: string | null
          default_location_gid?: string | null
          granted_scopes?: string[]
          id?: string
          last_catalog_sync_at?: string | null
          last_orders_sync_at?: string | null
          last_stock_refresh_at?: string | null
          last_stock_refresh_status?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_verified_at?: string | null
          orders_history_imported_at?: string | null
          orders_sync_enabled?: boolean
          pos_orders_enabled?: boolean
          pos_orders_since?: string
          shop_domain: string
          stock_push_enabled?: boolean
          uninstalled_at?: string | null
          updated_at?: string
          webhooks_registered_at?: string | null
        }
        Update: {
          api_version?: string
          business_id?: string
          created_at?: string
          created_by?: string | null
          default_location_gid?: string | null
          granted_scopes?: string[]
          id?: string
          last_catalog_sync_at?: string | null
          last_orders_sync_at?: string | null
          last_stock_refresh_at?: string | null
          last_stock_refresh_status?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_verified_at?: string | null
          orders_history_imported_at?: string | null
          orders_sync_enabled?: boolean
          pos_orders_enabled?: boolean
          pos_orders_since?: string
          shop_domain?: string
          stock_push_enabled?: boolean
          uninstalled_at?: string | null
          updated_at?: string
          webhooks_registered_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shopify_connections_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_fulfillments: {
        Row: {
          business_id: string
          created_at: string
          delivered_at: string | null
          external_id: string
          id: string
          line_item_count: number
          order_external_id: string
          order_id: string | null
          shipped_at: string | null
          status: string
          tracking_company: string | null
          tracking_number: string | null
          tracking_url: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          delivered_at?: string | null
          external_id: string
          id?: string
          line_item_count?: number
          order_external_id: string
          order_id?: string | null
          shipped_at?: string | null
          status?: string
          tracking_company?: string | null
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          delivered_at?: string | null
          external_id?: string
          id?: string
          line_item_count?: number
          order_external_id?: string
          order_id?: string | null
          shipped_at?: string | null
          status?: string
          tracking_company?: string | null
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_fulfillments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_fulfillments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "online_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_inventory_levels: {
        Row: {
          available: number
          business_id: string
          created_at: string
          external_key: string | null
          id: string
          inventory_item_gid: string
          local_product_id: string | null
          local_variant_id: string | null
          location_gid: string
          location_name: string | null
          remote_updated_at: string | null
          synced_at: string
          updated_at: string
          variant_external_id: string | null
        }
        Insert: {
          available?: number
          business_id: string
          created_at?: string
          external_key?: string | null
          id?: string
          inventory_item_gid: string
          local_product_id?: string | null
          local_variant_id?: string | null
          location_gid: string
          location_name?: string | null
          remote_updated_at?: string | null
          synced_at?: string
          updated_at?: string
          variant_external_id?: string | null
        }
        Update: {
          available?: number
          business_id?: string
          created_at?: string
          external_key?: string | null
          id?: string
          inventory_item_gid?: string
          local_product_id?: string | null
          local_variant_id?: string | null
          location_gid?: string
          location_name?: string | null
          remote_updated_at?: string | null
          synced_at?: string
          updated_at?: string
          variant_external_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shopify_inventory_levels_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_inventory_levels_local_product_id_fkey"
            columns: ["local_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_inventory_levels_local_variant_id_fkey"
            columns: ["local_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_inventory_pushes: {
        Row: {
          attempts: number
          business_id: string
          created_at: string
          delta: number
          id: string
          inventory_item_gid: string | null
          last_error: string | null
          local_product_id: string | null
          local_variant_id: string | null
          location_gid: string | null
          processed_at: string | null
          reason: string
          source_id: string | null
          source_table: string | null
          status: string
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          business_id: string
          created_at?: string
          delta: number
          id?: string
          inventory_item_gid?: string | null
          last_error?: string | null
          local_product_id?: string | null
          local_variant_id?: string | null
          location_gid?: string | null
          processed_at?: string | null
          reason: string
          source_id?: string | null
          source_table?: string | null
          status?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          business_id?: string
          created_at?: string
          delta?: number
          id?: string
          inventory_item_gid?: string | null
          last_error?: string | null
          local_product_id?: string | null
          local_variant_id?: string | null
          location_gid?: string | null
          processed_at?: string | null
          reason?: string
          source_id?: string | null
          source_table?: string | null
          status?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_inventory_pushes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          delta: number
          id: string
          note: string | null
          product_id: string | null
          reference_id: string | null
          source: string
          stock_after: number | null
          variant_id: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          note?: string | null
          product_id?: string | null
          reference_id?: string | null
          source: string
          stock_after?: number | null
          variant_id?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          note?: string | null
          product_id?: string | null
          reference_id?: string | null
          source?: string
          stock_after?: number | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      stockagile_connections: {
        Row: {
          business_id: string
          created_at: string
          enabled: boolean
          sales_history_imported_at: string | null
          sales_synced_at: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          enabled?: boolean
          sales_history_imported_at?: string | null
          sales_synced_at?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          enabled?: boolean
          sales_history_imported_at?: string | null
          sales_synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stockagile_connections_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      stockagile_sale_items: {
        Row: {
          barcode: string | null
          color: string | null
          id: string
          product_name: string
          quantity: number
          sale_id: string
          size: string | null
          total: number | null
          unit_price: number | null
          variant_id: string | null
        }
        Insert: {
          barcode?: string | null
          color?: string | null
          id?: string
          product_name: string
          quantity?: number
          sale_id: string
          size?: string | null
          total?: number | null
          unit_price?: number | null
          variant_id?: string | null
        }
        Update: {
          barcode?: string | null
          color?: string | null
          id?: string
          product_name?: string
          quantity?: number
          sale_id?: string
          size?: string | null
          total?: number | null
          unit_price?: number | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stockagile_sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "stockagile_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stockagile_sale_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      stockagile_sales: {
        Row: {
          business_id: string
          client_id: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          deleted: boolean
          external_id: number
          id: string
          is_return: boolean
          number: string | null
          payment_methods: string | null
          return_of_external_id: number | null
          sold_at: string
          synced_at: string
          total: number
          warehouse_name: string | null
        }
        Insert: {
          business_id: string
          client_id?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deleted?: boolean
          external_id: number
          id?: string
          is_return?: boolean
          number?: string | null
          payment_methods?: string | null
          return_of_external_id?: number | null
          sold_at: string
          synced_at?: string
          total?: number
          warehouse_name?: string | null
        }
        Update: {
          business_id?: string
          client_id?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deleted?: boolean
          external_id?: number
          id?: string
          is_return?: boolean
          number?: string | null
          payment_methods?: string | null
          return_of_external_id?: number | null
          sold_at?: string
          synced_at?: string
          total?: number
          warehouse_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stockagile_sales_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stockagile_sales_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      stockagile_stock_moves: {
        Row: {
          attempts: number
          business_id: string
          claimed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          local_product_id: string | null
          local_variant_id: string | null
          location_gid: string | null
          processed_at: string | null
          quantity: number
          reason: string
          source_id: string
          source_table: string
          status: string
          stockagile_variant_id: number | null
          warehouse_id: number | null
        }
        Insert: {
          attempts?: number
          business_id: string
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          local_product_id?: string | null
          local_variant_id?: string | null
          location_gid?: string | null
          processed_at?: string | null
          quantity: number
          reason: string
          source_id: string
          source_table: string
          status?: string
          stockagile_variant_id?: number | null
          warehouse_id?: number | null
        }
        Update: {
          attempts?: number
          business_id?: string
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          local_product_id?: string | null
          local_variant_id?: string | null
          location_gid?: string | null
          processed_at?: string | null
          quantity?: number
          reason?: string
          source_id?: string
          source_table?: string
          status?: string
          stockagile_variant_id?: number | null
          warehouse_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stockagile_stock_moves_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      store_voucher_movements: {
        Row: {
          amount: number
          balance_after: number
          business_id: string
          created_at: string
          created_by: string | null
          employee_id: string | null
          id: string
          kind: string
          note: string | null
          return_id: string | null
          sale_id: string | null
          voucher_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          business_id: string
          created_at?: string
          created_by?: string | null
          employee_id?: string | null
          id?: string
          kind: string
          note?: string | null
          return_id?: string | null
          sale_id?: string | null
          voucher_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          business_id?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string | null
          id?: string
          kind?: string
          note?: string | null
          return_id?: string | null
          sale_id?: string | null
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_voucher_movements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_voucher_movements_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "sale_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_voucher_movements_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_voucher_movements_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "store_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      store_vouchers: {
        Row: {
          balance: number
          business_id: string
          client_id: string | null
          code: string
          created_at: string
          created_by: string | null
          created_by_employee_id: string | null
          expires_at: string | null
          id: string
          initial_amount: number
          origin: string
          source_return_id: string | null
          status: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          balance: number
          business_id: string
          client_id?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          created_by_employee_id?: string | null
          expires_at?: string | null
          id?: string
          initial_amount: number
          origin?: string
          source_return_id?: string | null
          status?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          balance?: number
          business_id?: string
          client_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          created_by_employee_id?: string | null
          expires_at?: string | null
          id?: string
          initial_amount?: number
          origin?: string
          source_return_id?: string | null
          status?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_vouchers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_vouchers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_vouchers_source_return_id_fkey"
            columns: ["source_return_id"]
            isOneToOne: false
            referencedRelation: "sale_returns"
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
      suppliers: {
        Row: {
          business_id: string
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_business_invitation: { Args: { _token: string }; Returns: string }
      adjust_stock: {
        Args: {
          _business_id: string
          _new_quantity: number
          _product_id: string
          _reason: string
          _variant_id: string
        }
        Returns: number
      }
      admin_update_subscription: {
        Args: {
          _business_id: string
          _current_period_end?: string
          _plan_key?: string
          _reason: string
          _status?: Database["public"]["Enums"]["subscription_status"]
          _trial_ends_at?: string
        }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_online_order_stock: {
        Args: { _direction: number; _order_id: string }
        Returns: undefined
      }
      apply_shopify_inventory_levels: {
        Args: { _business_id: string; _levels: Json; _source?: string }
        Returns: {
          applied: number
          stale: number
          unknown: number
        }[]
      }
      authorize_action: {
        Args: {
          _action: string
          _amount?: number
          _business_id: string
          _employee_id: string
          _pin: string
        }
        Returns: {
          authorization_id: string
          error: string
          locked_seconds: number
          name: string
          ok: boolean
        }[]
      }
      business_local_date: {
        Args: { _at?: string; _business_id: string }
        Returns: string
      }
      business_requires_seller: {
        Args: { _business_id: string }
        Returns: boolean
      }
      catalog_codes_status: {
        Args: { _business_id: string }
        Returns: {
          can_generate: boolean
          ean_prefix: string
          locked: boolean
          sku_pattern: string
        }[]
      }
      change_own_pin: {
        Args: {
          _business_id: string
          _employee_id: string
          _new_pin: string
          _old_pin: string
        }
        Returns: {
          error: string
          locked_seconds: number
          ok: boolean
        }[]
      }
      claim_pos_sales_for_shopify: {
        Args: { _business_id: string; _limit?: number }
        Returns: string[]
      }
      claim_shopify_shop: {
        Args: {
          _api_version?: string
          _business_id: string
          _shop_domain: string
        }
        Returns: {
          api_version: string
          business_id: string
          created_at: string
          created_by: string | null
          default_location_gid: string | null
          granted_scopes: string[]
          id: string
          last_catalog_sync_at: string | null
          last_orders_sync_at: string | null
          last_stock_refresh_at: string | null
          last_stock_refresh_status: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          last_verified_at: string | null
          orders_history_imported_at: string | null
          orders_sync_enabled: boolean
          pos_orders_enabled: boolean
          pos_orders_since: string
          shop_domain: string
          stock_push_enabled: boolean
          uninstalled_at: string | null
          updated_at: string
          webhooks_registered_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "shopify_connections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_stockagile_moves: {
        Args: { _business_id: string; _limit?: number }
        Returns: {
          attempts: number
          business_id: string
          claimed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          local_product_id: string | null
          local_variant_id: string | null
          location_gid: string | null
          processed_at: string | null
          quantity: number
          reason: string
          source_id: string
          source_table: string
          status: string
          stockagile_variant_id: number | null
          warehouse_id: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "stockagile_stock_moves"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      client_id_for_email: {
        Args: { _business_id: string; _email: string }
        Returns: string
      }
      client_purchases: {
        Args: { _business_id: string }
        Returns: {
          channel: string
          client_id: string
          created_at: string
          net: number
          number: string
          payment_method: string
          purchase_id: string
          status: string
          total: number
        }[]
      }
      clock_action: {
        Args: {
          _business_id: string
          _entry_type: Database["public"]["Enums"]["time_entry_type"]
          _latitude?: number
          _longitude?: number
          _notes?: string
          _seller_session_id?: string
        }
        Returns: string
      }
      close_register_session: {
        Args: {
          _authorization_id?: string
          _counted_amount: number
          _notes?: string
          _seller_session_id?: string
          _session_id: string
        }
        Returns: undefined
      }
      consume_authorization: {
        Args: {
          _action: string
          _amount: number
          _authorization_id: string
          _business_id: string
        }
        Returns: string
      }
      consume_scheduled_job_ticket: {
        Args: { _action: string; _ticket: string }
        Returns: boolean
      }
      correct_work_session: {
        Args: {
          _break_seconds: number
          _clock_in_at: string
          _clock_out_at: string
          _reason: string
          _session_id: string
        }
        Returns: undefined
      }
      create_business: {
        Args: { _industry?: string; _name: string }
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
      create_online_order: {
        Args: {
          _business_id: string
          _client_id?: string
          _customer_email?: string
          _customer_name: string
          _customer_phone?: string
          _discount?: number
          _items: Json
          _notes?: string
          _payment_method?: string
          _payment_status?: string
          _shipping_address?: string
          _shipping_cost?: number
          _source?: string
          _tax?: number
        }
        Returns: {
          order_id: string
          order_number: string
        }[]
      }
      create_online_order_return: {
        Args: {
          _kind?: string
          _order_id: string
          _reason?: string
          _refund_method?: string
          _restock?: boolean
          _total?: number
        }
        Returns: {
          return_id: string
          return_number: string
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
      create_sale_return: {
        Args: {
          _authorization_id?: string
          _business_id: string
          _items: Json
          _reason?: string
          _refund_method?: string
          _restock?: boolean
          _sale_id: string
          _seller_session_id?: string
        }
        Returns: {
          return_id: string
          return_number: string
        }[]
      }
      create_sale_with_items: {
        Args: {
          _authorization_id?: string
          _business_id: string
          _cash_received?: number
          _change_given?: number
          _client_id?: string
          _discount?: number
          _items: Json
          _notes?: string
          _payment_method?: string
          _register_session_id?: string
          _seller_session_id?: string
          _subtotal?: number
          _tax?: number
          _tip?: number
          _total?: number
          _voucher_amount?: number
          _voucher_code?: string
        }
        Returns: {
          sale_id: string
          sale_number: string
        }[]
      }
      default_seller_employee: {
        Args: { _business_id: string }
        Returns: string
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_payment_and_recalc_invoice: {
        Args: { _business_id: string; _payment_id: string }
        Returns: undefined
      }
      ean13_check_digit: { Args: { _first12: string }; Returns: number }
      email_queue_dispatch: { Args: never; Returns: undefined }
      employee_display_name: { Args: { _employee_id: string }; Returns: string }
      employee_effective_permissions: {
        Args: { _employee_id: string }
        Returns: {
          can_adjust_stock: boolean
          can_close_register: boolean
          can_edit_catalog: boolean
          can_return: boolean
          can_see_costs: boolean
          is_owner: boolean
          max_discount_pct: number
        }[]
      }
      end_seller_session: { Args: { _session_id: string }; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      enqueue_shopify_inventory_push: {
        Args: {
          _business_id: string
          _delta: number
          _product_id: string
          _reason: string
          _source_id: string
          _source_table: string
          _variant_id: string
        }
        Returns: undefined
      }
      ensure_hr_employee: { Args: { _business_id: string }; Returns: string }
      generate_invoice_number: {
        Args: { _business_id: string }
        Returns: string
      }
      generate_online_order_number: {
        Args: { _business_id: string }
        Returns: string
      }
      generate_sale_number: { Args: { _business_id: string }; Returns: string }
      generate_store_voucher_code: {
        Args: { _business_id: string }
        Returns: string
      }
      get_active_business: { Args: never; Returns: string }
      get_business_team: {
        Args: { _business_id: string }
        Returns: {
          email: string
          full_name: string
          is_active: boolean
          joined_at: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      get_catalog_costs: {
        Args: { _business_id: string; _product_id?: string }
        Returns: {
          cost_price: number
          id: string
          kind: string
        }[]
      }
      get_client_history: {
        Args: { _business_id: string; _client_id: string }
        Returns: Json
      }
      get_connected_sellers: {
        Args: { _business_id: string }
        Returns: {
          employee_id: string
          expires_at: string
          last_used_at: string
          name: string
        }[]
      }
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
          correction_reason: string
          id: string
          needs_review: boolean
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
          my_pending_reviews: number
          my_session_clock_in: string
          my_session_status: string
          pending_absences: number
          team_on_vacation_today: number
          vacation_days_pending: number
          vacation_days_total: number
          vacation_days_used: number
        }[]
      }
      get_my_permissions: {
        Args: { _business_id: string }
        Returns: {
          can_adjust_stock: boolean
          can_edit_catalog: boolean
          can_see_costs: boolean
        }[]
      }
      get_platform_audit_log: {
        Args: { _business_id?: string; _limit?: number; _offset?: number }
        Returns: {
          action: string
          actor_email: string
          actor_user_id: string
          business_id: string
          business_name: string
          created_at: string
          id: string
          new_data: Json
          old_data: Json
          reason: string
          record_id: string
          table_name: string
        }[]
      }
      get_pos_employees: {
        Args: { _business_id: string }
        Returns: {
          has_account: boolean
          has_pin: boolean
          id: string
          is_active: boolean
          name: string
          user_id: string
        }[]
      }
      get_pos_permissions: {
        Args: { _business_id: string }
        Returns: {
          can_adjust_stock: boolean
          can_close_register: boolean
          can_edit_catalog: boolean
          can_return: boolean
          can_see_costs: boolean
          customized: boolean
          employee_id: string
          has_account: boolean
          is_owner: boolean
          max_discount_pct: number
          name: string
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
      get_register_seller_summary: {
        Args: { _seller_session_ids?: string[]; _session_id: string }
        Returns: {
          cash_total: number
          employee_id: string
          name: string
          net_total: number
          refunds_count: number
          refunds_total: number
          sales_count: number
          sales_total: number
        }[]
      }
      get_register_summary: {
        Args: { _seller_session_ids?: string[]; _session_id: string }
        Returns: {
          payment_method: string
          refunds_amount: number
          refunds_count: number
          sales_count: number
          total_amount: number
        }[]
      }
      get_sale_detail: {
        Args: { _sale_id: string }
        Returns: {
          product_id: string
          product_name: string
          quantity: number
          returned_quantity: number
          sale_item_id: string
          total: number
          unit_price: number
          variant_id: string
        }[]
      }
      get_sales_by_seller: {
        Args: { _business_id: string; _from: string; _to: string }
        Returns: {
          employee_id: string
          name: string
          net_total: number
          returns_count: number
          returns_total: number
          sales_count: number
          sales_total: number
        }[]
      }
      get_sales_report: {
        Args: { _business_id: string; _from: string; _to: string }
        Returns: Json
      }
      get_security_audit_log: {
        Args: { _business_id: string; _limit?: number; _offset?: number }
        Returns: {
          action: string
          actor_name: string
          actor_user_id: string
          created_at: string
          id: string
          new_data: Json
          old_data: Json
          record_id: string
          table_name: string
        }[]
      }
      get_shopify_problems: {
        Args: { _business_id: string }
        Returns: {
          attempts: number
          error: string
          happened_at: string
          kind: string
          record_id: string
          reference: string
          state: string
        }[]
      }
      get_stock_locations: {
        Args: { _business_id: string }
        Returns: {
          is_default: boolean
          location_gid: string
          location_name: string
        }[]
      }
      get_store_voucher: {
        Args: { _business_id: string; _code: string }
        Returns: {
          balance: number
          code: string
          expired: boolean
          expires_at: string
          id: string
          initial_amount: number
          status: string
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
      issue_scheduled_job_ticket: { Args: { _action: string }; Returns: string }
      leave_business: { Args: { _business_id: string }; Returns: undefined }
      list_clients_with_stats: {
        Args: {
          _business_id: string
          _include_inactive?: boolean
          _limit?: number
          _offset?: number
          _search?: string
          _sort?: string
        }
        Returns: {
          company: string
          created_at: string
          email: string
          id: string
          is_active: boolean
          last_purchase_at: string
          name: string
          notes: string
          phone: string
          purchases: number
          spent: number
          total_count: number
        }[]
      }
      member_can: {
        Args: { _business_id: string; _perm: string }
        Returns: boolean
      }
      mfa_satisfied: { Args: never; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      next_barcodes: {
        Args: { _business_id: string; _count: number; _reserve?: boolean }
        Returns: string[]
      }
      next_document_number: {
        Args: { _business_id: string; _kind: string }
        Returns: number
      }
      open_register_session: {
        Args: {
          _business_id: string
          _opening_amount?: number
          _seller_session_id?: string
        }
        Returns: string
      }
      owned_business_count: { Args: { _user_id: string }; Returns: number }
      pos_client_actor: {
        Args: { _business_id: string; _seller_session_id: string }
        Returns: string
      }
      pos_find_or_create_client: {
        Args: {
          _business_id: string
          _email?: string
          _name: string
          _phone?: string
          _receipt_consent?: boolean
          _seller_session_id?: string
        }
        Returns: {
          client_id: string
          created: boolean
          email: string
          name: string
          receipt_email_consent: boolean
        }[]
      }
      pos_normalize_email: { Args: { _email: string }; Returns: string }
      pos_search_clients: {
        Args: { _business_id: string; _limit?: number; _query: string }
        Returns: {
          email: string
          id: string
          name: string
          phone: string
          receipt_email_consent: boolean
        }[]
      }
      pos_set_receipt_consent: {
        Args: {
          _client_id: string
          _consent: boolean
          _email?: string
          _seller_session_id?: string
        }
        Returns: undefined
      }
      pos_set_sale_client: {
        Args: {
          _client_id: string
          _sale_id: string
          _seller_session_id?: string
        }
        Returns: undefined
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reassign_sale_seller: {
        Args: { _employee_id: string; _reason: string; _sale_id: string }
        Returns: undefined
      }
      receive_purchase_order: {
        Args: {
          _business_id: string
          _lines: Json
          _notes?: string
          _order_id: string
        }
        Returns: string
      }
      recompute_local_stock: {
        Args: {
          _business_id: string
          _product_id: string
          _source?: string
          _variant_id: string
        }
        Returns: undefined
      }
      remove_member: {
        Args: { _business_id: string; _user_id: string }
        Returns: undefined
      }
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
      request_permission: {
        Args: {
          _business_id: string
          _custom_label?: string
          _end_time: string
          _permission_date: string
          _permission_type: Database["public"]["Enums"]["permission_type"]
          _reason?: string
          _start_time: string
        }
        Returns: string
      }
      reserve_catalog_codes: {
        Args: { _business_id: string; _items: Json; _product_id: string }
        Returns: {
          barcode: string
          product_external_id: string
          sku: string
          variant_external_id: string
          variant_id: string
        }[]
      }
      retire_member: {
        Args: { _business_id: string; _user_id: string }
        Returns: undefined
      }
      retry_shopify_problems: {
        Args: { _business_id: string }
        Returns: {
          returns_count: number
          sales_count: number
          stock_count: number
          webhooks_count: number
        }[]
      }
      review_absence: {
        Args: { _absence_id: string; _approve: boolean; _notes?: string }
        Returns: undefined
      }
      review_permission: {
        Args: { _approve: boolean; _notes?: string; _permission_id: string }
        Returns: undefined
      }
      save_purchase_order: {
        Args: {
          _business_id: string
          _expected_at: string
          _items: Json
          _location_gid: string
          _notes: string
          _order_id: string
          _season: string
          _supplier_id: string
        }
        Returns: {
          order_id: string
          order_number: string
        }[]
      }
      save_supplier: {
        Args: {
          _business_id: string
          _email?: string
          _name: string
          _notes?: string
          _phone?: string
          _supplier_id: string
          _tax_id?: string
        }
        Returns: string
      }
      seller_from_session: {
        Args: { _business_id: string; _session_id: string }
        Returns: string
      }
      set_active_business: { Args: { _business_id: string }; Returns: boolean }
      set_employee_permissions: {
        Args: {
          _business_id: string
          _can_adjust_stock?: boolean
          _can_close_register: boolean
          _can_edit_catalog?: boolean
          _can_return: boolean
          _can_see_costs?: boolean
          _employee_id: string
          _max_discount_pct: number
        }
        Returns: undefined
      }
      set_employee_pin: {
        Args: { _business_id: string; _employee_id: string; _pin: string }
        Returns: undefined
      }
      set_invoice_status: {
        Args: {
          _business_id: string
          _invoice_id: string
          _status: Database["public"]["Enums"]["invoice_status"]
        }
        Returns: Database["public"]["Enums"]["invoice_status"]
      }
      set_online_order_status: {
        Args: {
          _order_id: string
          _status: Database["public"]["Enums"]["online_order_status"]
          _tracking_number?: string
        }
        Returns: undefined
      }
      set_purchase_order_status: {
        Args: { _business_id: string; _order_id: string; _status: string }
        Returns: undefined
      }
      shopify_pending_pos_work: {
        Args: never
        Returns: {
          pending_orders: boolean
          pending_refunds: boolean
        }[]
      }
      shopify_pending_work: {
        Args: never
        Returns: {
          pending_events: boolean
          pending_pushes: boolean
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      start_seller_session: {
        Args: { _business_id: string; _employee_id: string; _pin: string }
        Returns: {
          employee_id: string
          error: string
          locked_seconds: number
          name: string
          ok: boolean
          session_id: string
        }[]
      }
      stockagile_pending_work: { Args: never; Returns: boolean }
      transfer_ownership: {
        Args: {
          _business_id: string
          _keep_owner?: boolean
          _new_owner: string
        }
        Returns: undefined
      }
      upsert_external_order: {
        Args: {
          _business_id: string
          _customer_email: string
          _customer_name: string
          _customer_phone: string
          _discount: number
          _external_id: string
          _external_updated_at: string
          _items: Json
          _notes: string
          _order_number: string
          _payment_method: string
          _payment_status: string
          _placed_at?: string
          _shipping_address: string
          _shipping_cost: number
          _source: string
          _status: Database["public"]["Enums"]["online_order_status"]
          _subtotal: number
          _tax: number
          _total: number
          _tracking_number: string
        }
        Returns: {
          order_id: string
          was_created: boolean
        }[]
      }
      upsert_pos_employee: {
        Args: {
          _business_id: string
          _display_name: string
          _employee_id: string
          _is_active?: boolean
        }
        Returns: string
      }
      verify_employee_pin: {
        Args: { _business_id: string; _employee_id: string; _pin: string }
        Returns: {
          error: string
          locked_seconds: number
          ok: boolean
        }[]
      }
      void_store_voucher: {
        Args: { _business_id: string; _reason: string; _voucher_id: string }
        Returns: undefined
      }
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
      online_order_status:
        | "pending"
        | "accepted"
        | "preparing"
        | "shipped"
        | "delivered"
        | "cancelled"
        | "returned"
      permission_type:
        | "late_arrival"
        | "early_departure"
        | "personal_errand"
        | "other"
      platform_role: "super_admin" | "support"
      register_status: "open" | "closed"
      store_profile:
        | "general"
        | "shoe_store"
        | "bar"
        | "florist"
        | "bakery"
        | "fashion"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      online_order_status: [
        "pending",
        "accepted",
        "preparing",
        "shipped",
        "delivered",
        "cancelled",
        "returned",
      ],
      permission_type: [
        "late_arrival",
        "early_departure",
        "personal_errand",
        "other",
      ],
      platform_role: ["super_admin", "support"],
      register_status: ["open", "closed"],
      store_profile: [
        "general",
        "shoe_store",
        "bar",
        "florist",
        "bakery",
        "fashion",
      ],
      subscription_plan: ["free", "trial", "pro", "business"],
      subscription_status: ["active", "cancelled", "past_due", "trialing"],
      time_entry_type: ["clock_in", "break_start", "break_end", "clock_out"],
      work_session_status: ["open", "closed"],
    },
  },
} as const
